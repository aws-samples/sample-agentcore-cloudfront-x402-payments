"""Configuration for the x402 payer agent."""

import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class AgentConfig:
    """Configuration for the payer agent."""

    # AgentCore Runtime configuration
    agent_runtime_arn: str = ""
    aws_region: str = "us-west-2"

    # Bedrock model configuration (for local development)
    # Use cross-region inference profile for Claude Sonnet
    model_id: str = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"

    # AgentCore Payments configuration
    payment_manager_arn: str = ""        # Full ARN of the PaymentManager
    payment_session_id: str = ""         # Pre-created by app backend
    payment_instrument_id: str = ""      # Pre-created by app backend
    process_payment_role_arn: str = ""   # IAM role ARN for ProcessPayment
    user_id: str = ""                    # End-user identifier (required for all DP APIs)
    dp_endpoint: str = ""               # Optional — boto3 auto-resolves from region

    # Seller API configuration
    seller_api_url: str = ""
    # Optional allowlist of seller wallet addresses. When set, process_payment refuses any
    # payment requirement whose payTo is not in this list.
    seller_pay_to_addresses: tuple[str, ...] = ()

    # OpenTelemetry configuration
    otel_endpoint: str = ""
    otel_console_export: bool = False

    @classmethod
    def from_env(cls) -> "AgentConfig":
        """Load configuration from environment variables."""
        return cls(
            agent_runtime_arn=os.getenv("AGENT_RUNTIME_ARN", ""),
            aws_region=os.getenv("AWS_REGION", cls.aws_region),
            model_id=os.getenv("BEDROCK_MODEL_ID", cls.model_id),
            payment_manager_arn=os.getenv("MANAGER_ARN", ""),
            payment_session_id=os.getenv("PAYMENT_SESSION_ID", ""),
            payment_instrument_id=os.getenv("PAYMENT_INSTRUMENT_ID", ""),
            process_payment_role_arn=os.getenv("PROCESS_PAYMENT_ROLE_ARN", ""),
            user_id=os.getenv("USER_ID", ""),
            dp_endpoint=os.getenv("DP_ENDPOINT", ""),
            seller_api_url=os.getenv("SELLER_API_URL", ""),
            seller_pay_to_addresses=tuple(
                address.strip()
                for address in os.getenv("SELLER_PAY_TO_ADDRESSES", "").split(",")
                if address.strip()
            ),
            otel_endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
            otel_console_export=os.getenv("OTEL_CONSOLE_EXPORT", "").lower() == "true",
        )


# Global config instance
config = AgentConfig.from_env()
