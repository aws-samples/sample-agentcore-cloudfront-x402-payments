"""Content request tools for the x402 payer agent."""

import base64
import json
from typing import Any
import httpx
from strands import tool

from ..config import config


@tool
async def request_content(url: str) -> dict[str, Any]:
    """
    Request content from the seller API.

    This may return a 402 Payment Required response with payment details.

    Args:
        url: The content URL path (e.g., "/api/premium-article")

    Returns:
        Dictionary with status, content (if 200), or payment requirements (if 402)
    """
    full_url = f"{config.seller_api_url}{url}"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                full_url,
                headers={"Accept": "application/json"},
                follow_redirects=True,
            )

            if response.status_code == 200:
                return {
                    "status": 200,
                    "content": response.json(),
                }

            if response.status_code == 402:
                # Parse payment requirements from header
                payment_required_header = response.headers.get("PAYMENT-REQUIRED")
                if not payment_required_header:
                    return {
                        "status": 402,
                        "error": "Missing PAYMENT-REQUIRED header",
                    }

                # Decode base64 payment requirements
                payment_data = json.loads(base64.b64decode(payment_required_header))
                requirement = payment_data.get("requirements", [{}])[0]

                return {
                    "status": 402,
                    "payment_required": {
                        "scheme": requirement.get("scheme"),
                        "network": requirement.get("network"),
                        "amount": requirement.get("amount"),
                        "currency": requirement.get("currency"),
                        "recipient": requirement.get("recipient"),
                        "description": requirement.get("description"),
                    },
                }

            return {
                "status": response.status_code,
                "error": f"Unexpected status code: {response.status_code}",
            }

        except httpx.RequestError as e:
            return {
                "status": 0,
                "error": f"Request failed: {str(e)}",
            }


@tool
async def request_content_with_payment(
    url: str,
    payment_payload: dict[str, Any],
) -> dict[str, Any]:
    """
    Request content with a signed payment.

    Args:
        url: The content URL path (e.g., "/api/premium-article")
        payment_payload: The signed payment payload from sign_payment tool

    Returns:
        Dictionary with status, content, and transaction details
    """
    full_url = f"{config.seller_api_url}{url}"

    # Encode payment payload as base64
    payment_signature = base64.b64encode(
        json.dumps(payment_payload).encode()
    ).decode()

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                full_url,
                headers={
                    "Accept": "application/json",
                    "PAYMENT-SIGNATURE": payment_signature,
                },
                follow_redirects=True,
            )

            if response.status_code == 200:
                # Parse settlement response from header
                payment_response_header = response.headers.get("PAYMENT-RESPONSE")
                settlement = None
                if payment_response_header:
                    settlement = json.loads(base64.b64decode(payment_response_header))

                return {
                    "status": 200,
                    "content": response.json(),
                    "settlement": settlement,
                }

            if response.status_code == 402:
                return {
                    "status": 402,
                    "error": "Payment was rejected by the server",
                }

            return {
                "status": response.status_code,
                "error": f"Unexpected status code: {response.status_code}",
            }

        except httpx.RequestError as e:
            return {
                "status": 0,
                "error": f"Request failed: {str(e)}",
            }
