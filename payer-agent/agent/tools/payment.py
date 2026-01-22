"""Payment-related tools for the x402 payer agent."""

import json
import time
from typing import Any, Literal
from strands import tool
from coinbase_agentkit import CdpEvmWalletProvider, CdpEvmWalletProviderConfig

from ..config import config

# Wallet provider singleton
_wallet_provider: CdpEvmWalletProvider | None = None

# Supported testnet networks for faucet
SUPPORTED_FAUCET_NETWORKS = ["base-sepolia", "ethereum-sepolia"]

# Supported assets per network
SUPPORTED_FAUCET_ASSETS = {
    "base-sepolia": ["eth", "usdc", "eurc", "cbbtc"],
    "ethereum-sepolia": ["eth", "usdc", "eurc", "cbbtc"],
}


def _get_wallet_provider_sync() -> CdpEvmWalletProvider:
    """Get or create the wallet provider (synchronous)."""
    global _wallet_provider
    if _wallet_provider is None:
        wallet_config = CdpEvmWalletProviderConfig(
            api_key_id=config.cdp_api_key_name,
            api_key_secret=config.cdp_api_key_private_key,
            wallet_secret=config.cdp_wallet_secret,
            network_id=config.network_id,
        )
        _wallet_provider = CdpEvmWalletProvider(wallet_config)
    return _wallet_provider


@tool
def analyze_payment(
    amount: str,
    currency: str,
    recipient: str,
    description: str,
    wallet_balance: str,
) -> dict[str, Any]:
    """
    Analyze a payment request and decide whether to approve it.

    Args:
        amount: The payment amount (e.g., "0.001")
        currency: The currency (e.g., "ETH")
        recipient: The recipient wallet address
        description: Description of what is being purchased
        wallet_balance: Current wallet balance

    Returns:
        Dictionary with decision, reasoning, and risk level
    """
    # Convert to float for comparison
    try:
        amount_float = float(amount)
        balance_float = float(wallet_balance)
    except ValueError:
        return {
            "should_pay": False,
            "reasoning": "Invalid amount or balance format",
            "risk_level": "high",
        }

    # Basic validation checks
    if balance_float < amount_float:
        return {
            "should_pay": False,
            "reasoning": f"Insufficient balance. Have {wallet_balance} {currency}, need {amount} {currency}",
            "risk_level": "high",
        }

    # Check if amount is reasonable (demo: under 0.01 ETH)
    if amount_float > 0.01:
        return {
            "should_pay": False,
            "reasoning": f"Amount {amount} {currency} exceeds reasonable threshold for demo content",
            "risk_level": "medium",
        }

    # Check recipient address format
    if not recipient.startswith("0x") or len(recipient) != 42:
        return {
            "should_pay": False,
            "reasoning": "Invalid recipient address format",
            "risk_level": "high",
        }

    # Approve the payment
    return {
        "should_pay": True,
        "reasoning": f"Payment of {amount} {currency} for '{description}' is reasonable and within budget",
        "risk_level": "low",
    }


@tool
async def sign_payment(
    scheme: str,
    network: str,
    amount: str,
    recipient: str,
) -> dict[str, Any]:
    """
    Sign a payment using the AgentKit wallet.

    Args:
        scheme: Payment scheme (e.g., "exact")
        network: Blockchain network (e.g., "base-sepolia")
        amount: Payment amount
        recipient: Recipient wallet address

    Returns:
        Signed payment payload ready for x402 header
    """
    try:
        wallet_provider = _get_wallet_provider_sync()
        address = wallet_provider.get_address()

        timestamp = int(time.time() * 1000)

        # Create the payment message
        message = json.dumps({
            "scheme": scheme,
            "network": network,
            "from": address,
            "to": recipient,
            "amount": amount,
            "timestamp": timestamp,
        })

        # Sign the message
        signature = wallet_provider.sign_message(message)

        return {
            "success": True,
            "payload": {
                "scheme": scheme,
                "network": network,
                "signature": signature,
                "from": address,
                "to": recipient,
                "amount": amount,
                "timestamp": timestamp,
            },
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


@tool
def get_wallet_balance() -> dict[str, Any]:
    """
    Get the current wallet balance.

    Returns:
        Dictionary with wallet address, network, and balance
    """
    try:
        wallet_provider = _get_wallet_provider_sync()
        address = wallet_provider.get_address()
        network = wallet_provider.get_network()
        balance = wallet_provider.get_balance()

        # Convert from wei to ETH
        balance_eth = float(balance) / 1e18

        return {
            "success": True,
            "address": address,
            "network": network.network_id,
            "balance": str(balance_eth),
            "balance_wei": str(balance),
            "currency": "ETH",
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


@tool
def request_faucet_funds(
    asset_id: str = "eth",
) -> dict[str, Any]:
    """
    Request test tokens from the testnet faucet.

    This tool requests free test tokens from the CDP faucet for testing purposes.
    Only works on supported testnet networks (base-sepolia, ethereum-sepolia).

    Args:
        asset_id: The asset to request. Options:
            - "eth" (default): Native ETH
            - "usdc": USDC stablecoin
            - "eurc": EURC stablecoin
            - "cbbtc": Coinbase wrapped BTC

    Returns:
        Dictionary with success status and transaction hash or error message
    """
    try:
        wallet_provider = _get_wallet_provider_sync()
        network = wallet_provider.get_network()
        network_id = network.network_id
        address = wallet_provider.get_address()

        # Validate network support
        if network_id not in SUPPORTED_FAUCET_NETWORKS:
            return {
                "success": False,
                "error": f"Faucet is only supported on testnet networks: {', '.join(SUPPORTED_FAUCET_NETWORKS)}. "
                         f"Current network: {network_id}",
            }

        # Validate asset support
        supported_assets = SUPPORTED_FAUCET_ASSETS.get(network_id, [])
        asset_lower = asset_id.lower()
        if asset_lower not in supported_assets:
            return {
                "success": False,
                "error": f"Asset '{asset_id}' is not supported on {network_id}. "
                         f"Supported assets: {', '.join(supported_assets)}",
            }

        # Get CDP client and request faucet funds
        cdp_client = wallet_provider.get_client()

        import asyncio

        async def _request_faucet():
            async with cdp_client as cdp:
                token: Literal["eth", "usdc", "eurc", "cbbtc"] = asset_lower  # type: ignore
                tx_hash = await cdp.evm.request_faucet(
                    address=address,
                    token=token,
                    network=network_id,
                )
                return tx_hash

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        tx_hash = loop.run_until_complete(_request_faucet())

        return {
            "success": True,
            "message": f"Successfully requested {asset_id.upper()} from faucet",
            "transaction_hash": tx_hash,
            "address": address,
            "network": network_id,
            "asset": asset_id.upper(),
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to request faucet funds: {str(e)}",
        }


@tool
def check_faucet_eligibility() -> dict[str, Any]:
    """
    Check if the current wallet is eligible for faucet funds.

    Returns information about faucet availability for the current network
    and lists supported assets.

    Returns:
        Dictionary with eligibility status and supported assets
    """
    try:
        wallet_provider = _get_wallet_provider_sync()
        network = wallet_provider.get_network()
        network_id = network.network_id
        address = wallet_provider.get_address()

        is_eligible = network_id in SUPPORTED_FAUCET_NETWORKS
        supported_assets = SUPPORTED_FAUCET_ASSETS.get(network_id, [])

        return {
            "success": True,
            "eligible": is_eligible,
            "address": address,
            "network": network_id,
            "supported_assets": supported_assets if is_eligible else [],
            "message": (
                f"Wallet is eligible for faucet on {network_id}. "
                f"Available assets: {', '.join(supported_assets)}"
                if is_eligible
                else f"Faucet not available on {network_id}. "
                     f"Supported networks: {', '.join(SUPPORTED_FAUCET_NETWORKS)}"
            ),
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to check faucet eligibility: {str(e)}",
        }
