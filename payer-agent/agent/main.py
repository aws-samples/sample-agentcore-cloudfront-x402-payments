"""Main agent definition for the x402 payer agent."""

from strands import Agent
from strands.models import BedrockModel

from .config import config
from .tools import (
    analyze_payment,
    sign_payment,
    get_wallet_balance,
    request_content,
    request_content_with_payment,
)

SYSTEM_PROMPT = """You are an AI payment agent that helps users access paid content using the x402 protocol.

Your capabilities:
1. Request content from seller APIs
2. Analyze payment requirements when you receive a 402 Payment Required response
3. Decide whether to approve payments based on value, price, and wallet balance
4. Sign payments using your blockchain wallet
5. Retry requests with signed payments to access content

Payment Decision Guidelines:
- Always check wallet balance before approving payments
- Evaluate if the price is reasonable for the content being offered
- Consider the risk level (recipient address validity, amount thresholds)
- Explain your reasoning when making payment decisions

Workflow for accessing paid content:
1. First, check your wallet balance using get_wallet_balance
2. Request the content using request_content
3. If you receive a 402 response, analyze the payment requirements
4. Use analyze_payment to decide if you should pay
5. If approved, use sign_payment to create a signed payment
6. Use request_content_with_payment to retry with the payment
7. Return the content to the user along with transaction details

Always be transparent about:
- Payment amounts and what they're for
- Your decision reasoning
- Transaction details after successful payments
"""


def create_payer_agent() -> Agent:
    """Create and configure the x402 payer agent."""
    model = BedrockModel(
        model_id=config.model_id,
        region_name=config.aws_region,
    )

    agent = Agent(
        model=model,
        tools=[
            analyze_payment,
            sign_payment,
            get_wallet_balance,
            request_content,
            request_content_with_payment,
        ],
        system_prompt=SYSTEM_PROMPT,
    )

    return agent


async def run_agent(user_message: str) -> str:
    """Run the agent with a user message and return the response."""
    agent = create_payer_agent()
    # Strands Agent is callable directly
    response = agent(user_message)
    return str(response)


# Entry point for local testing
if __name__ == "__main__":
    def main():
        agent = create_payer_agent()

        print("x402 Payer Agent initialized. Type 'quit' to exit.")
        print("-" * 50)

        while True:
            user_input = input("\nYou: ").strip()
            if user_input.lower() == "quit":
                break

            # Strands Agent is callable directly
            response = agent(user_input)
            print(f"\nAgent: {response}")

    main()
