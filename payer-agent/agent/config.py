"""Configuration for the x402 payer agent."""

import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class AgentConfig:
    """Configuration for the payer agent."""

    # Bedrock model configuration
    model_id: str = "anthropic.claude-3-sonnet-20240229-v1:0"
    aws_region: str = "us-west-2"

    # CDP (Coinbase Developer Platform) configuration
    cdp_api_key_name: str = ""
    cdp_api_key_private_key: str = ""
    cdp_wallet_secret: str = ""

    # Network configuration
    network_id: str = "base-sepolia"

    # Seller API configuration
    seller_api_url: str = ""

    @classmethod
    def from_env(cls) -> "AgentConfig":
        """Load configuration from environment variables."""
        return cls(
            model_id=os.getenv("BEDROCK_MODEL_ID", cls.model_id),
            aws_region=os.getenv("AWS_REGION", cls.aws_region),
            cdp_api_key_name=os.getenv("CDP_API_KEY_ID", ""),
            cdp_api_key_private_key=os.getenv("CDP_API_KEY_SECRET", ""),
            cdp_wallet_secret=os.getenv("CDP_WALLET_SECRET", ""),
            network_id=os.getenv("NETWORK_ID", cls.network_id),
            seller_api_url=os.getenv("SELLER_API_URL", ""),
        )


# Global config instance
config = AgentConfig.from_env()
