"""Service discovery tools for the x402 payer agent.

This module provides tools for discovering available paid services/tools
via the Gateway's MCP endpoint. This enables the enterprise-ready pattern
where the agent doesn't have hardcoded knowledge of available services,
but can dynamically discover and use them.

The discovery flow:
1. Agent calls discover_services to find available paid services
2. Agent receives a list of services with pricing, descriptions, and endpoints
3. Agent can then use request_service to access any discovered service
4. If payment is required, agent calls process_payment then retries with proof
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


@tool
def discover_services() -> dict[str, Any]:
    """Discover available paid services from the Gateway.

    This tool queries the Gateway's service catalog to find all available
    services that can be purchased with x402 payments. Use this to find
    out what services are available before requesting them.

    Returns:
        Dictionary with:
        - services: List of available services with name, description, price, and endpoint
        - total_count: Number of services available
        - gateway_url: The gateway URL being used
    """
    tracer = get_tracer()
    metrics = get_metrics_emitter()
    start_time = time.time()

    with tracer.start_as_current_span("discovery.discover_services") as span:
        gateway_url = config.seller_api_url
        discovery_url = f"{gateway_url}/mcp/tools"
        span.set_attribute("discovery.url", discovery_url)

        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.get(
                    discovery_url,
                    headers={"Accept": "application/json"},
                )

                latency_ms = (time.time() - start_time) * 1000
                span.set_attribute("http.status_code", response.status_code)

                if response.status_code != 200:
                    span.set_attribute("error.type", "discovery_failed")
                    return {
                        "http_status": response.status_code,
                        "error_message": f"Service discovery failed with status {response.status_code}",
                        "services": [],
                        "total_count": 0,
                    }

                data = response.json()
                tools_data = data.get("tools", [])

                # Parse services into a user-friendly format
                services = []
                for tool_data in tools_data:
                    mcp_metadata = tool_data.get("mcp_metadata", {})
                    x402_metadata = tool_data.get("x402_metadata", {})

                    service = {
                        "name": tool_data.get("tool_name", tool_data.get("name", "")),
                        "description": tool_data.get("tool_description", tool_data.get("description", "")),
                        "category": mcp_metadata.get("category", ""),
                        "tags": mcp_metadata.get("tags", []),
                        "requires_payment": mcp_metadata.get("requires_payment", False),
                        "price": {
                            "amount": x402_metadata.get("price_usdc_units", ""),
                            "display": x402_metadata.get("price_usdc_display", ""),
                            "currency": x402_metadata.get("asset_name", "USDC"),
                            "network": x402_metadata.get("network_name", ""),
                        },
                        "endpoint": tool_data.get("endpoint_path", ""),
                    }
                    services.append(service)

                span.set_attribute("discovery.services_found", len(services))

                return {
                    "http_status": 200,
                    "services": services,
                    "total_count": len(services),
                    "gateway_url": gateway_url,
                    "message": f"Found {len(services)} available services",
                }

        except httpx.RequestError as e:
            span.set_attribute("error.type", "request_error")
            span.set_attribute("error.message", str(e))
            span.record_exception(e)
            return {
                "http_status": 0,
                "error_message": f"Service discovery request failed: {str(e)}",
                "services": [],
                "total_count": 0,
            }


@tool
def request_service(
    service_name: str,
    payment_proof: dict[str, Any] = None,
) -> dict[str, Any]:
    """Request a service by name, handling x402 payment if required.

    Use discover_services first to find available services and their names.

    On first call (without payment_proof), you'll get x402_payload and x402_version
    if payment is required. Pass x402_payload to process_payment, then call this
    tool again — the payment proof is automatically picked up from internal state.

    Args:
        service_name: Name of the service to request (e.g., "get_premium_article")
        payment_proof: DEPRECATED — proof is now automatically retrieved from
            internal state after process_payment. Pass None.

    Returns:
        Dictionary with:
        - http_status: 200 for success, 402 for payment required
        - data: The service response data (if 200)
        - x402_payload + x402_version: Payment details (if 402)
        - settlement: Transaction details (if payment was made)
    """
    tracer = get_tracer()
    metrics = get_metrics_emitter()
    start_time = time.time()

    with tracer.start_as_current_span("discovery.request_service") as span:
        span.set_attribute("service.name", service_name)

        # Convert service name to endpoint path
        path_name = service_name.replace("get_", "").replace("_", "-")
        endpoint_path = f"/api/{path_name}"

        try:
            full_url = build_seller_url(config.seller_api_url, endpoint_path)
        except UnsafeRequestUrlError as e:
            span.set_attribute("error.type", "invalid_url")
            span.set_attribute("error.message", str(e))
            return {
                "http_status": 0,
                "error_message": f"Invalid service name {service_name!r}: {e}",
            }
        span.set_attribute("http.url", full_url)

        # Check if we have a payment proof from a prior process_payment call
        ctx = get_last_payment_context()
        proof = ctx.get("proof")
        has_proof = proof is not None

        span.set_attribute("service.has_payment_proof", has_proof)

        # Build headers
        headers = {"Accept": "application/json"}
        method = "GET"

        if has_proof:
            # Construct the x402 payment header from stored proof
            x402_version = ctx.get("x402_version", 1)
            x402_payload = ctx.get("x402_payload", {})

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

            encoded = base64.b64encode(json.dumps(header_obj).encode()).decode()
            headers[header_name] = encoded
            method = "POST"  # Paid requests use POST

        try:
            # Redirects are followed only within the seller's origin: the redirect guard refuses
            # any hop to a different origin before the payment header is sent to it.
            with httpx.Client(
                timeout=30.0, event_hooks=redirect_guard_hooks(config.seller_api_url)
            ) as client:
                if has_proof:
                    # Retry with backoff for payment settlement
                    max_attempts = 6
                    for attempt in range(1, max_attempts + 1):
                        response = client.request(
                            method, full_url, headers=headers, follow_redirects=True
                        )
                        if response.status_code != 402:
                            break
                        if attempt < max_attempts:
                            time.sleep(2 * attempt)
                else:
                    response = client.get(
                        full_url, headers=headers, follow_redirects=True
                    )

                latency_ms = (time.time() - start_time) * 1000
                span.set_attribute("http.status_code", response.status_code)

                if response.status_code == 200:
                    span.set_attribute("service.delivered", True)

                    # Parse settlement if present
                    settlement = None
                    payment_response_header = (
                        response.headers.get("PAYMENT-RESPONSE")
                        or response.headers.get("x-payment-response")
                        or response.headers.get("X-PAYMENT-RESPONSE")
                    )
                    if payment_response_header:
                        try:
                            settlement = json.loads(
                                base64.b64decode(payment_response_header)
                            )
                        except Exception:
                            settlement = {"raw": payment_response_header}

                    return {
                        "http_status": 200,
                        "data": response.json(),
                        "settlement": settlement,
                        "service_name": service_name,
                    }

                if response.status_code == 402:
                    span.set_attribute("payment.required", True)

                    # Parse payment requirements
                    payment_info = None
                    x402_version = 1

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

                    if not payment_info:
                        try:
                            payment_info = response.json()
                            x402_version = payment_info.get("x402Version", 1)
                        except Exception:
                            pass

                    accepts = payment_info.get("accepts", []) if payment_info else []
                    x402_payload = accepts[0] if accepts else {}

                    # Re-fetch with GET to get canonical payment requirement
                    # (facilitator validates against GET version)
                    if method == "POST" and x402_payload:
                        try:
                            get_resp = client.get(
                                full_url,
                                headers={"Accept": "application/json"},
                                follow_redirects=True,
                            )
                            if get_resp.status_code == 402:
                                get_info = None
                                get_pr = (
                                    get_resp.headers.get("PAYMENT-REQUIRED")
                                    or get_resp.headers.get("x-payment-required")
                                    or get_resp.headers.get("X-PAYMENT-REQUIRED")
                                )
                                if get_pr:
                                    try:
                                        get_info = json.loads(base64.b64decode(get_pr))
                                    except Exception:
                                        pass
                                if not get_info:
                                    try:
                                        get_info = get_resp.json()
                                    except Exception:
                                        pass
                                if get_info:
                                    get_accepts = get_info.get("accepts", [])
                                    if get_accepts:
                                        x402_payload = get_accepts[0]
                        except Exception:
                            pass

                    extra = x402_payload.get("extra", {})

                    return {
                        "http_status": 402,
                        "payment_required": {
                            "scheme": x402_payload.get("scheme", "exact"),
                            "network": x402_payload.get("network", ""),
                            "amount": x402_payload.get("amount", ""),
                            "asset": x402_payload.get("asset", ""),
                            "currency": extra.get("name", "USDC"),
                            "recipient": x402_payload.get("payTo", ""),
                            "maxTimeoutSeconds": x402_payload.get("maxTimeoutSeconds", 60),
                        },
                        "x402_payload": x402_payload,
                        "x402_version": x402_version,
                        "service_name": service_name,
                        "message": (
                            "Payment required. Pass x402_payload directly to "
                            "process_payment, then call request_service again."
                        ),
                    }

                return {
                    "http_status": response.status_code,
                    "error_message": f"Unexpected status code: {response.status_code}",
                    "service_name": service_name,
                }

        except httpx.RequestError as e:
            span.set_attribute("error.type", "request_error")
            span.set_attribute("error.message", str(e))
            span.record_exception(e)
            return {
                "http_status": 0,
                "error_message": f"Service request failed: {str(e)}",
                "service_name": service_name,
            }


@tool
def list_approved_services() -> dict[str, Any]:
    """List services that have been pre-approved for autonomous purchasing.

    When a service is on the approved list, the agent can automatically
    purchase and use it without asking for user confirmation.

    Note: Session-level budgets (maxSpendAmount) are now the primary
    enforcement mechanism via AgentCore Payments. This list is kept for
    UX purposes — to let the agent know which services to purchase
    without prompting the user.

    Returns:
        Dictionary with approved services and their spending limits.
    """
    # For now, return a static list. In production, this would be
    # stored in a database or configuration service.
    approved = [
        {
            "service_name": "get_weather_data",
            "max_price_usdc": "0.001",
            "reason": "Low-cost utility data",
        },
        {
            "service_name": "get_premium_article",
            "max_price_usdc": "0.005",
            "reason": "Educational content",
        },
    ]

    return {
        "approved_services": approved,
        "total_approved": len(approved),
        "message": (
            "These services can be purchased automatically. "
            "For other services, I'll ask for your approval first. "
            "Note: Session budget limits are enforced server-side by AgentCore Payments."
        ),
    }


@tool
def check_service_approval(
    service_name: str,
    price_usdc: str,
) -> dict[str, Any]:
    """Check if a service purchase is pre-approved.

    Note: Even if a service is pre-approved here, the session budget
    (maxSpendAmount) set by the app backend is the real enforcement
    mechanism. ProcessPayment will reject requests that exceed the budget.

    Args:
        service_name: Name of the service to check
        price_usdc: Price in USDC (e.g., "0.001")

    Returns:
        Dictionary indicating if the purchase is approved and why.
    """
    approved_result = list_approved_services()
    approved_services = approved_result.get("approved_services", [])

    for approved in approved_services:
        if approved["service_name"] == service_name:
            try:
                max_price = float(approved["max_price_usdc"])
                actual_price = float(price_usdc)

                if actual_price <= max_price:
                    return {
                        "approved": True,
                        "service_name": service_name,
                        "price_usdc": price_usdc,
                        "max_approved_price": approved["max_price_usdc"],
                        "reason": approved["reason"],
                        "message": f"Purchase approved: {service_name} at {price_usdc} USDC",
                    }
                else:
                    return {
                        "approved": False,
                        "service_name": service_name,
                        "price_usdc": price_usdc,
                        "max_approved_price": approved["max_price_usdc"],
                        "reason": f"Price {price_usdc} exceeds approved limit of {approved['max_price_usdc']}",
                        "message": "Price exceeds approved limit. Please confirm this purchase.",
                    }
            except ValueError:
                pass

    return {
        "approved": False,
        "service_name": service_name,
        "price_usdc": price_usdc,
        "reason": "Service not on approved list",
        "message": f"Service '{service_name}' is not pre-approved. Please confirm this purchase.",
    }
