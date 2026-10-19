"""Tests for ProcessPayment API call correctness.

These tests verify that the process_payment tool correctly constructs
the ProcessPayment API request and handles the response.
"""

import pytest
from unittest.mock import patch, MagicMock

from agent.tools.payment import process_payment, _last_payment_context


class TestProcessPaymentAPICall:
    """Tests verifying correct ProcessPayment API construction."""

    def setup_method(self):
        _last_payment_context.clear()

    @patch("agent.tools.payment._get_dp_client")
    @patch("agent.tools.payment.config")
    def test_uses_correct_config_values(self, mock_config, mock_get_client, mock_dp_client):
        """Test that config values are passed correctly to ProcessPayment."""
        mock_config.user_id = "user-abc"
        mock_config.payment_manager_arn = "arn:aws:bedrock-agentcore:us-west-2:123:payment-manager/mgr-1"
        mock_config.payment_session_id = "session-xyz"
        mock_config.payment_instrument_id = "instrument-123"
        mock_config.seller_pay_to_addresses = ()
        mock_get_client.return_value = mock_dp_client

        payload = {"scheme": "exact", "network": "eip155:84532", "amount": "500"}
        process_payment(x402_payload=payload, x402_version=1)

        call_kwargs = mock_dp_client.process_payment.call_args.kwargs
        assert call_kwargs["userId"] == "user-abc"
        assert call_kwargs["paymentManagerArn"] == "arn:aws:bedrock-agentcore:us-west-2:123:payment-manager/mgr-1"
        assert call_kwargs["paymentSessionId"] == "session-xyz"
        assert call_kwargs["paymentInstrumentId"] == "instrument-123"

    @patch("agent.tools.payment._get_dp_client")
    def test_v1_preserves_all_fields(self, mock_get_client, mock_dp_client):
        """Test that v1 passes the full merchant payload without modification."""
        mock_get_client.return_value = mock_dp_client

        payload = {
            "scheme": "exact",
            "network": "eip155:84532",
            "amount": "1000",
            "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "payTo": "0xRecipient",
            "maxTimeoutSeconds": 60,
            "extra": {"name": "USDC", "version": "2"},
            "resource": "/api/test",
            "description": "Test resource",
            "outputSchema": {"type": "object"},
        }

        process_payment(x402_payload=payload, x402_version=1)

        call_kwargs = mock_dp_client.process_payment.call_args.kwargs
        sent_payload = call_kwargs["paymentInput"]["cryptoX402"]["payload"]
        # v1 keeps ALL fields including metadata
        assert sent_payload["resource"] == "/api/test"
        assert sent_payload["description"] == "Test resource"
        assert sent_payload["outputSchema"] == {"type": "object"}

    @patch("agent.tools.payment._get_dp_client")
    def test_v2_strips_only_metadata_fields(self, mock_get_client, mock_dp_client):
        """Test that v2 strips exactly the right metadata fields."""
        mock_get_client.return_value = mock_dp_client

        payload = {
            "scheme": "exact",
            "network": "eip155:84532",
            "amount": "2000",
            "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "payTo": "0xRecipient",
            "maxTimeoutSeconds": 60,
            "extra": {"name": "USDC", "version": "2"},
            "resource": "/api/test",
            "description": "Test",
            "mimeType": "application/json",
            "outputSchema": {"type": "object"},
        }

        process_payment(x402_payload=payload, x402_version=2)

        call_kwargs = mock_dp_client.process_payment.call_args.kwargs
        sent_payload = call_kwargs["paymentInput"]["cryptoX402"]["payload"]
        # Metadata stripped
        assert "resource" not in sent_payload
        assert "description" not in sent_payload
        assert "mimeType" not in sent_payload
        assert "outputSchema" not in sent_payload
        # Payment fields preserved
        assert sent_payload["scheme"] == "exact"
        assert sent_payload["network"] == "eip155:84532"
        assert sent_payload["amount"] == "2000"
        assert sent_payload["asset"] == "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
        assert sent_payload["payTo"] == "0xRecipient"
        assert sent_payload["extra"] == {"name": "USDC", "version": "2"}

    @patch("agent.tools.payment._get_dp_client")
    def test_version_string_in_request(self, mock_get_client, mock_dp_client):
        """Test that version is passed as string to the API."""
        mock_get_client.return_value = mock_dp_client

        payload = {"scheme": "exact", "amount": "100"}
        process_payment(x402_payload=payload, x402_version=2)

        call_kwargs = mock_dp_client.process_payment.call_args.kwargs
        # Version must be a string in the API request
        assert call_kwargs["paymentInput"]["cryptoX402"]["version"] == "2"

    @patch("agent.tools.payment._get_dp_client")
    def test_does_not_mutate_original_payload(self, mock_get_client, mock_dp_client):
        """Test that the original x402_payload dict is not mutated."""
        mock_get_client.return_value = mock_dp_client

        payload = {
            "scheme": "exact",
            "amount": "1000",
            "description": "Test",
            "resource": "/api/test",
        }
        original_keys = set(payload.keys())

        process_payment(x402_payload=payload, x402_version=2)

        # Original dict should be unchanged
        assert set(payload.keys()) == original_keys
        assert payload["description"] == "Test"
