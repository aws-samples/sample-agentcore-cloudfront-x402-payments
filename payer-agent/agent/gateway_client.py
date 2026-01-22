"""
AgentCore Gateway Client with IAM SigV4 Authentication.

This module provides a high-level client for invoking the AgentCore Gateway
with proper IAM SigV4 authentication. It supports both synchronous and
streaming responses, with built-in rate limiting.

Usage:
    from agent.gateway_client import GatewayClient
    
    # Create client
    client = GatewayClient(
        agent_id="your-agent-id",
        agent_alias_id="TSTALIASID",
        region="us-west-2"
    )
    
    # Invoke agent (rate limiting is automatic)
    response = client.invoke("Check my wallet balance")
    print(response.completion)
    
    # Interactive session
    async for chunk in client.invoke_streaming("Get premium content"):
        print(chunk, end="")
    
    # Check rate limit stats
    print(client.rate_limit_stats)
"""

import json
import uuid
from dataclasses import dataclass, field
from typing import AsyncIterator, Iterator, Optional

import boto3
from botocore.config import Config

from .auth import SigV4Auth, get_aws_credentials
from .rate_limiter import (
    RateLimiter,
    RateLimitConfig,
    RateLimitExceeded,
    RateLimitStats,
)


@dataclass
class InvocationResponse:
    """Response from an agent invocation."""
    success: bool
    completion: str = ""
    session_id: str = ""
    traces: list = field(default_factory=list)
    error: Optional[str] = None
    error_type: Optional[str] = None


@dataclass
class GatewayConfig:
    """Configuration for the Gateway client."""
    agent_id: str
    agent_alias_id: str = "TSTALIASID"
    region: str = "us-west-2"
    profile_name: Optional[str] = None
    max_retries: int = 3
    timeout_seconds: int = 300
    enable_trace: bool = False
    # Rate limiting configuration
    rate_limit_enabled: bool = True
    rate_limit_requests_per_second: float = 10.0
    rate_limit_burst_capacity: int = 20
    rate_limit_block_on_limit: bool = True


class GatewayClient:
    """
    Client for invoking AgentCore Gateway with IAM SigV4 authentication.
    
    This client handles:
    - IAM SigV4 request signing
    - Session management
    - Streaming response handling
    - Error handling and retries
    - Client-side rate limiting
    
    Attributes:
        config: Gateway configuration
        sigv4_auth: SigV4 authentication handler
        rate_limiter: Client-side rate limiter
    """
    
    def __init__(
        self,
        agent_id: str,
        agent_alias_id: str = "TSTALIASID",
        region: str = "us-west-2",
        profile_name: Optional[str] = None,
        max_retries: int = 3,
        timeout_seconds: int = 300,
        enable_trace: bool = False,
        rate_limit_enabled: bool = True,
        rate_limit_requests_per_second: float = 10.0,
        rate_limit_burst_capacity: int = 20,
        rate_limit_block_on_limit: bool = True,
    ):
        """
        Initialize the Gateway client.
        
        Args:
            agent_id: The AgentCore agent ID
            agent_alias_id: The agent alias ID (default: TSTALIASID for test)
            region: AWS region
            profile_name: Optional AWS profile name
            max_retries: Maximum retry attempts
            timeout_seconds: Request timeout
            enable_trace: Whether to include trace information
            rate_limit_enabled: Enable client-side rate limiting
            rate_limit_requests_per_second: Max requests per second
            rate_limit_burst_capacity: Burst capacity for rate limiter
            rate_limit_block_on_limit: Block when rate limited (vs raise exception)
        """
        self.config = GatewayConfig(
            agent_id=agent_id,
            agent_alias_id=agent_alias_id,
            region=region,
            profile_name=profile_name,
            max_retries=max_retries,
            timeout_seconds=timeout_seconds,
            enable_trace=enable_trace,
            rate_limit_enabled=rate_limit_enabled,
            rate_limit_requests_per_second=rate_limit_requests_per_second,
            rate_limit_burst_capacity=rate_limit_burst_capacity,
            rate_limit_block_on_limit=rate_limit_block_on_limit,
        )
        
        # Initialize SigV4 authentication
        self.sigv4_auth = SigV4Auth(
            region=region,
            service="bedrock-agent-runtime",
            profile_name=profile_name,
        )
        
        # Initialize rate limiter
        if rate_limit_enabled:
            rate_limit_config = RateLimitConfig(
                requests_per_second=rate_limit_requests_per_second,
                burst_capacity=rate_limit_burst_capacity,
                block_on_limit=rate_limit_block_on_limit,
            )
            self._rate_limiter = RateLimiter(rate_limit_config)
        else:
            self._rate_limiter = None
        
        # Create boto3 client with retry configuration
        boto_config = Config(
            region_name=region,
            retries={
                "max_attempts": max_retries,
                "mode": "adaptive",
            },
            read_timeout=timeout_seconds,
            connect_timeout=30,
        )
        
        if profile_name:
            session = boto3.Session(profile_name=profile_name)
            self._client = session.client("bedrock-agent-runtime", config=boto_config)
        else:
            self._client = boto3.client("bedrock-agent-runtime", config=boto_config)
    
    @property
    def rate_limit_stats(self) -> Optional[RateLimitStats]:
        """Get rate limiting statistics."""
        if self._rate_limiter:
            return self._rate_limiter.stats
        return None
    
    def _apply_rate_limit(self) -> float:
        """
        Apply rate limiting before making a request.
        
        Returns:
            Time spent waiting (0 if no wait or rate limiting disabled).
            
        Raises:
            RateLimitExceeded: If rate limit exceeded and blocking is disabled.
        """
        if self._rate_limiter:
            return self._rate_limiter.acquire()
        return 0.0
    
    def invoke(
        self,
        input_text: str,
        session_id: Optional[str] = None,
        enable_trace: Optional[bool] = None,
    ) -> InvocationResponse:
        """
        Invoke the agent with the given input.
        
        Rate limiting is applied automatically if enabled.
        
        Args:
            input_text: The user's input message
            session_id: Optional session ID for conversation context
            enable_trace: Override default trace setting
            
        Returns:
            InvocationResponse with the agent's response
            
        Raises:
            RateLimitExceeded: If rate limit exceeded and blocking is disabled.
        """
        session_id = session_id or str(uuid.uuid4())
        enable_trace = enable_trace if enable_trace is not None else self.config.enable_trace
        
        # Apply rate limiting
        try:
            wait_time = self._apply_rate_limit()
            if wait_time > 0:
                # Log that we waited for rate limiting
                pass
        except RateLimitExceeded as e:
            return InvocationResponse(
                success=False,
                session_id=session_id,
                error=str(e),
                error_type="RateLimitExceeded",
            )
        
        try:
            response = self._client.invoke_agent(
                agentId=self.config.agent_id,
                agentAliasId=self.config.agent_alias_id,
                sessionId=session_id,
                inputText=input_text,
                enableTrace=enable_trace,
            )
            
            # Process streaming response
            completion = ""
            traces = []
            
            for event in response.get("completion", []):
                if "chunk" in event:
                    chunk_data = event["chunk"]
                    if "bytes" in chunk_data:
                        completion += chunk_data["bytes"].decode("utf-8")
                if "trace" in event and enable_trace:
                    traces.append(event["trace"])
            
            return InvocationResponse(
                success=True,
                completion=completion,
                session_id=session_id,
                traces=traces,
            )
            
        except self._client.exceptions.ValidationException as e:
            return InvocationResponse(
                success=False,
                session_id=session_id,
                error=f"Validation error: {str(e)}",
                error_type="ValidationException",
            )
        except self._client.exceptions.ResourceNotFoundException as e:
            return InvocationResponse(
                success=False,
                session_id=session_id,
                error=f"Agent not found: {str(e)}",
                error_type="ResourceNotFoundException",
            )
        except self._client.exceptions.ThrottlingException as e:
            return InvocationResponse(
                success=False,
                session_id=session_id,
                error=f"Rate limited by server: {str(e)}",
                error_type="ThrottlingException",
            )
        except self._client.exceptions.AccessDeniedException as e:
            return InvocationResponse(
                success=False,
                session_id=session_id,
                error=f"Access denied - check IAM permissions: {str(e)}",
                error_type="AccessDeniedException",
            )
        except Exception as e:
            return InvocationResponse(
                success=False,
                session_id=session_id,
                error=str(e),
                error_type=type(e).__name__,
            )
    
    def invoke_streaming(
        self,
        input_text: str,
        session_id: Optional[str] = None,
    ) -> Iterator[str]:
        """
        Invoke the agent and yield response chunks as they arrive.
        
        Rate limiting is applied automatically if enabled.
        
        Args:
            input_text: The user's input message
            session_id: Optional session ID for conversation context
            
        Yields:
            Response text chunks as they arrive
            
        Raises:
            RateLimitExceeded: If rate limit exceeded and blocking is disabled.
        """
        session_id = session_id or str(uuid.uuid4())
        
        # Apply rate limiting
        self._apply_rate_limit()
        
        response = self._client.invoke_agent(
            agentId=self.config.agent_id,
            agentAliasId=self.config.agent_alias_id,
            sessionId=session_id,
            inputText=input_text,
            enableTrace=False,
        )
        
        for event in response.get("completion", []):
            if "chunk" in event:
                chunk_data = event["chunk"]
                if "bytes" in chunk_data:
                    yield chunk_data["bytes"].decode("utf-8")
    
    def get_auth_headers(self, url: str, body: str = "") -> dict[str, str]:
        """
        Get SigV4-signed headers for a custom request.
        
        This is useful when making direct HTTP requests to the Gateway
        instead of using the boto3 client.
        
        Args:
            url: The request URL
            body: The request body
            
        Returns:
            Dictionary of signed headers
        """
        return self.sigv4_auth.sign_request(
            method="POST",
            url=url,
            headers={"Content-Type": "application/json"},
            body=body,
        )
    
    def verify_credentials(self) -> bool:
        """
        Verify that AWS credentials are valid and have necessary permissions.
        
        Returns:
            True if credentials are valid, False otherwise
        """
        try:
            # Try to get caller identity
            sts = boto3.client("sts")
            identity = sts.get_caller_identity()
            return True
        except Exception:
            return False
    
    def get_caller_identity(self) -> Optional[dict]:
        """
        Get the AWS caller identity for debugging.
        
        Returns:
            Dictionary with Account, Arn, and UserId, or None if failed
        """
        try:
            sts = boto3.client("sts")
            return sts.get_caller_identity()
        except Exception:
            return None


def create_gateway_client(
    agent_id: str,
    agent_alias_id: str = "TSTALIASID",
    region: str = "us-west-2",
    rate_limit_enabled: bool = True,
    rate_limit_requests_per_second: float = 10.0,
    rate_limit_burst_capacity: int = 20,
    **kwargs,
) -> GatewayClient:
    """
    Factory function to create a Gateway client.
    
    Args:
        agent_id: The AgentCore agent ID
        agent_alias_id: The agent alias ID
        region: AWS region
        rate_limit_enabled: Enable client-side rate limiting
        rate_limit_requests_per_second: Max requests per second
        rate_limit_burst_capacity: Burst capacity for rate limiter
        **kwargs: Additional configuration options
        
    Returns:
        Configured GatewayClient instance
    """
    return GatewayClient(
        agent_id=agent_id,
        agent_alias_id=agent_alias_id,
        region=region,
        rate_limit_enabled=rate_limit_enabled,
        rate_limit_requests_per_second=rate_limit_requests_per_second,
        rate_limit_burst_capacity=rate_limit_burst_capacity,
        **kwargs,
    )
