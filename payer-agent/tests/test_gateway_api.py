"""
Tests for Gateway API access functionality.

These tests verify that the AgentCore Gateway API access works correctly,
including credential handling, SigV4 authentication, and client operations.
"""

import pytest
from unittest.mock import MagicMock, patch
import datetime


class TestGatewayClientConfiguration:
    """Tests for Gateway client configuration."""

    def test_gateway_client_default_config(self):
        """Test Gateway client with default configuration."""
        from agent.gateway_client import GatewayClient, GatewayConfig
        
        # Mock credentials to avoid actual AWS calls
        mock_creds = MagicMock()
        mock_creds.access_key = "AKIATEST"
        mock_creds.secret_key = "testsecret"
        mock_creds.token = None
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client"):
                client = GatewayClient(
                    agent_id="test-agent-123",
                )
                
                assert client.config.agent_id == "test-agent-123"
                assert client.config.agent_alias_id == "TSTALIASID"
                assert client.config.region == "us-west-2"
                assert client.config.rate_limit_enabled is True

    def test_gateway_client_custom_config(self):
        """Test Gateway client with custom configuration."""
        from agent.gateway_client import GatewayClient
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client"):
                client = GatewayClient(
                    agent_id="custom-agent",
                    agent_alias_id="PRODALIASID",
                    region="us-east-1",
                    max_retries=5,
                    timeout_seconds=600,
                    rate_limit_enabled=False,
                )
                
                assert client.config.agent_id == "custom-agent"
                assert client.config.agent_alias_id == "PRODALIASID"
                assert client.config.region == "us-east-1"
                assert client.config.max_retries == 5
                assert client.config.timeout_seconds == 600
                assert client.config.rate_limit_enabled is False


class TestGatewayClientRateLimiting:
    """Tests for Gateway client rate limiting."""

    def test_rate_limiter_stats_available(self):
        """Test that rate limiter stats are available when enabled."""
        from agent.gateway_client import GatewayClient
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client"):
                client = GatewayClient(
                    agent_id="test-agent",
                    rate_limit_enabled=True,
                )
                
                stats = client.rate_limit_stats
                assert stats is not None
                assert stats.total_requests == 0

    def test_rate_limiter_disabled(self):
        """Test that rate limiter stats are None when disabled."""
        from agent.gateway_client import GatewayClient
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client"):
                client = GatewayClient(
                    agent_id="test-agent",
                    rate_limit_enabled=False,
                )
                
                assert client.rate_limit_stats is None


class TestGatewayClientInvocation:
    """Tests for Gateway client invocation."""

    def test_invoke_success(self):
        """Test successful agent invocation."""
        from agent.gateway_client import GatewayClient
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        # Mock the bedrock client response
        mock_bedrock_client = MagicMock()
        mock_bedrock_client.invoke_agent.return_value = {
            "completion": [
                {"chunk": {"bytes": b"Hello, "}},
                {"chunk": {"bytes": b"world!"}},
            ]
        }
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client", return_value=mock_bedrock_client):
                client = GatewayClient(
                    agent_id="test-agent",
                    rate_limit_enabled=False,
                )
                
                response = client.invoke("Test message")
                
                assert response.success is True
                assert response.completion == "Hello, world!"
                assert response.session_id is not None

    def test_invoke_validation_error(self):
        """Test handling of validation errors."""
        from agent.gateway_client import GatewayClient
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        # Mock validation exception
        mock_bedrock_client = MagicMock()
        mock_bedrock_client.exceptions.ValidationException = type(
            "ValidationException", (Exception,), {}
        )
        mock_bedrock_client.invoke_agent.side_effect = (
            mock_bedrock_client.exceptions.ValidationException("Invalid input")
        )
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client", return_value=mock_bedrock_client):
                client = GatewayClient(
                    agent_id="test-agent",
                    rate_limit_enabled=False,
                )
                client._client = mock_bedrock_client
                
                response = client.invoke("Test message")
                
                assert response.success is False
                assert response.error_type == "ValidationException"

    def test_invoke_resource_not_found(self):
        """Test handling of resource not found errors."""
        from agent.gateway_client import GatewayClient
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        # Mock resource not found exception - use a real Exception subclass
        class ResourceNotFoundException(Exception):
            pass
        
        mock_bedrock_client = MagicMock()
        mock_bedrock_client.exceptions.ValidationException = type(
            "ValidationException", (Exception,), {}
        )
        mock_bedrock_client.exceptions.ResourceNotFoundException = ResourceNotFoundException
        mock_bedrock_client.exceptions.ThrottlingException = type(
            "ThrottlingException", (Exception,), {}
        )
        mock_bedrock_client.exceptions.AccessDeniedException = type(
            "AccessDeniedException", (Exception,), {}
        )
        mock_bedrock_client.invoke_agent.side_effect = ResourceNotFoundException("Agent not found")
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client", return_value=mock_bedrock_client):
                client = GatewayClient(
                    agent_id="nonexistent-agent",
                    rate_limit_enabled=False,
                )
                client._client = mock_bedrock_client
                
                response = client.invoke("Test message")
                
                assert response.success is False
                assert response.error_type == "ResourceNotFoundException"


class TestGatewayClientCredentials:
    """Tests for Gateway client credential verification."""

    def test_verify_credentials_success(self):
        """Test successful credential verification."""
        from agent.gateway_client import GatewayClient
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {
            "Account": "123456789012",
            "Arn": "arn:aws:iam::123456789012:user/test",
            "UserId": "AIDATEST",
        }
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client") as mock_client:
                # Return different clients for different services
                def client_factory(service, **kwargs):
                    if service == "sts":
                        return mock_sts
                    return MagicMock()
                
                mock_client.side_effect = client_factory
                
                client = GatewayClient(
                    agent_id="test-agent",
                    rate_limit_enabled=False,
                )
                
                with patch("agent.gateway_client.boto3.client", return_value=mock_sts):
                    is_valid = client.verify_credentials()
                    assert is_valid is True

    def test_get_caller_identity(self):
        """Test getting caller identity."""
        from agent.gateway_client import GatewayClient
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        expected_identity = {
            "Account": "123456789012",
            "Arn": "arn:aws:iam::123456789012:user/test",
            "UserId": "AIDATEST",
        }
        
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = expected_identity
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client"):
                client = GatewayClient(
                    agent_id="test-agent",
                    rate_limit_enabled=False,
                )
                
                with patch("agent.gateway_client.boto3.client", return_value=mock_sts):
                    identity = client.get_caller_identity()
                    
                    assert identity is not None
                    assert identity["Account"] == "123456789012"


class TestGatewayClientAuthHeaders:
    """Tests for Gateway client auth header generation."""

    def test_get_auth_headers(self):
        """Test getting SigV4 auth headers."""
        from agent.gateway_client import GatewayClient
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client"):
                with patch("agent.auth.sigv4.datetime") as mock_datetime:
                    mock_datetime.datetime.utcnow.return_value = datetime.datetime(
                        2024, 1, 15, 12, 0, 0
                    )
                    
                    client = GatewayClient(
                        agent_id="test-agent",
                        rate_limit_enabled=False,
                    )
                    
                    headers = client.get_auth_headers(
                        url="https://bedrock-agent-runtime.us-west-2.amazonaws.com/test",
                        body='{"test": "data"}',
                    )
                    
                    assert "authorization" in headers
                    assert "x-amz-date" in headers
                    assert headers["authorization"].startswith("AWS4-HMAC-SHA256")


class TestCreateGatewayClient:
    """Tests for create_gateway_client factory function."""

    def test_create_gateway_client_factory(self):
        """Test the factory function creates a client correctly."""
        from agent.gateway_client import create_gateway_client
        
        mock_frozen = MagicMock()
        mock_frozen.access_key = "AKIATEST"
        mock_frozen.secret_key = "testsecret"
        mock_frozen.token = None
        
        mock_creds_obj = MagicMock()
        mock_creds_obj.get_frozen_credentials.return_value = mock_frozen
        
        mock_session = MagicMock()
        mock_session.get_credentials.return_value = mock_creds_obj
        
        with patch("agent.auth.sigv4.boto3.Session", return_value=mock_session):
            with patch("agent.gateway_client.boto3.client"):
                client = create_gateway_client(
                    agent_id="factory-test-agent",
                    region="eu-west-1",
                    rate_limit_requests_per_second=5.0,
                )
                
                assert client.config.agent_id == "factory-test-agent"
                assert client.config.region == "eu-west-1"
                assert client.config.rate_limit_requests_per_second == 5.0
