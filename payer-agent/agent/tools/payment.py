"""Payment tools for the x402 payer agent using AgentCore Payments.

This module provides the process_payment tool that calls the Amazon Bedrock
AgentCore Payments ProcessPayment API. It replaces the previous manual wallet
management and EIP-3009 signing with a single managed API call.

The agent operates under ProcessPaymentRole and can ONLY execute payments
within the budget set by the application backend via CreatePaymentSession.
"""

import uuid
from datetime import datetime
from typing import Any

import boto3
from strands import tool

from ..config import config
from ..tracing import get_tracer, add_payment_span_attributes
from ..metrics import get_metrics_emitter

# ── Module-level state ───────────────────────────────────────────
_dp_client = None
_last_payment_context: dict = {}


def _get_dp_client():
    """Get or create the bedrock-agentcore data plane client.

    Assumes ProcessPaymentRole via STS and returns a boto3 client scoped
    to that role. The client is cached at module level for reuse.
    """
    global _dp_client
    if _dp_client is not None:
        return _dp_client

    session = boto3.Session(region_name=config.aws_region)

    if config.process_payment_role_arn:
        # Assume ProcessPaymentRole via STS
        sts = session.client("sts")
        resp = sts.assume_role(
            RoleArn=config.process_payment_role_arn,
            RoleSessionName=f"payer-agent-{int(datetime.now().timestamp())}",
        )
        creds = resp["Credentials"]
        agent_session = boto3.Session(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
            region_name=config.aws_region,
        )
    else:
        # Fall back to default credentials (for local dev without role assumption)
        agent_session = session

    kwargs = {"region_name": config.aws_region}
    if config.dp_endpoint:
        kwargs["endpoint_url"] = config.dp_endpoint

    _dp_client = agent_session.client("bedrock-agentcore", **kwargs)
    return _dp_client


def get_last_payment_context() -> dict:
    """Return the last payment context (proof, url, version, payload).

    Used by content.py and discovery.py to construct payment headers
    after a successful ProcessPayment call.
    """
    return _last_payment_context


def _is_allowed_payee(pay_to: str, allowed: tuple[str, ...]) -> bool:
    """Return True if pay_to is one of the allowed seller addresses.

    EVM addresses (0x-prefixed hex) are compared case-insensitively because their checksum
    casing is optional; any other address format is compared exactly.
    """
    if pay_to.lower().startswith("0x"):
        return pay_to.lower() in {address.lower() for address in allowed}
    return pay_to in allowed


@tool
def process_payment(x402_payload: dict, x402_version: int = 1) -> dict[str, Any]:
    """Execute an x402 crypto payment via AgentCore Payments ProcessPayment API.

    Pass the ENTIRE x402 payment requirement object from the merchant as-is.
    This is typically accepts[0] from the HTTP 402 response. Do NOT parse
    individual fields — the API accepts the raw merchant payload directly.

    The x402_version determines how the payload is handled:
    - v1: full merchant payload passed through (including resource, description, etc.)
    - v2: metadata fields stripped, only payment fields kept

    After a successful call (status: PROOF_GENERATED), the payment proof is
    stored internally and can be used by request_content_with_payment.

    Args:
        x402_payload: The raw x402 payment requirement from the merchant
            (accepts[0] from the 402 response). Pass it AS-IS.
        x402_version: The x402 protocol version (1 or 2). Use the version
            returned by request_content or request_service. Defaults to 1.

    Returns:
        The ProcessPayment API response including payment proof if successful.
    """
    tracer = get_tracer()
    metrics = get_metrics_emitter()

    with tracer.start_as_current_span("payment.process_payment") as span:
        span.set_attribute("payment.x402_version", x402_version)
        span.set_attribute("payment.amount", x402_payload.get("amount", ""))
        span.set_attribute("payment.network", x402_payload.get("network", ""))

        pay_to = str(x402_payload.get("payTo", ""))
        if config.seller_pay_to_addresses and not _is_allowed_payee(
            pay_to, config.seller_pay_to_addresses
        ):
            span.set_attribute("error.type", "payee_not_allowed")
            metrics.record_error(
                error_type="payee_not_allowed",
                error_message=f"payTo {pay_to!r} is not in SELLER_PAY_TO_ADDRESSES",
                operation="process_payment",
            )
            return {
                "success": False,
                "status": "REJECTED",
                "error": (
                    f"Payment refused: payTo {pay_to!r} is not an allowed seller address. "
                    "Do not retry this payment."
                ),
            }

        try:
            dp_client = _get_dp_client()

            # Prepare payload — v2 strips non-payment metadata fields
            payload = dict(x402_payload)
            if x402_version >= 2:
                for key in ["description", "mimeType", "resource", "outputSchema"]:
                    payload.pop(key, None)

            response = dp_client.process_payment(
                userId=config.user_id,
                paymentManagerArn=config.payment_manager_arn,
                paymentSessionId=config.payment_session_id,
                paymentInstrumentId=config.payment_instrument_id,
                paymentType="CRYPTO_X402",
                paymentInput={
                    "cryptoX402": {
                        "version": str(x402_version),
                        "payload": payload,
                    }
                },
                clientToken=str(uuid.uuid4()),
            )
            response.pop("ResponseMetadata", None)

            status = response.get("status", "UNKNOWN")
            span.set_attribute("payment.status", status)

            # Store proof for use by request_content_with_payment
            if status == "PROOF_GENERATED":
                crypto_output = response.get("paymentOutput", {}).get("cryptoX402", {})
                _last_payment_context["proof"] = crypto_output
                _last_payment_context["x402_version"] = x402_version
                _last_payment_context["x402_payload"] = x402_payload
                span.set_attribute("payment.proof_stored", True)

            add_payment_span_attributes(
                span,
                amount=x402_payload.get("amount", ""),
                network=x402_payload.get("network", ""),
                recipient=x402_payload.get("payTo", ""),
            )

            return response

        except Exception as e:
            span.set_attribute("error.message", str(e))
            span.record_exception(e)
            metrics.record_error(
                error_type="process_payment_error",
                error_message=str(e),
                operation="process_payment",
            )
            return {
                "success": False,
                "status": "ERROR",
                "error": str(e),
            }
