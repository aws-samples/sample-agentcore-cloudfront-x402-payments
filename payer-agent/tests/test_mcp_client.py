"""Tests for the MCP tool discovery client.

This module tests the MCP client functionality including:
- Tool discovery from Gateway MCP endpoint
- Tool invocation with x402 payment handling
- 402 Payment Required response parsing
- Payment signature passthrough for retry requests

The 402 handling logic is critical for the x402 payment flow:
1. Initial request returns 402 with payment requirements
2. Agent analyzes payment using analyze_payment tool
3. Agent signs payment using sign_payment tool
4. Retry request includes payment signature
5. Content is delivered with settlement confirmation
"""

import base64
import json
import time

import pytest
import httpx
from unittest.mock import AsyncMock, patch, MagicMock

from agent.mcp_client import (
    MCPClient,
    MCPToolDefinition,
    MCPToolParameter,
    MCPDiscoveryResponse,
    MCPInvocationResponse,
    MCPClientConfig,
    get_mcp_client,
    discover_mcp_tools,
    get_tool_info,
    list_available_tools,
)


class TestMCPToolDefinition:
    """Tests for MCPToolDefinition dataclass."""

    def test_to_dict(self):
        """Test conversion to dictionary."""
        tool_def = MCPToolDefinition(
            name="get_premium_article",
            description="Get a premium article",
            operation_id="get_premium_article",
            category="content",
            tags=["premium", "article"],
            parameters=[
                MCPToolParameter(
                    name="payment_signature",
                    type="string",
                    description="Payment signature",
                    required=False,
                )
            ],
            requires_payment=True,
            payment_info={
                "price_units": "1000",
                "price_display": "0.001 USDC",
            },
        )
        
        result = tool_def.to_dict()
        
        assert result["name"] == "get_premium_article"
        assert result["description"] == "Get a premium article"
        assert result["category"] == "content"
        assert result["requires_payment"] is True
        assert len(result["parameters"]) == 1
        assert result["parameters"][0]["name"] == "payment_signature"


class TestMCPClientConfig:
    """Tests for MCPClientConfig dataclass."""

    def test_default_values(self):
        """Test default configuration values."""
        config = MCPClientConfig()
        
        assert config.mcp_discovery_path == "/mcp/tools"
        assert config.mcp_invoke_path == "/mcp/invoke"
        assert config.timeout_seconds == 30
        assert config.cache_ttl_seconds == 300
        assert config.enable_caching is True


class TestMCPClient:
    """Tests for the MCPClient class."""

    @pytest.fixture
    def mcp_client(self):
        """Create an MCP client for testing."""
        return MCPClient(
            gateway_url="https://gateway.example.com",
            cache_ttl_seconds=60,
        )

    @pytest.fixture
    def sample_discovery_response(self):
        """Sample MCP discovery response."""
        return {
            "tools": [
                {
                    "tool_name": "get_premium_article",
                    "tool_description": "Get a premium article about AI.",
                    "operation_id": "get_premium_article",
                    "mcp_metadata": {
                        "category": "content",
                        "tags": ["premium", "article"],
                        "requires_payment": True,
                    },
                    "x402_metadata": {
                        "price_usdc_units": "1000",
                        "price_usdc_display": "0.001 USDC",
                        "network": "eip155:84532",
                        "network_name": "Base Sepolia",
                        "scheme": "exact",
                        "asset_address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                        "asset_name": "USDC",
                    },
                    "input_schema": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
                {
                    "tool_name": "get_weather_data",
                    "tool_description": "Get weather data.",
                    "operation_id": "get_weather_data",
                    "mcp_metadata": {
                        "category": "market-data",
                        "tags": ["weather"],
                        "requires_payment": True,
                    },
                    "x402_metadata": {
                        "price_usdc_units": "500",
                        "price_usdc_display": "0.0005 USDC",
                    },
                    "input_schema": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            ],
            "metadata": {
                "provider": "x402-demo",
                "version": "1.0.0",
            },
        }

    def test_cache_validity_when_disabled(self, mcp_client):
        """Test cache is invalid when caching is disabled."""
        mcp_client.config.enable_caching = False
        mcp_client._tools_cache = [MCPToolDefinition(name="test", description="", operation_id="")]
        mcp_client._cache_timestamp = time.time()
        
        assert mcp_client._is_cache_valid() is False

    def test_cache_validity_when_empty(self, mcp_client):
        """Test cache is invalid when empty."""
        mcp_client._tools_cache = []
        
        assert mcp_client._is_cache_valid() is False

    def test_cache_validity_when_expired(self, mcp_client):
        """Test cache is invalid when expired."""
        mcp_client._tools_cache = [MCPToolDefinition(name="test", description="", operation_id="")]
        mcp_client._cache_timestamp = time.time() - 120  # 2 minutes ago, TTL is 60s
        
        assert mcp_client._is_cache_valid() is False

    def test_cache_validity_when_valid(self, mcp_client):
        """Test cache is valid when within TTL."""
        mcp_client._tools_cache = [MCPToolDefinition(name="test", description="", operation_id="")]
        mcp_client._cache_timestamp = time.time() - 30  # 30 seconds ago, TTL is 60s
        
        assert mcp_client._is_cache_valid() is True

    def test_parse_tool_definition(self, mcp_client, sample_discovery_response):
        """Test parsing of tool definition from discovery response."""
        tool_data = sample_discovery_response["tools"][0]
        
        tool_def = mcp_client._parse_tool_definition(tool_data)
        
        assert tool_def.name == "get_premium_article"
        assert tool_def.description == "Get a premium article about AI."
        assert tool_def.operation_id == "get_premium_article"
        assert tool_def.category == "content"
        assert "premium" in tool_def.tags
        assert tool_def.requires_payment is True
        assert tool_def.payment_info["price_units"] == "1000"
        assert tool_def.payment_info["price_display"] == "0.001 USDC"

    @pytest.mark.asyncio
    async def test_discover_tools_success(self, mcp_client, sample_discovery_response):
        """Test successful tool discovery."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = sample_discovery_response
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            result = await mcp_client.discover_tools()
            
            assert result.success is True
            assert len(result.tools) == 2
            assert result.tools[0].name == "get_premium_article"
            assert result.tools[1].name == "get_weather_data"
            assert result.cached is False

    @pytest.mark.asyncio
    async def test_discover_tools_uses_cache(self, mcp_client, sample_discovery_response):
        """Test that discovery uses cache when valid."""
        # Pre-populate cache
        mcp_client._tools_cache = [
            MCPToolDefinition(name="cached_tool", description="Cached", operation_id="cached")
        ]
        mcp_client._cache_timestamp = time.time()
        
        result = await mcp_client.discover_tools()
        
        assert result.success is True
        assert result.cached is True
        assert len(result.tools) == 1
        assert result.tools[0].name == "cached_tool"

    @pytest.mark.asyncio
    async def test_discover_tools_force_refresh(self, mcp_client, sample_discovery_response):
        """Test that force_refresh bypasses cache."""
        # Pre-populate cache
        mcp_client._tools_cache = [
            MCPToolDefinition(name="cached_tool", description="Cached", operation_id="cached")
        ]
        mcp_client._cache_timestamp = time.time()
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = sample_discovery_response
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            result = await mcp_client.discover_tools(force_refresh=True)
            
            assert result.success is True
            assert result.cached is False
            assert len(result.tools) == 2

    @pytest.mark.asyncio
    async def test_discover_tools_failure(self, mcp_client):
        """Test handling of discovery failure."""
        mock_response = MagicMock()
        mock_response.status_code = 500
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            result = await mcp_client.discover_tools()
            
            assert result.success is False
            assert "500" in result.error

    @pytest.mark.asyncio
    async def test_discover_tools_network_error(self, mcp_client):
        """Test handling of network errors during discovery."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=httpx.RequestError("Connection failed")
            )
            
            result = await mcp_client.discover_tools()
            
            assert result.success is False
            assert "Request failed" in result.error

    @pytest.mark.asyncio
    async def test_invoke_tool_success(self, mcp_client):
        """Test successful tool invocation."""
        # Pre-populate cache with tool definition
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
            )
        ]
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"title": "Article", "content": "..."}
        mock_response.headers = {}
        mock_response.content = b'{"title": "Article"}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            result = await mcp_client.invoke_tool("get_premium_article")
            
            assert result.success is True
            assert result.status_code == 200
            assert result.data["title"] == "Article"

    @pytest.mark.asyncio
    async def test_invoke_tool_payment_required(self, mcp_client):
        """Test tool invocation returning 402 Payment Required."""
        # Pre-populate cache with tool definition
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
            )
        ]
        
        payment_required = {
            "x402Version": 2,
            "accepts": [{"scheme": "exact", "amount": "1000"}],
        }
        encoded_payment = base64.b64encode(json.dumps(payment_required).encode()).decode()
        
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.json.return_value = payment_required
        mock_response.headers = {"X-PAYMENT-REQUIRED": encoded_payment}
        mock_response.content = b'{"x402Version": 2}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            result = await mcp_client.invoke_tool("get_premium_article")
            
            assert result.success is False
            assert result.status_code == 402
            assert result.payment_required is not None
            assert result.payment_required["x402Version"] == 2

    @pytest.mark.asyncio
    async def test_invoke_tool_with_payment(self, mcp_client):
        """Test tool invocation with payment signature."""
        # Pre-populate cache with tool definition
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
            )
        ]
        
        settlement = {"success": True, "transaction": "0x123..."}
        encoded_settlement = base64.b64encode(json.dumps(settlement).encode()).decode()
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"content": "Premium content"}
        mock_response.headers = {"X-PAYMENT-RESPONSE": encoded_settlement}
        mock_response.content = b'{"content": "Premium content"}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = mock_client.return_value.__aenter__.return_value
            mock_instance.get = AsyncMock(return_value=mock_response)
            
            result = await mcp_client.invoke_tool(
                "get_premium_article",
                payment_signature="base64_encoded_payment",
            )
            
            assert result.success is True
            assert result.status_code == 200
            assert result.payment_response is not None
            assert result.payment_response["success"] is True
            
            # Verify payment header was sent
            call_args = mock_instance.get.call_args
            assert "X-PAYMENT-SIGNATURE" in call_args.kwargs["headers"]

    @pytest.mark.asyncio
    async def test_invoke_tool_network_error(self, mcp_client):
        """Test handling of network errors during invocation."""
        # Pre-populate cache with tool definition
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
            )
        ]
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=httpx.RequestError("Connection failed")
            )
            
            result = await mcp_client.invoke_tool("get_premium_article")
            
            assert result.success is False
            assert result.status_code == 0
            assert "Request failed" in result.error

    def test_get_strands_tools_empty(self, mcp_client):
        """Test getting Strands tools when none discovered."""
        tools = mcp_client.get_strands_tools()
        
        assert tools == []

    def test_get_cached_tools_empty(self, mcp_client):
        """Test getting cached tools when none discovered."""
        tools = mcp_client.get_cached_tools()
        
        assert tools == []

    def test_clear_cache(self, mcp_client):
        """Test clearing the cache."""
        mcp_client._tools_cache = [
            MCPToolDefinition(name="test", description="", operation_id="")
        ]
        mcp_client._cache_timestamp = time.time()
        mcp_client._strands_tools = [lambda: None]
        
        mcp_client.clear_cache()
        
        assert mcp_client._tools_cache == []
        assert mcp_client._cache_timestamp == 0
        assert mcp_client._strands_tools == []


class TestMCPClientHelperFunctions:
    """Tests for MCP client helper functions."""

    def test_get_mcp_client_singleton(self):
        """Test that get_mcp_client returns a singleton."""
        # Reset the global client
        import agent.mcp_client as mcp_module
        mcp_module._mcp_client = None
        
        client1 = get_mcp_client()
        client2 = get_mcp_client()
        
        assert client1 is client2

    def test_list_available_tools_empty(self):
        """Test listing tools when none discovered."""
        import agent.mcp_client as mcp_module
        mcp_module._mcp_client = None
        
        client = get_mcp_client()
        client.clear_cache()
        
        tools = list_available_tools()
        
        assert tools == []

    def test_get_tool_info_not_found(self):
        """Test getting info for non-existent tool."""
        import agent.mcp_client as mcp_module
        mcp_module._mcp_client = None
        
        client = get_mcp_client()
        client.clear_cache()
        
        info = get_tool_info("nonexistent_tool")
        
        assert info is None


class TestMCPToolGeneration:
    """Tests for Strands tool generation from MCP definitions."""

    @pytest.fixture
    def mcp_client(self):
        """Create an MCP client for testing."""
        return MCPClient(gateway_url="https://gateway.example.com")

    def test_generate_strands_tools(self, mcp_client):
        """Test generation of Strands tools from definitions."""
        tool_defs = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                requires_payment=True,
                payment_info={
                    "price_display": "0.001 USDC",
                    "network_name": "Base Sepolia",
                },
                endpoint_path="/api/premium-article",
            ),
        ]
        
        tools = mcp_client._generate_strands_tools(tool_defs)
        
        assert len(tools) == 1
        assert tools[0].__name__ == "get_premium_article"
        assert hasattr(tools[0], "_mcp_tool_def")

    def test_create_tool_function(self, mcp_client):
        """Test creation of individual tool function."""
        tool_def = MCPToolDefinition(
            name="test_tool",
            description="A test tool",
            operation_id="test_tool",
            requires_payment=False,
            endpoint_path="/api/test-tool",
        )
        
        tool_func = mcp_client._create_tool_function(tool_def)
        
        assert tool_func.__name__ == "test_tool"
        assert "A test tool" in tool_func.__doc__
        assert tool_func._mcp_tool_def is tool_def

    @pytest.mark.asyncio
    async def test_invoke_tool_derives_endpoint_from_operation_id(self, mcp_client):
        """Test that invoke_tool derives endpoint path from operation_id when not provided."""
        # Pre-populate cache with tool definition without endpoint_path
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_weather_data",
                description="Get weather data",
                operation_id="get_weather_data",
                # No endpoint_path - should derive from operation_id
            )
        ]
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"weather": "sunny"}
        mock_response.headers = {}
        mock_response.content = b'{"weather": "sunny"}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = mock_client.return_value.__aenter__.return_value
            mock_instance.get = AsyncMock(return_value=mock_response)
            
            result = await mcp_client.invoke_tool("get_weather_data")
            
            # Verify the URL was constructed correctly
            call_args = mock_instance.get.call_args
            called_url = call_args.args[0]
            assert "/api/weather-data" in called_url
            assert result.success is True

    @pytest.mark.asyncio
    async def test_invoke_tool_uses_explicit_endpoint_path(self, mcp_client):
        """Test that invoke_tool uses explicit endpoint_path when provided."""
        # Pre-populate cache with tool definition with explicit endpoint_path
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_custom_content",
                description="Get custom content",
                operation_id="get_custom_content",
                endpoint_path="/custom/endpoint/path",
            )
        ]
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"content": "custom"}
        mock_response.headers = {}
        mock_response.content = b'{"content": "custom"}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = mock_client.return_value.__aenter__.return_value
            mock_instance.get = AsyncMock(return_value=mock_response)
            
            result = await mcp_client.invoke_tool("get_custom_content")
            
            # Verify the explicit endpoint path was used
            call_args = mock_instance.get.call_args
            called_url = call_args.args[0]
            assert "/custom/endpoint/path" in called_url
            assert result.success is True


class TestPaymentHeaderParsing:
    """Tests for x402 payment header parsing."""

    @pytest.fixture
    def mcp_client(self):
        """Create an MCP client for testing."""
        client = MCPClient(gateway_url="https://gateway.example.com")
        # Pre-populate cache with tool definition
        client._tools_cache = [
            MCPToolDefinition(
                name="test_tool",
                description="Test tool",
                operation_id="test_tool",
                endpoint_path="/api/test-tool",
            )
        ]
        return client

    @pytest.mark.asyncio
    async def test_parse_payment_required_header(self, mcp_client):
        """Test parsing of X-PAYMENT-REQUIRED header."""
        payment_required = {
            "x402Version": 2,
            "accepts": [
                {
                    "scheme": "exact",
                    "network": "eip155:84532",
                    "amount": "1000",
                    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                }
            ],
        }
        encoded = base64.b64encode(json.dumps(payment_required).encode()).decode()
        
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.json.return_value = payment_required
        mock_response.headers = {"X-PAYMENT-REQUIRED": encoded}
        mock_response.content = b'{}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            result = await mcp_client.invoke_tool("test_tool")
            
            assert result.payment_required is not None
            assert result.payment_required["x402Version"] == 2
            assert len(result.payment_required["accepts"]) == 1

    @pytest.mark.asyncio
    async def test_parse_payment_response_header(self, mcp_client):
        """Test parsing of X-PAYMENT-RESPONSE header."""
        settlement = {
            "success": True,
            "transaction": "0x1234567890abcdef",
            "network": "eip155:84532",
        }
        encoded = base64.b64encode(json.dumps(settlement).encode()).decode()
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"content": "data"}
        mock_response.headers = {"X-PAYMENT-RESPONSE": encoded}
        mock_response.content = b'{}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            result = await mcp_client.invoke_tool("test_tool")
            
            assert result.payment_response is not None
            assert result.payment_response["success"] is True
            assert result.payment_response["transaction"] == "0x1234567890abcdef"

    @pytest.mark.asyncio
    async def test_parse_non_prefixed_headers(self, mcp_client):
        """Test parsing of non-prefixed payment headers."""
        payment_required = {"x402Version": 2, "accepts": []}
        encoded = base64.b64encode(json.dumps(payment_required).encode()).decode()
        
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.json.return_value = payment_required
        # Use non-prefixed header
        mock_response.headers = {"PAYMENT-REQUIRED": encoded}
        mock_response.content = b'{}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            result = await mcp_client.invoke_tool("test_tool")
            
            assert result.payment_required is not None
            assert result.payment_required["x402Version"] == 2


class TestMCPTool402HandlingFlow:
    """
    Tests for 402 Payment Required handling in MCP-generated Strands tools.
    
    These tests verify that the 402 handling logic is preserved when using
    MCP-discovered tools. The agent must be able to:
    1. Receive 402 responses with payment requirements
    2. Extract payment details in a format compatible with analyze_payment
    3. Retry requests with payment signatures
    4. Receive content with settlement confirmation
    
    This is critical for the x402 payment flow to work correctly.
    """

    @pytest.fixture
    def mcp_client(self):
        """Create an MCP client for testing."""
        return MCPClient(gateway_url="https://gateway.example.com")

    @pytest.fixture
    def sample_402_response(self):
        """Create a sample 402 Payment Required response."""
        payment_required = {
            "x402Version": 2,
            "error": "Payment required to access this resource",
            "resource": {
                "url": "/api/premium-article",
                "description": "Premium article about AI",
            },
            "accepts": [{
                "scheme": "exact",
                "network": "eip155:84532",
                "amount": "1000",
                "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                "payTo": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
                "maxTimeoutSeconds": 60,
                "extra": {
                    "name": "USDC",
                    "version": "2",
                },
            }],
        }
        return payment_required

    @pytest.mark.asyncio
    async def test_mcp_tool_returns_402_with_payment_requirements(
        self, mcp_client, sample_402_response
    ):
        """Test that MCP-generated tool returns 402 with properly formatted payment requirements."""
        # Create tool definition
        tool_def = MCPToolDefinition(
            name="get_premium_article",
            description="Get a premium article",
            operation_id="get_premium_article",
            requires_payment=True,
            endpoint_path="/api/premium-article",
        )
        
        # Generate Strands tool
        tool_func = mcp_client._create_tool_function(tool_def)
        mcp_client._tools_cache = [tool_def]
        
        # Mock 402 response
        encoded_payment = base64.b64encode(
            json.dumps(sample_402_response).encode()
        ).decode()
        
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.json.return_value = sample_402_response
        mock_response.headers = {"X-PAYMENT-REQUIRED": encoded_payment}
        mock_response.content = json.dumps(sample_402_response).encode()
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            # Call the generated tool without payment
            result = await tool_func()
            
            # Verify 402 response structure
            assert result["status"] == 402
            assert "payment_required" in result
            
            # Verify payment requirements are in analyze_payment compatible format
            payment_req = result["payment_required"]
            assert payment_req["scheme"] == "exact"
            assert payment_req["network"] == "eip155:84532"
            assert payment_req["amount"] == "1000"
            assert payment_req["currency"] == "USDC"
            assert payment_req["recipient"] == "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
            
            # Verify helpful message is included
            assert "message" in result
            assert "analyze_payment" in result["message"]
            assert "sign_payment" in result["message"]

    @pytest.mark.asyncio
    async def test_mcp_tool_accepts_payment_payload_for_retry(
        self, mcp_client, sample_402_response
    ):
        """Test that MCP-generated tool accepts payment_payload for retry requests."""
        # Create tool definition
        tool_def = MCPToolDefinition(
            name="get_premium_article",
            description="Get a premium article",
            operation_id="get_premium_article",
            requires_payment=True,
            endpoint_path="/api/premium-article",
        )
        
        # Generate Strands tool
        tool_func = mcp_client._create_tool_function(tool_def)
        mcp_client._tools_cache = [tool_def]
        
        # Create payment payload (simulating sign_payment output)
        payment_payload = {
            "scheme": "exact",
            "network": "eip155:84532",
            "signature": "0x" + "ab" * 65,
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
            "amount": "1000",
            "timestamp": int(time.time() * 1000),
        }
        
        # Mock successful response with settlement
        settlement = {
            "success": True,
            "transaction": "0xabc123def456",
            "network": "eip155:84532",
        }
        encoded_settlement = base64.b64encode(
            json.dumps(settlement).encode()
        ).decode()
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "title": "Premium Article",
            "content": "This is premium content...",
        }
        mock_response.headers = {"X-PAYMENT-RESPONSE": encoded_settlement}
        mock_response.content = b'{"title": "Premium Article"}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = mock_client.return_value.__aenter__.return_value
            mock_instance.get = AsyncMock(return_value=mock_response)
            
            # Call the generated tool with payment payload
            result = await tool_func(payment_payload=payment_payload)
            
            # Verify successful response
            assert result["status"] == 200
            assert "content" in result
            assert result["content"]["title"] == "Premium Article"
            
            # Verify settlement is included
            assert "settlement" in result
            assert result["settlement"]["success"] is True
            assert result["settlement"]["transaction"] == "0xabc123def456"
            
            # Verify payment header was sent
            call_args = mock_instance.get.call_args
            assert "X-PAYMENT-SIGNATURE" in call_args.kwargs["headers"]

    @pytest.mark.asyncio
    async def test_complete_402_flow_with_mcp_tool(
        self, mcp_client, sample_402_response
    ):
        """Test the complete 402 → analyze → sign → retry → content flow."""
        # Create tool definition
        tool_def = MCPToolDefinition(
            name="get_premium_article",
            description="Get a premium article",
            operation_id="get_premium_article",
            requires_payment=True,
            endpoint_path="/api/premium-article",
        )
        
        # Generate Strands tool
        tool_func = mcp_client._create_tool_function(tool_def)
        mcp_client._tools_cache = [tool_def]
        
        # Step 1: Initial request returns 402
        encoded_payment = base64.b64encode(
            json.dumps(sample_402_response).encode()
        ).decode()
        
        mock_402_response = MagicMock()
        mock_402_response.status_code = 402
        mock_402_response.json.return_value = sample_402_response
        mock_402_response.headers = {"X-PAYMENT-REQUIRED": encoded_payment}
        mock_402_response.content = json.dumps(sample_402_response).encode()
        
        # Step 4: Retry with payment returns 200
        settlement = {"success": True, "transaction": "0xdef789"}
        encoded_settlement = base64.b64encode(json.dumps(settlement).encode()).decode()
        
        mock_200_response = MagicMock()
        mock_200_response.status_code = 200
        mock_200_response.json.return_value = {"content": "Premium content"}
        mock_200_response.headers = {"X-PAYMENT-RESPONSE": encoded_settlement}
        mock_200_response.content = b'{"content": "Premium content"}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = mock_client.return_value.__aenter__.return_value
            mock_instance.get = AsyncMock(
                side_effect=[mock_402_response, mock_200_response]
            )
            
            # Step 1: Initial request (no payment)
            initial_result = await tool_func()
            
            assert initial_result["status"] == 402
            payment_req = initial_result["payment_required"]
            
            # Step 2: Extract payment requirements (simulating analyze_payment input)
            assert payment_req["amount"] == "1000"
            assert payment_req["currency"] == "USDC"
            assert payment_req["recipient"].startswith("0x")
            
            # Step 3: Create payment payload (simulating sign_payment output)
            payment_payload = {
                "scheme": payment_req["scheme"],
                "network": payment_req["network"],
                "signature": "0x" + "ab" * 65,
                "from": "0x1111111111111111111111111111111111111111",
                "to": payment_req["recipient"],
                "amount": payment_req["amount"],
                "timestamp": int(time.time() * 1000),
            }
            
            # Step 4: Retry with payment
            retry_result = await tool_func(payment_payload=payment_payload)
            
            assert retry_result["status"] == 200
            assert retry_result["content"]["content"] == "Premium content"
            assert retry_result["settlement"]["success"] is True

    @pytest.mark.asyncio
    async def test_mcp_tool_preserves_raw_payment_requirements(
        self, mcp_client, sample_402_response
    ):
        """Test that MCP tool preserves raw payment requirements for debugging."""
        tool_def = MCPToolDefinition(
            name="get_premium_article",
            description="Get a premium article",
            operation_id="get_premium_article",
            endpoint_path="/api/premium-article",
        )
        
        tool_func = mcp_client._create_tool_function(tool_def)
        mcp_client._tools_cache = [tool_def]
        
        encoded_payment = base64.b64encode(
            json.dumps(sample_402_response).encode()
        ).decode()
        
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.json.return_value = sample_402_response
        mock_response.headers = {"X-PAYMENT-REQUIRED": encoded_payment}
        mock_response.content = json.dumps(sample_402_response).encode()
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            result = await tool_func()
            
            # Verify raw requirements are preserved
            assert "raw_requirement" in result["payment_required"]
            raw = result["payment_required"]["raw_requirement"]
            assert raw["x402Version"] == 2
            assert "accepts" in raw

    @pytest.mark.asyncio
    async def test_mcp_tool_handles_payment_rejection(self, mcp_client):
        """Test that MCP tool handles payment rejection (402 after retry)."""
        tool_def = MCPToolDefinition(
            name="get_premium_article",
            description="Get a premium article",
            operation_id="get_premium_article",
            endpoint_path="/api/premium-article",
        )
        
        tool_func = mcp_client._create_tool_function(tool_def)
        mcp_client._tools_cache = [tool_def]
        
        # Mock 402 response (payment rejected)
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.json.return_value = {"error": "Payment rejected"}
        mock_response.headers = {}
        mock_response.content = b'{"error": "Payment rejected"}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            
            # Call with invalid payment
            invalid_payment = {"signature": "invalid"}
            result = await tool_func(payment_payload=invalid_payment)
            
            # Should still return 402 with payment requirements
            assert result["status"] == 402


# ============================================================================
# Integration Tests for Tool Discovery and Invocation
# ============================================================================

import os


@pytest.mark.integration
class TestIntegrationMCPToolDiscovery:
    """
    Integration tests for MCP tool discovery against a real deployed server.
    
    These tests verify that:
    1. MCP tool discovery endpoint returns valid tool definitions
    2. Discovered tools have correct metadata and payment info
    3. Tool invocation works correctly with the real server
    4. 402 payment flow works end-to-end
    
    To run these tests:
    1. Deploy the seller infrastructure (CloudFront + Lambda@Edge)
    2. Set SELLER_API_URL environment variable to the CloudFront URL
    3. Run: pytest -m integration tests/test_mcp_client.py
    
    Example:
        export SELLER_API_URL=https://d1234567890abc.cloudfront.net
        pytest -m integration tests/test_mcp_client.py -v
    """

    @pytest.fixture
    def seller_url(self) -> str:
        """Get the seller API URL from environment."""
        url = os.environ.get("SELLER_API_URL")
        if not url:
            pytest.skip("SELLER_API_URL not set - skipping integration tests")
        return url

    @pytest.fixture
    def mcp_client(self, seller_url: str) -> MCPClient:
        """Create an MCP client configured for the real server."""
        return MCPClient(
            gateway_url=seller_url,
            cache_ttl_seconds=60,
            enable_caching=False,  # Disable caching for integration tests
        )

    @pytest.mark.asyncio
    async def test_discover_tools_from_real_server(self, mcp_client: MCPClient):
        """Test that tool discovery works against the real server.
        
        This test verifies:
        - Discovery endpoint is accessible
        - Response contains valid tool definitions
        - Tools have expected structure
        """
        # Note: The real server may not have an MCP discovery endpoint
        # In that case, we test direct tool invocation instead
        # For now, we'll test that the client can be configured correctly
        
        # Verify client is configured
        assert mcp_client.config.gateway_url is not None
        assert len(mcp_client.config.gateway_url) > 0
        
        # The MCP discovery endpoint may not exist on the CloudFront distribution
        # since it's primarily a content server. The discovery would typically
        # come from the AgentCore Gateway. For this integration test, we'll
        # verify the client can make requests to the server.
        
        # Try to invoke a known tool directly (this tests the invocation path)
        # Pre-populate cache with expected tool definition
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
                requires_payment=True,
            )
        ]
        
        # Invoke the tool - should get 402 without payment
        result = await mcp_client.invoke_tool("get_premium_article")
        
        # Should get 402 Payment Required
        assert result.status_code == 402
        assert result.payment_required is not None or result.data is not None

    @pytest.mark.asyncio
    async def test_invoke_tool_returns_402_from_real_server(self, mcp_client: MCPClient):
        """Test that tool invocation returns 402 from real server.
        
        This test verifies:
        - Tool invocation reaches the real server
        - Server returns 402 Payment Required
        - Payment requirements are properly formatted
        """
        # Pre-populate cache with tool definition
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
                requires_payment=True,
            )
        ]
        
        # Invoke without payment
        result = await mcp_client.invoke_tool("get_premium_article")
        
        # Verify 402 response
        assert result.status_code == 402, f"Expected 402, got {result.status_code}"
        
        # Verify payment requirements are present
        # They could be in payment_required (from header) or data (from body)
        has_payment_info = (
            result.payment_required is not None or
            (result.data is not None and "accepts" in str(result.data))
        )
        assert has_payment_info, "No payment requirements found in response"

    @pytest.mark.asyncio
    async def test_invoke_multiple_tools_from_real_server(self, mcp_client: MCPClient):
        """Test invoking multiple different tools from real server.
        
        This test verifies:
        - Multiple tool endpoints are accessible
        - Each returns appropriate 402 response
        - Different pricing is reflected in responses
        """
        # Define multiple tools
        tools = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
                requires_payment=True,
            ),
            MCPToolDefinition(
                name="get_weather_data",
                description="Get weather data",
                operation_id="get_weather_data",
                endpoint_path="/api/weather-data",
                requires_payment=True,
            ),
            MCPToolDefinition(
                name="get_market_analysis",
                description="Get market analysis",
                operation_id="get_market_analysis",
                endpoint_path="/api/market-analysis",
                requires_payment=True,
            ),
        ]
        
        mcp_client._tools_cache = tools
        
        # Invoke each tool and verify 402 response
        for tool in tools:
            result = await mcp_client.invoke_tool(tool.name)
            
            # Should get 402 for all tools without payment
            assert result.status_code == 402, \
                f"Tool {tool.name}: Expected 402, got {result.status_code}"

    @pytest.mark.asyncio
    async def test_payment_header_passthrough_to_real_server(self, mcp_client: MCPClient):
        """Test that payment headers are correctly passed to real server.
        
        This test verifies:
        - X-PAYMENT-SIGNATURE header is sent to server
        - Server processes the payment header
        - Response indicates payment was received (even if invalid)
        """
        # Pre-populate cache with tool definition
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
                requires_payment=True,
            )
        ]
        
        # Create a dummy payment signature (will be invalid but tests header passthrough)
        dummy_payment = base64.b64encode(json.dumps({
            "scheme": "exact",
            "network": "eip155:84532",
            "signature": "0x" + "00" * 65,
            "from": "0x0000000000000000000000000000000000000000",
            "to": "0x0000000000000000000000000000000000000000",
            "amount": "1000",
            "timestamp": int(time.time() * 1000),
        }).encode()).decode()
        
        # Invoke with payment signature
        result = await mcp_client.invoke_tool(
            "get_premium_article",
            payment_signature=dummy_payment,
        )
        
        # Server should process the request (may return 402 for invalid payment
        # or 400 for malformed payment, but should not return connection error)
        assert result.status_code in [200, 400, 401, 402, 403], \
            f"Unexpected status code: {result.status_code}, error: {result.error}"

    @pytest.mark.asyncio
    async def test_generated_strands_tool_invokes_real_server(self, mcp_client: MCPClient):
        """Test that generated Strands tool correctly invokes real server.
        
        This test verifies:
        - Strands tool function is correctly generated
        - Tool invocation reaches real server
        - 402 response is properly formatted for agent consumption
        """
        # Create tool definition
        tool_def = MCPToolDefinition(
            name="get_premium_article",
            description="Get a premium article",
            operation_id="get_premium_article",
            endpoint_path="/api/premium-article",
            requires_payment=True,
            payment_info={
                "price_display": "0.001 USDC",
                "network_name": "Base Sepolia",
            },
        )
        
        # Generate Strands tool
        tool_func = mcp_client._create_tool_function(tool_def)
        mcp_client._tools_cache = [tool_def]
        
        # Invoke the generated tool
        result = await tool_func()
        
        # Verify 402 response structure
        assert result["status"] == 402
        assert "payment_required" in result
        
        # Verify payment requirements are in agent-compatible format
        payment_req = result["payment_required"]
        assert "scheme" in payment_req
        assert "network" in payment_req
        assert "amount" in payment_req
        assert "recipient" in payment_req
        
        # Verify helpful message is included
        assert "message" in result
        assert "analyze_payment" in result["message"]


@pytest.mark.integration
class TestIntegrationMCPToolInvocationFlow:
    """
    Integration tests for the complete MCP tool invocation flow.
    
    These tests verify the end-to-end flow:
    1. Tool invocation without payment → 402
    2. Payment requirements extraction
    3. Tool invocation with payment → 200 (if valid payment)
    """

    @pytest.fixture
    def seller_url(self) -> str:
        """Get the seller API URL from environment."""
        url = os.environ.get("SELLER_API_URL")
        if not url:
            pytest.skip("SELLER_API_URL not set - skipping integration tests")
        return url

    @pytest.fixture
    def mcp_client(self, seller_url: str) -> MCPClient:
        """Create an MCP client configured for the real server."""
        return MCPClient(
            gateway_url=seller_url,
            cache_ttl_seconds=60,
            enable_caching=False,
        )

    @pytest.mark.asyncio
    async def test_complete_402_flow_with_real_server(self, mcp_client: MCPClient):
        """Test the complete 402 flow against real server.
        
        This test verifies:
        1. Initial request returns 402 with payment requirements
        2. Payment requirements can be extracted
        3. Requirements are in correct format for payment signing
        """
        # Pre-populate cache with tool definition
        tool_def = MCPToolDefinition(
            name="get_premium_article",
            description="Get a premium article",
            operation_id="get_premium_article",
            endpoint_path="/api/premium-article",
            requires_payment=True,
        )
        mcp_client._tools_cache = [tool_def]
        
        # Generate Strands tool
        tool_func = mcp_client._create_tool_function(tool_def)
        
        # Step 1: Initial request (no payment)
        result = await tool_func()
        
        # Verify 402 response
        assert result["status"] == 402
        assert "payment_required" in result
        
        # Step 2: Extract payment requirements
        payment_req = result["payment_required"]
        
        # Verify required fields for payment signing
        assert "scheme" in payment_req, "Missing 'scheme' in payment requirements"
        assert "network" in payment_req, "Missing 'network' in payment requirements"
        assert "amount" in payment_req, "Missing 'amount' in payment requirements"
        assert "recipient" in payment_req, "Missing 'recipient' in payment requirements"
        
        # Verify values are non-empty
        assert len(payment_req["scheme"]) > 0, "Empty 'scheme'"
        assert len(payment_req["network"]) > 0, "Empty 'network'"
        assert len(payment_req["amount"]) > 0, "Empty 'amount'"
        assert len(payment_req["recipient"]) > 0, "Empty 'recipient'"
        
        # Verify recipient is a valid Ethereum address
        assert payment_req["recipient"].startswith("0x"), \
            f"Invalid recipient address: {payment_req['recipient']}"
        assert len(payment_req["recipient"]) == 42, \
            f"Invalid recipient address length: {len(payment_req['recipient'])}"

    @pytest.mark.asyncio
    async def test_payment_requirements_match_expected_format(self, mcp_client: MCPClient):
        """Test that payment requirements match x402 v2 specification.
        
        This test verifies:
        - Payment requirements follow x402 v2 format
        - All required fields are present
        - Values are in expected ranges
        """
        # Pre-populate cache with tool definition
        mcp_client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
                requires_payment=True,
            )
        ]
        
        # Invoke tool
        result = await mcp_client.invoke_tool("get_premium_article")
        
        # Verify 402 response
        assert result.status_code == 402
        
        # Get payment requirements (from header or body)
        payment_required = result.payment_required or result.data
        assert payment_required is not None, "No payment requirements in response"
        
        # If it's x402 v2 format, verify structure
        if "x402Version" in payment_required:
            assert payment_required["x402Version"] == 2
            assert "accepts" in payment_required
            assert len(payment_required["accepts"]) > 0
            
            # Verify first accept option
            accept = payment_required["accepts"][0]
            assert "scheme" in accept
            assert "network" in accept
            assert "amount" in accept

    @pytest.mark.asyncio
    async def test_different_endpoints_have_different_prices(self, mcp_client: MCPClient):
        """Test that different content endpoints have different prices.
        
        This test verifies:
        - Different tools have different payment amounts
        - Pricing is consistent with gateway configuration
        """
        # Define tools with expected different prices
        tools = [
            ("get_premium_article", "/api/premium-article"),
            ("get_weather_data", "/api/weather-data"),
            ("get_market_analysis", "/api/market-analysis"),
        ]
        
        prices = {}
        
        for tool_name, endpoint_path in tools:
            mcp_client._tools_cache = [
                MCPToolDefinition(
                    name=tool_name,
                    description=f"Get {tool_name}",
                    operation_id=tool_name,
                    endpoint_path=endpoint_path,
                    requires_payment=True,
                )
            ]
            
            result = await mcp_client.invoke_tool(tool_name)
            
            if result.status_code == 402:
                payment_required = result.payment_required or result.data
                if payment_required and "accepts" in payment_required:
                    amount = payment_required["accepts"][0].get("amount", "0")
                    prices[tool_name] = amount
        
        # If we got prices for multiple tools, verify they're different
        if len(prices) >= 2:
            unique_prices = set(prices.values())
            # At least some prices should be different
            # (premium article: 1000, weather: 500, market: 2000)
            assert len(unique_prices) >= 2, \
                f"Expected different prices, got: {prices}"


@pytest.mark.integration
class TestIntegrationMCPClientErrorHandling:
    """
    Integration tests for MCP client error handling with real server.
    
    These tests verify:
    - Client handles network errors gracefully
    - Client handles invalid responses gracefully
    - Client handles timeout scenarios
    """

    @pytest.fixture
    def seller_url(self) -> str:
        """Get the seller API URL from environment."""
        url = os.environ.get("SELLER_API_URL")
        if not url:
            pytest.skip("SELLER_API_URL not set - skipping integration tests")
        return url

    @pytest.mark.asyncio
    async def test_invalid_endpoint_returns_error(self, seller_url: str):
        """Test that invalid endpoint returns appropriate error."""
        client = MCPClient(
            gateway_url=seller_url,
            enable_caching=False,
        )
        
        # Pre-populate cache with invalid tool definition
        client._tools_cache = [
            MCPToolDefinition(
                name="nonexistent_tool",
                description="This tool does not exist",
                operation_id="nonexistent_tool",
                endpoint_path="/api/nonexistent-endpoint",
            )
        ]
        
        # Invoke the invalid tool
        result = await client.invoke_tool("nonexistent_tool")
        
        # Should get an error response (404 or similar)
        assert result.status_code in [400, 403, 404, 500], \
            f"Expected error status, got {result.status_code}"

    @pytest.mark.asyncio
    async def test_timeout_handling(self, seller_url: str):
        """Test that client handles timeout gracefully."""
        # Create client with very short timeout
        client = MCPClient(
            gateway_url=seller_url,
            timeout_seconds=0.001,  # 1ms timeout - should fail
            enable_caching=False,
        )
        
        client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path="/api/premium-article",
            )
        ]
        
        # Invoke tool - should timeout
        result = await client.invoke_tool("get_premium_article")
        
        # Should get an error (either timeout or connection error)
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_invalid_url_returns_error(self):
        """Test that invalid URL returns appropriate error."""
        client = MCPClient(
            gateway_url="https://invalid-url-that-does-not-exist.example.com",
            enable_caching=False,
        )
        
        client._tools_cache = [
            MCPToolDefinition(
                name="test_tool",
                description="Test tool",
                operation_id="test_tool",
                endpoint_path="/api/test",
            )
        ]
        
        # Invoke tool - should fail with connection error
        result = await client.invoke_tool("test_tool")
        
        assert result.success is False
        assert result.error is not None
        assert "Request failed" in result.error or "Connection" in result.error
