"""
Tests for payment signing functionality.

These tests verify that the sign_payment tool:
1. Creates properly structured payment payloads
2. Signs messages using the wallet provider
3. Handles errors gracefully
4. Returns correct payload format for x402 protocol
"""

import asyncio
import json
import time
from typing import Any
from unittest.mock import MagicMock, patch, AsyncMock

import pytest


# ============================================================================
# Test Data Fixtures
# ============================================================================

MOCK_WALLET_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
MOCK_RECIPIENT_ADDRESS = "0x1234567890123456789012345678901234567890"
MOCK_SIGNATURE = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"


def create_mock_wallet_provider(
    address: str = MOCK_WALLET_ADDRESS,
    signature: str = MOCK_SIGNATURE,
) -> MagicMock:
    """Create a mock wallet provider for testing."""
    mock_provider = MagicMock()
    mock_provider.get_address.return_value = address
    mock_provider.sign_message.return_value = signature
    return mock_provider


# ============================================================================
# Payment Signing Tests
# ============================================================================

class TestSignPaymentPayloadStructure:
    """Tests for the structure of signed payment payloads."""

    @pytest.mark.asyncio
    async def test_sign_payment_returns_success_with_valid_inputs(self):
        """Test that sign_payment returns success with valid inputs."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is True
            assert "payload" in result

    @pytest.mark.asyncio
    async def test_sign_payment_payload_contains_scheme(self):
        """Test that signed payload contains the payment scheme."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["payload"]["scheme"] == "exact"

    @pytest.mark.asyncio
    async def test_sign_payment_payload_contains_network(self):
        """Test that signed payload contains the network."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["payload"]["network"] == "base-sepolia"

    @pytest.mark.asyncio
    async def test_sign_payment_payload_contains_signature(self):
        """Test that signed payload contains a signature."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert "signature" in result["payload"]
            assert result["payload"]["signature"] == MOCK_SIGNATURE

    @pytest.mark.asyncio
    async def test_sign_payment_payload_contains_from_address(self):
        """Test that signed payload contains the sender address."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["payload"]["from"] == MOCK_WALLET_ADDRESS

    @pytest.mark.asyncio
    async def test_sign_payment_payload_contains_to_address(self):
        """Test that signed payload contains the recipient address."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["payload"]["to"] == MOCK_RECIPIENT_ADDRESS

    @pytest.mark.asyncio
    async def test_sign_payment_payload_contains_amount(self):
        """Test that signed payload contains the payment amount."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["payload"]["amount"] == "0.001"

    @pytest.mark.asyncio
    async def test_sign_payment_payload_contains_timestamp(self):
        """Test that signed payload contains a timestamp."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            before_time = int(time.time() * 1000)
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            after_time = int(time.time() * 1000)
            
            assert "timestamp" in result["payload"]
            assert before_time <= result["payload"]["timestamp"] <= after_time


class TestSignPaymentMessageSigning:
    """Tests for the message signing process."""

    @pytest.mark.asyncio
    async def test_sign_payment_calls_wallet_sign_message(self):
        """Test that sign_payment calls the wallet's sign_message method."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            mock_provider.sign_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_sign_payment_message_is_json(self):
        """Test that the signed message is valid JSON."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            # Get the message that was signed
            call_args = mock_provider.sign_message.call_args
            signed_message = call_args[0][0]
            
            # Should be valid JSON
            parsed = json.loads(signed_message)
            assert isinstance(parsed, dict)

    @pytest.mark.asyncio
    async def test_sign_payment_message_contains_all_fields(self):
        """Test that the signed message contains all required fields."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            call_args = mock_provider.sign_message.call_args
            signed_message = call_args[0][0]
            parsed = json.loads(signed_message)
            
            assert "scheme" in parsed
            assert "network" in parsed
            assert "from" in parsed
            assert "to" in parsed
            assert "amount" in parsed
            assert "timestamp" in parsed


class TestSignPaymentErrorHandling:
    """Tests for error handling in sign_payment."""

    @pytest.mark.asyncio
    async def test_sign_payment_handles_wallet_error(self):
        """Test that sign_payment handles wallet provider errors gracefully."""
        mock_provider = MagicMock()
        mock_provider.get_address.side_effect = Exception("Wallet connection failed")
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is False
            assert "error" in result

    @pytest.mark.asyncio
    async def test_sign_payment_handles_signing_error(self):
        """Test that sign_payment handles signing errors gracefully."""
        mock_provider = MagicMock()
        mock_provider.get_address.return_value = MOCK_WALLET_ADDRESS
        mock_provider.sign_message.side_effect = Exception("Signing failed")
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is False
            assert "error" in result
            assert "Signing failed" in result["error"]


class TestSignPaymentWithDifferentSchemes:
    """Tests for sign_payment with different payment schemes."""

    @pytest.mark.asyncio
    async def test_sign_payment_with_exact_scheme(self):
        """Test signing payment with 'exact' scheme."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is True
            assert result["payload"]["scheme"] == "exact"

    @pytest.mark.asyncio
    async def test_sign_payment_with_upto_scheme(self):
        """Test signing payment with 'upto' scheme."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="upto",
                network="base-sepolia",
                amount="0.005",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is True
            assert result["payload"]["scheme"] == "upto"


class TestSignPaymentWithDifferentNetworks:
    """Tests for sign_payment with different networks."""

    @pytest.mark.asyncio
    async def test_sign_payment_with_base_sepolia(self):
        """Test signing payment on base-sepolia network."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is True
            assert result["payload"]["network"] == "base-sepolia"

    @pytest.mark.asyncio
    async def test_sign_payment_with_ethereum_sepolia(self):
        """Test signing payment on ethereum-sepolia network."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="ethereum-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is True
            assert result["payload"]["network"] == "ethereum-sepolia"


class TestSignPaymentWithDifferentAmounts:
    """Tests for sign_payment with different payment amounts."""

    @pytest.mark.asyncio
    async def test_sign_payment_with_small_amount(self):
        """Test signing payment with a small amount."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.0001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is True
            assert result["payload"]["amount"] == "0.0001"

    @pytest.mark.asyncio
    async def test_sign_payment_with_larger_amount(self):
        """Test signing payment with a larger amount."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.01",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is True
            assert result["payload"]["amount"] == "0.01"

    @pytest.mark.asyncio
    async def test_sign_payment_with_zero_amount(self):
        """Test signing payment with zero amount (free content)."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            assert result["success"] is True
            assert result["payload"]["amount"] == "0"


class TestSignPaymentX402Compatibility:
    """Tests for x402 protocol compatibility of signed payments."""

    @pytest.mark.asyncio
    async def test_signed_payload_is_x402_compatible(self):
        """Test that the signed payload is compatible with x402 protocol."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            payload = result["payload"]
            
            # x402 required fields
            assert "scheme" in payload
            assert "network" in payload
            assert "signature" in payload
            assert "from" in payload
            assert "to" in payload
            assert "amount" in payload
            assert "timestamp" in payload

    @pytest.mark.asyncio
    async def test_signed_payload_addresses_are_valid_ethereum(self):
        """Test that addresses in payload are valid Ethereum addresses."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            payload = result["payload"]
            
            # Validate from address format
            assert payload["from"].startswith("0x")
            assert len(payload["from"]) == 42
            
            # Validate to address format
            assert payload["to"].startswith("0x")
            assert len(payload["to"]) == 42

    @pytest.mark.asyncio
    async def test_signed_payload_timestamp_is_milliseconds(self):
        """Test that timestamp is in milliseconds (not seconds)."""
        mock_provider = create_mock_wallet_provider()
        
        with patch("agent.tools.payment._get_wallet_provider_sync", return_value=mock_provider):
            from agent.tools.payment import sign_payment
            
            result = await sign_payment(
                scheme="exact",
                network="base-sepolia",
                amount="0.001",
                recipient=MOCK_RECIPIENT_ADDRESS,
            )
            
            timestamp = result["payload"]["timestamp"]
            
            # Timestamp should be in milliseconds (13+ digits for current time)
            assert timestamp > 1000000000000  # After year 2001 in ms
            assert timestamp < 10000000000000  # Before year 2286 in ms
