"""Content request tools for the x402 payer agent.

These tools handle requesting content from the seller API, detecting
HTTP 402 payment requirements, and retrying with payment proof headers
after a successful ProcessPayment call.
"""

import base64
import json
import time
from typing import Any

import httpx
from strands import tool

from ..config import config
from ..tracing import get_tracer
from ..metrics import get_metrics_emitter
from .payment import get_last_payment_context
from .url_safety import UnsafeRequestUrlError, build_seller_url, redirect_guard_hooks


def _invalid_url_result(
    span: Any, metrics: Any, url: str, error: UnsafeRequestUrlError
) -> dict[str, Any]:
    """Record and return the tool result for a path rejected by build_seller_url."""
    span.set_attribute("error.type", "invalid_url")
    span.set_attribute("error.message", str(error))
    metrics.record_content_request(
        status_code=0,
        latency_ms=0.0,
        content_path=url,
        error="invalid_url",
    )
    return {
        "http_status": 0,
        "error_message": f"Invalid content URL: {error}",
    }


@tool
def request_content(url: str) -> dict[str, Any]:
    """Request content from the seller API.

    If the endpoint returns HTTP 402 (Payment Required), the x402 payment
    requirements are extracted and returned as x402_payload. Pass this
    payload directly to process_payment.

    Supports both x402 v1 (body-based) and v2 (PAYMENT-REQUIRED header) formats.

    If the original request uses POST and gets a 402, re-fetches with GET to
    obtain the canonical payment requirement (the facilitator validates against
    the GET version).

    Args:
        url: The content URL path on the seller API, starting with "/"
            (e.g., "/api/premium-article"). Full URLs and hostnames are rejected.

    Returns:
        Dictionary with http_status, data (if 200), or x402_payload and
        x402_version (if 402) for passing to process_payment.
    """
    tracer = get_tracer()
    metrics = get_metrics_emitter()
    start_time = time.time()

    with tracer.start_as_current_span("content.request") as span:
        try:
            full_url = build_seller_url(config.seller_api_url, url)
        except UnsafeRequestUrlError as e:
            return _invalid_url_result(span, metrics, url, e)
        span.set_attribute("http.url", full_url)
        span.set_attribute("http.method", "GET")
        span.set_attribute("content.path", url)

        try:
            # Redirects are followed only within the seller's origin, so the payment requirement
            # is never taken from a response served by a different origin.
            with httpx.Client(
                timeout=30.0, event_hooks=redirect_guard_hooks(config.seller_api_url)
            ) as client:
                response = client.get(
                    full_url,
                    headers={"Accept": "application/json"},
                    follow_redirects=True,
                )

                span.set_attribute("http.status_code", response.status_code)
                latency_ms = (time.time() - start_time) * 1000

                if response.status_code == 200:
                    span.set_attribute("content.delivered", True)
                    metrics.record_content_request(
                        status_code=200,
                        latency_ms=latency_ms,
                        content_path=url,
                    )
                    return {
                        "http_status": 200,
                        "data": response.json(),
                    }

                if response.status_code == 402:
                    span.set_attribute("payment.required", True)

                    payment_info = None
                    x402_version = 1

                    # v2: payment details in PAYMENT-REQUIRED header (base64-encoded JSON)
                    pr_header = (
                        response.headers.get("PAYMENT-REQUIRED")
                        or response.headers.get("x-payment-required")
                        or response.headers.get("X-PAYMENT-REQUIRED")
                    )
                    if pr_header:
                        try:
                            payment_info = json.loads(base64.b64decode(pr_header))
                            x402_version = payment_info.get("x402Version", 2)
                        except Exception:
                            pass

                    # v1 fallback: payment details in response body
                    if not payment_info:
                        try:
                            payment_info = response.json()
                            x402_version = payment_info.get("x402Version", 1)
                        except Exception:
                            metrics.record_content_request(
                                status_code=402,
                                latency_ms=latency_ms,
                                content_path=url,
                                payment_required=True,
                                error="unparseable_402",
                            )
                            return {
                                "http_status": 402,
                                "error_message": "Could not parse payment requirements from 402 response",
                            }

                    # Extract accepts[0] as the raw x402 payload
                    accepts = payment_info.get("accepts", [])
                    if not accepts:
                        metrics.record_content_request(
                            status_code=402,
                            latency_ms=latency_ms,
                            content_path=url,
                            payment_required=True,
                            error="no_accepts",
                        )
                        return {
                            "http_status": 402,
                            "error_message": "402 response has no 'accepts' array",
                            "raw_payment_info": payment_info,
                        }

                    x402_payload = accepts[0]

                    span.set_attribute("payment.amount", x402_payload.get("amount", ""))
                    span.set_attribute("payment.network", x402_payload.get("network", ""))
                    span.set_attribute("payment.x402_version", x402_version)

                    metrics.record_content_request(
                        status_code=402,
                        latency_ms=latency_ms,
                        content_path=url,
                        payment_required=True,
                    )

                    # Also provide a human-readable summary for backward compat
                    extra = x402_payload.get("extra", {})
                    payment_required = {
                        "scheme": x402_payload.get("scheme"),
                        "network": x402_payload.get("network"),
                        "amount": x402_payload.get("amount"),
                        "asset": x402_payload.get("asset"),
                        "currency": extra.get("name", "USDC"),
                        "recipient": x402_payload.get("payTo", ""),
                        "maxTimeoutSeconds": x402_payload.get("maxTimeoutSeconds", 60),
                    }

                    return {
                        "http_status": 402,
                        "payment_required": payment_required,
                        "x402_payload": x402_payload,
                        "x402_version": x402_version,
                        "message": (
                            "Payment required. Pass x402_payload directly to "
                            "process_payment, then call request_content_with_payment."
                        ),
                    }

                span.set_attribute("error.type", "unexpected_status")
                metrics.record_content_request(
                    status_code=response.status_code,
                    latency_ms=latency_ms,
                    content_path=url,
                    error=f"unexpected_status_{response.status_code}",
                )
                return {
                    "http_status": response.status_code,
                    "error_message": f"Unexpected status code: {response.status_code}",
                }

        except httpx.RequestError as e:
            span.set_attribute("error.type", "request_error")
            span.set_attribute("error.message", str(e))
            span.record_exception(e)
            latency_ms = (time.time() - start_time) * 1000
            metrics.record_content_request(
                status_code=0,
                latency_ms=latency_ms,
                content_path=url,
                error=str(e),
            )
            return {
                "http_status": 0,
                "error_message": f"Request failed: {str(e)}",
            }


@tool
def request_content_with_payment(url: str) -> dict[str, Any]:
    """Retry a content request with the x402 payment proof from the last process_payment call.

    The payment proof, x402 version, and original merchant payload are
    automatically retrieved from internal state — you do NOT need to pass
    them manually. Just pass the URL.

    Constructs the correct x402 header:
    - v1: X-PAYMENT header with x402Version, scheme, network, payload
    - v2: PAYMENT-SIGNATURE header with x402Version, resource, accepted, payload, extension

    Retries with exponential backoff if the merchant still returns 402
    (waiting for on-chain transaction settlement).

    Args:
        url: The content URL path on the seller API (e.g., "/api/premium-article") — same as
            the one that returned 402.

    Returns:
        Dictionary with http_status, data, and settlement details.
    """
    tracer = get_tracer()
    metrics = get_metrics_emitter()
    start_time = time.time()

    with tracer.start_as_current_span("content.request_with_payment") as span:
        try:
            full_url = build_seller_url(config.seller_api_url, url)
        except UnsafeRequestUrlError as e:
            return _invalid_url_result(span, metrics, url, e)
        span.set_attribute("http.url", full_url)
        span.set_attribute("content.path", url)
        span.set_attribute("payment.included", True)

        # Get payment context from last process_payment call
        ctx = get_last_payment_context()
        proof = ctx.get("proof")
        if not proof:
            return {
                "http_status": 0,
                "error_message": "No payment proof available. Call process_payment first.",
            }

        x402_version = ctx.get("x402_version", 1)
        x402_payload = ctx.get("x402_payload", {})

        span.set_attribute("payment.x402_version", x402_version)

        # Build the payment proof header
        if x402_version >= 2:
            header_obj = {
                "x402Version": 2,
                "resource": x402_payload.get("resource", ""),
                "accepted": x402_payload,
                "payload": proof.get("payload", proof),
                "extension": x402_payload.get("resource", ""),
            }
            header_name = "PAYMENT-SIGNATURE"
        else:
            header_obj = {
                "x402Version": 1,
                "scheme": x402_payload.get("scheme", "exact"),
                "network": x402_payload.get("network", "base-sepolia"),
                "payload": proof.get("payload", proof),
            }
            header_name = "X-PAYMENT"

        encoded_header = base64.b64encode(json.dumps(header_obj).encode()).decode()
        span.set_attribute("payment.header_name", header_name)

        # Retry with exponential backoff — merchant returns 402 until on-chain tx settles
        max_attempts = 6
        last_response = None

        try:
            # The redirect guard refuses any hop to a different origin before the payment
            # header is sent to it; same-origin redirects are followed.
            with httpx.Client(
                timeout=30.0, event_hooks=redirect_guard_hooks(config.seller_api_url)
            ) as client:
                for attempt in range(1, max_attempts + 1):
                    response = client.post(
                        full_url,
                        headers={
                            "Accept": "application/json",
                            header_name: encoded_header,
                        },
                        follow_redirects=True,
                    )
                    last_response = response

                    if response.status_code != 402:
                        break

                    # Still 402 — transaction hasn't settled yet
                    if attempt < max_attempts:
                        wait = 2 * attempt
                        time.sleep(wait)

                span.set_attribute("http.status_code", response.status_code)
                span.set_attribute("payment.retry_attempts", attempt)
                latency_ms = (time.time() - start_time) * 1000

                if response.status_code == 200:
                    span.set_attribute("content.delivered", True)
                    span.set_attribute("payment.accepted", True)

                    # Parse settlement response from header
                    payment_response_header = (
                        response.headers.get("PAYMENT-RESPONSE")
                        or response.headers.get("x-payment-response")
                        or response.headers.get("X-PAYMENT-RESPONSE")
                    )
                    settlement = None
                    if payment_response_header:
                        try:
                            settlement = json.loads(base64.b64decode(payment_response_header))
                            span.set_attribute("payment.settled", True)
                            if settlement and "transactionHash" in settlement:
                                span.set_attribute(
                                    "payment.transaction_hash",
                                    settlement["transactionHash"],
                                )
                        except Exception:
                            settlement = {"raw": payment_response_header}

                    metrics.record_content_request(
                        status_code=200,
                        latency_ms=latency_ms,
                        content_path=url,
                    )

                    return {
                        "http_status": 200,
                        "data": response.json(),
                        "settlement": settlement,
                    }

                if response.status_code == 402:
                    span.set_attribute("payment.accepted", False)
                    span.set_attribute("error.type", "payment_not_settled")
                    metrics.record_content_request(
                        status_code=402,
                        latency_ms=latency_ms,
                        content_path=url,
                        payment_required=True,
                        error="payment_not_settled",
                    )
                    return {
                        "http_status": 402,
                        "error_message": (
                            "Payment proof was sent but merchant still returned 402 "
                            "after all retry attempts. The on-chain transaction may "
                            "not have settled yet, or the wallet may have insufficient USDC."
                        ),
                    }

                span.set_attribute("error.type", "unexpected_status")
                metrics.record_content_request(
                    status_code=response.status_code,
                    latency_ms=latency_ms,
                    content_path=url,
                    error=f"unexpected_status_{response.status_code}",
                )
                return {
                    "http_status": response.status_code,
                    "error_message": f"Unexpected status code: {response.status_code}",
                }

        except httpx.RequestError as e:
            span.set_attribute("error.type", "request_error")
            span.set_attribute("error.message", str(e))
            span.record_exception(e)
            latency_ms = (time.time() - start_time) * 1000
            metrics.record_content_request(
                status_code=0,
                latency_ms=latency_ms,
                content_path=url,
                error=str(e),
            )
            return {
                "http_status": 0,
                "error_message": f"Request failed: {str(e)}",
            }
