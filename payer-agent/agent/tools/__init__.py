"""Tools for the x402 payer agent.

This module organizes tools into two categories:

1. Core Payment Tools (always available):
   - analyze_payment: Analyze payment requirements and decide whether to pay
   - sign_payment: Sign a payment using the AgentKit wallet
   - get_wallet_balance: Get current wallet balance
   - request_faucet_funds: Request testnet tokens from faucet
   - check_faucet_eligibility: Check if wallet is eligible for faucet

2. Content Tools (legacy - to be replaced by MCP discovery):
   - request_content: Request content from seller API
   - request_content_with_payment: Request content with signed payment
   
   Note: Content tools are being migrated to MCP discovery via Gateway.
   The legacy content tools remain available for backward compatibility
   but should not be used in new implementations.
"""

# Core payment tools - always available to the agent
from .payment import (
    analyze_payment,
    sign_payment,
    get_wallet_balance,
    request_faucet_funds,
    check_faucet_eligibility,
)

# Legacy content tools - to be replaced by MCP discovery
# These are kept for backward compatibility during migration
from .content import request_content, request_content_with_payment

# Export core tools as the primary interface
CORE_TOOLS = [
    analyze_payment,
    sign_payment,
    get_wallet_balance,
]

# Faucet tools (optional, for testnet use)
FAUCET_TOOLS = [
    request_faucet_funds,
    check_faucet_eligibility,
]

# Legacy content tools (deprecated - use MCP discovery instead)
LEGACY_CONTENT_TOOLS = [
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
    # Legacy content tools (deprecated)
    "request_content",
    "request_content_with_payment",
    # Tool collections
    "CORE_TOOLS",
    "FAUCET_TOOLS",
    "LEGACY_CONTENT_TOOLS",
]
