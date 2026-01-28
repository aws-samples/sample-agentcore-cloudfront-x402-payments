"""Tools for the x402 payer agent.

This module organizes tools into categories:

1. Core Payment Tools:
   - analyze_payment: Analyze payment requirements and decide whether to pay
   - sign_payment: Sign a payment using the AgentKit wallet
   - get_wallet_balance: Get current wallet balance
   - request_faucet_funds: Request testnet tokens from faucet
   - check_faucet_eligibility: Check if wallet is eligible for faucet

2. Content Tools:
   - request_content: Request content from seller API
   - request_content_with_payment: Request content with signed payment
"""

# Core payment tools
from .payment import (
    analyze_payment,
    sign_payment,
    get_wallet_balance,
    request_faucet_funds,
    check_faucet_eligibility,
)

# Content tools
from .content import request_content, request_content_with_payment

# Export core tools as the primary interface
CORE_TOOLS = [
    analyze_payment,
    sign_payment,
    get_wallet_balance,
]

# Faucet tools (for testnet use)
FAUCET_TOOLS = [
    request_faucet_funds,
    check_faucet_eligibility,
]

# Content tools
CONTENT_TOOLS = [
    request_content,
    request_content_with_payment,
]

__all__ = [
    # Core payment tools
    "analyze_payment",
    "sign_payment",
    "get_wallet_balance",
    # Faucet tools
    "request_faucet_funds",
    "check_faucet_eligibility",
    # Content tools
    "request_content",
    "request_content_with_payment",
    # Tool collections
    "CORE_TOOLS",
    "FAUCET_TOOLS",
    "CONTENT_TOOLS",
]
