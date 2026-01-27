"""Main agent definition for the x402 payer agent.

This module defines the payer agent that handles x402 payment flows.
The agent uses:
- Core payment tools (hardcoded): analyze_payment, sign_payment, get_wallet_balance
- Content tools (MCP-discovered): Discovered dynamically via Gateway MCP endpoint

The separation allows the agent to:
1. Always have payment capabilities available (core tools)
2. Discover available content endpoints dynamically (MCP tools)
"""

from typing import Callable, Optional

from strands import Agent
from strands.models import BedrockModel

from .config import config
from .tracing import init_tracing, get_tracer
from .tools.payment import (
    analyze_payment,
    sign_payment,
    get_wallet_balance,
)
from .mcp_client import MCPClient, discover_mcp_tools, get_mcp_client

# Core payment tools that are always available to the agent
# These handle the x402 payment negotiation and wallet operations
CORE_TOOLS = [
    analyze_payment,
    sign_payment,
    get_wallet_balance,
]

SYSTEM_PROMPT = """You are an AI payment agent that helps users access paid content using the x402 protocol.

## Core Tools (Always Available)
These tools are built into the agent and always available:
- get_wallet_balance: Check your USDC balance on Base Sepolia testnet
- analyze_payment: Evaluate payment requests and decide whether to approve
- sign_payment: Sign blockchain transactions using your AgentKit wallet

## Discoverable Content Tools (MCP Protocol)
Content tools are discovered dynamically via MCP (Model Context Protocol) from the Gateway.
The available tools depend on what content endpoints are registered with the Gateway.

Typical discoverable content tools include:
- get_premium_article: Premium articles (0.001 USDC)
- get_weather_data: Real-time weather and forecasts (0.0005 USDC)
- get_market_analysis: Cryptocurrency market data and sentiment (0.002 USDC)
- get_research_report: In-depth blockchain research reports (0.005 USDC)

Each content tool:
- Requires x402 payment - you'll receive a 402 response with payment details
- Accepts an optional payment_payload parameter for retry after signing
- Returns content on successful payment, or payment requirements on 402

## Payment Decision Guidelines
- Always check wallet balance before approving payments
- Evaluate if the price is reasonable for the content being offered
- Consider the risk level (recipient address validity, amount thresholds)
- Explain your reasoning when making payment decisions
- Payments are on Base Sepolia testnet using USDC

## Workflow for Accessing Paid Content
1. Check your wallet balance using get_wallet_balance
2. Call the appropriate content tool (no payment_payload initially)
3. When you receive a 402 response, extract the payment requirements:
   - scheme: payment scheme (usually "exact")
   - network: blockchain network (e.g., "eip155:84532")
   - amount: payment amount in atomic units
   - currency: token name (e.g., "USDC")
   - recipient: payTo address
4. Use analyze_payment to evaluate the payment:
   - Pass amount, currency, recipient, description, and wallet_balance
   - Review the approval decision and reasoning
5. If approved, use sign_payment to create a signed payment:
   - Pass scheme, network, amount, and recipient
   - Receive a payload object with the signed transaction
6. Call the content tool again with payment_payload set to the 'payload' field from sign_payment
7. Return the content to the user along with transaction details

## Transparency Requirements
Always be transparent about:
- Payment amounts and what they're for
- Your decision reasoning (why you approved or rejected)
- Transaction details after successful payments
- Any errors or issues encountered
"""


def create_payer_agent(
    additional_tools: Optional[list[Callable]] = None,
    custom_system_prompt: Optional[str] = None,
) -> Agent:
    """Create and configure the x402 payer agent.
    
    Args:
        additional_tools: Optional list of additional tools to add to the agent.
                         These are typically MCP-discovered content tools.
        custom_system_prompt: Optional custom system prompt to override the default.
    
    Returns:
        Configured Agent instance with core payment tools and any additional tools.
    """
    # Initialize tracing
    init_tracing(
        service_name="x402-payer-agent",
        enable_console_export=config.otel_console_export,
    )
    
    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
    )

    # Combine core tools with any additional (MCP-discovered) tools
    tools = list(CORE_TOOLS)
    if additional_tools:
        tools.extend(additional_tools)

    agent = Agent(
        model=model,
        tools=tools,
        system_prompt=custom_system_prompt or SYSTEM_PROMPT,
    )

    return agent


async def create_payer_agent_with_mcp(
    gateway_url: Optional[str] = None,
    custom_system_prompt: Optional[str] = None,
    force_discovery: bool = False,
) -> Agent:
    """Create a payer agent with MCP-discovered tools.
    
    This function discovers tools from the Gateway MCP endpoint and
    creates an agent with both core payment tools and discovered content tools.
    
    Args:
        gateway_url: Optional Gateway URL for MCP discovery.
                    Uses config.seller_api_url if not provided.
        custom_system_prompt: Optional custom system prompt.
        force_discovery: Force tool discovery even if cached.
    
    Returns:
        Configured Agent instance with core and MCP-discovered tools.
        
    Raises:
        RuntimeError: If MCP tool discovery fails.
    """
    # Discover MCP tools
    mcp_tools = await discover_mcp_tools(
        gateway_url=gateway_url,
        force_refresh=force_discovery,
    )
    
    # Create agent with discovered tools
    return create_payer_agent(
        additional_tools=mcp_tools,
        custom_system_prompt=custom_system_prompt,
    )


def get_core_tools() -> list[Callable]:
    """Get the list of core payment tools.
    
    These tools are always available to the agent and handle
    x402 payment negotiation and wallet operations.
    
    Returns:
        List of core tool functions.
    """
    return list(CORE_TOOLS)


async def run_agent(user_message: str, additional_tools: Optional[list[Callable]] = None) -> str:
    """Run the agent with a user message and return the response.
    
    Args:
        user_message: The user's input message.
        additional_tools: Optional list of additional tools (e.g., MCP-discovered tools).
    
    Returns:
        The agent's response as a string.
    """
    agent = create_payer_agent(additional_tools=additional_tools)
    tracer = get_tracer()
    
    with tracer.start_as_current_span("agent.run") as span:
        span.set_attribute("agent.message_length", len(user_message))
        span.set_attribute("agent.core_tools_count", len(CORE_TOOLS))
        span.set_attribute("agent.additional_tools_count", len(additional_tools) if additional_tools else 0)
        # Strands Agent is callable directly
        response = agent(user_message)
        span.set_attribute("agent.response_length", len(str(response)))
        return str(response)


async def run_agent_with_mcp(
    user_message: str,
    gateway_url: Optional[str] = None,
    force_discovery: bool = False,
) -> str:
    """Run the agent with MCP-discovered tools.
    
    This function discovers tools from the Gateway MCP endpoint,
    creates an agent with those tools, and runs it with the user message.
    
    Args:
        user_message: The user's input message.
        gateway_url: Optional Gateway URL for MCP discovery.
        force_discovery: Force tool discovery even if cached.
    
    Returns:
        The agent's response as a string.
        
    Raises:
        RuntimeError: If MCP tool discovery fails.
    """
    agent = await create_payer_agent_with_mcp(
        gateway_url=gateway_url,
        force_discovery=force_discovery,
    )
    tracer = get_tracer()
    
    mcp_client = get_mcp_client()
    mcp_tools_count = len(mcp_client.get_strands_tools())
    
    with tracer.start_as_current_span("agent.run_with_mcp") as span:
        span.set_attribute("agent.message_length", len(user_message))
        span.set_attribute("agent.core_tools_count", len(CORE_TOOLS))
        span.set_attribute("agent.mcp_tools_count", mcp_tools_count)
        # Strands Agent is callable directly
        response = agent(user_message)
        span.set_attribute("agent.response_length", len(str(response)))
        return str(response)


# Entry point for local testing
if __name__ == "__main__":
    import asyncio
    
    async def main():
        # For local testing, try to discover MCP tools
        print("x402 Payer Agent initializing...")
        print("Core tools: analyze_payment, sign_payment, get_wallet_balance")
        
        try:
            # Try to discover MCP tools
            mcp_tools = await discover_mcp_tools()
            print(f"Discovered {len(mcp_tools)} MCP tools")
            for tool in mcp_tools:
                print(f"  - {tool.__name__}")
            
            agent = create_payer_agent(additional_tools=mcp_tools)
        except Exception as e:
            print(f"MCP discovery failed: {e}")
            print("Running with core tools only.")
            agent = create_payer_agent()
        
        print("-" * 50)
        print("Type 'quit' to exit.")

        while True:
            user_input = input("\nYou: ").strip()
            if user_input.lower() == "quit":
                break

            # Strands Agent is callable directly
            response = agent(user_input)
            print(f"\nAgent: {response}")

    asyncio.run(main())
