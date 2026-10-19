"""Tests for outbound request URL handling and payee checks in the payer agent tools."""

from unittest.mock import MagicMock, patch

import pytest

from agent.tools.content import request_content, request_content_with_payment
from agent.tools.discovery import request_service
from agent.tools.payment import _is_allowed_payee, _last_payment_context, process_payment
from agent.tools.url_safety import UnsafeRequestUrlError, build_seller_url

SELLER = "https://seller.example.com"


class TestBuildSellerUrl:
    """build_seller_url keeps every request on the configured seller origin."""

    @pytest.mark.parametrize(
        "path, expected",
        [
            ("/api/premium-article", f"{SELLER}/api/premium-article"),
            ("/api/premium-article?format=json", f"{SELLER}/api/premium-article?format=json"),
            ("/", f"{SELLER}/"),
        ],
    )
    def test_accepts_plain_paths(self, path, expected):
        assert build_seller_url(SELLER, path) == expected

    def test_trailing_slash_on_base_is_normalized(self):
        assert build_seller_url(f"{SELLER}/", "/api/x") == f"{SELLER}/api/x"

    def test_base_path_prefix_is_kept(self):
        assert build_seller_url(f"{SELLER}/prod", "/api/x") == f"{SELLER}/prod/api/x"

    @pytest.mark.parametrize(
        "path",
        [
            "@other.example/api/premium-article",
            ":x@other.example/api/premium-article",
            ".other.example/api/premium-article",
            "\\@other.example/api/premium-article",
            "http://other.example/api/premium-article",
            "//other.example/api/premium-article",
            "/api/x@other.example",
            "/api/x\\y",
            "/api/premium article",
            "/api/x\r\nHost: other.example",
            "api/premium-article",
            "",
        ],
    )
    def test_rejects_paths_that_could_leave_the_seller(self, path):
        with pytest.raises(UnsafeRequestUrlError):
            build_seller_url(SELLER, path)

    def test_rejects_missing_base_url(self):
        with pytest.raises(UnsafeRequestUrlError):
            build_seller_url("", "/api/x")


class TestContentToolsUrlHandling:
    """request_content and request_content_with_payment reject unsafe paths and redirects."""

    def setup_method(self):
        _last_payment_context.clear()

    @patch("agent.tools.content.config")
    def test_request_content_rejects_unsafe_path_without_sending(self, mock_config):
        mock_config.seller_api_url = SELLER

        with patch("httpx.Client") as mock_client_cls:
            result = request_content("@other.example/api/premium-article")

        assert result["http_status"] == 0
        assert "Invalid content URL" in result["error_message"]
        mock_client_cls.assert_not_called()

    @patch("agent.tools.content.config")
    def test_request_content_does_not_follow_redirects(self, mock_config):
        mock_config.seller_api_url = SELLER
        mock_response = MagicMock(status_code=302, headers={})

        with patch("httpx.Client") as mock_client_cls:
            mock_client = mock_client_cls.return_value.__enter__.return_value
            mock_client.get.return_value = mock_response
            result = request_content("/api/premium-article")

        assert mock_client.get.call_args.args[0] == f"{SELLER}/api/premium-article"
        assert mock_client.get.call_args.kwargs["follow_redirects"] is False
        assert result["http_status"] == 302

    @patch("agent.tools.content.config")
    def test_payment_proof_is_not_sent_to_unsafe_path(self, mock_config):
        mock_config.seller_api_url = SELLER
        _last_payment_context["proof"] = {"payload": {"signature": "0xabc"}}
        _last_payment_context["x402_version"] = 1
        _last_payment_context["x402_payload"] = {"scheme": "exact", "network": "eip155:84532"}

        with patch("httpx.Client") as mock_client_cls:
            result = request_content_with_payment(".other.example/api/premium-article")

        assert result["http_status"] == 0
        mock_client_cls.assert_not_called()

    @patch("agent.tools.content.config")
    def test_payment_request_does_not_follow_redirects(self, mock_config):
        mock_config.seller_api_url = SELLER
        _last_payment_context["proof"] = {"payload": {"signature": "0xabc"}}
        _last_payment_context["x402_version"] = 1
        _last_payment_context["x402_payload"] = {"scheme": "exact", "network": "eip155:84532"}
        mock_response = MagicMock(status_code=200, headers={})
        mock_response.json.return_value = {"content": "paid data"}

        with patch("httpx.Client") as mock_client_cls:
            mock_client = mock_client_cls.return_value.__enter__.return_value
            mock_client.post.return_value = mock_response
            request_content_with_payment("/api/premium-article")

        assert mock_client.post.call_args.kwargs["follow_redirects"] is False


class TestRequestServiceUrlHandling:
    """request_service builds its URL with the same checks."""

    def setup_method(self):
        _last_payment_context.clear()

    @patch("agent.tools.discovery.config")
    def test_rejects_service_name_that_is_not_a_plain_path(self, mock_config):
        mock_config.seller_api_url = SELLER

        with patch("httpx.Client") as mock_client_cls:
            result = request_service("get_x@other.example")

        assert result["http_status"] == 0
        mock_client_cls.assert_not_called()

    @patch("agent.tools.discovery.config")
    def test_does_not_follow_redirects(self, mock_config):
        mock_config.seller_api_url = SELLER
        mock_response = MagicMock(status_code=302, headers={})

        with patch("httpx.Client") as mock_client_cls:
            mock_client = mock_client_cls.return_value.__enter__.return_value
            mock_client.get.return_value = mock_response
            request_service("get_premium_article")

        assert mock_client.get.call_args.args[0] == f"{SELLER}/api/premium-article"
        assert mock_client.get.call_args.kwargs["follow_redirects"] is False


class TestPayeeAllowlist:
    """process_payment only pays allowed seller addresses when an allowlist is configured."""

    SELLER_WALLET = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C"

    def test_evm_addresses_compare_case_insensitively(self):
        assert _is_allowed_payee(self.SELLER_WALLET.lower(), (self.SELLER_WALLET,))

    def test_non_evm_addresses_compare_exactly(self):
        assert _is_allowed_payee("SoLAddr", ("SoLAddr",))
        assert not _is_allowed_payee("soladdr", ("SoLAddr",))

    @patch("agent.tools.payment._get_dp_client")
    @patch("agent.tools.payment.config")
    def test_rejects_payee_not_in_allowlist(self, mock_config, mock_get_client):
        mock_config.seller_pay_to_addresses = (self.SELLER_WALLET,)

        result = process_payment({"payTo": "0x0000000000000000000000000000000000000bad"})

        assert result["status"] == "REJECTED"
        mock_get_client.assert_not_called()

    @patch("agent.tools.payment._get_dp_client")
    @patch("agent.tools.payment.config")
    def test_allows_listed_payee(self, mock_config, mock_get_client):
        mock_config.seller_pay_to_addresses = (self.SELLER_WALLET,)
        mock_get_client.return_value.process_payment.return_value = {"status": "PROOF_GENERATED"}

        result = process_payment({"payTo": self.SELLER_WALLET, "amount": "1000"})

        assert result["status"] == "PROOF_GENERATED"
        mock_get_client.return_value.process_payment.assert_called_once()

    @patch("agent.tools.payment._get_dp_client")
    @patch("agent.tools.payment.config")
    def test_no_allowlist_keeps_existing_behavior(self, mock_config, mock_get_client):
        mock_config.seller_pay_to_addresses = ()
        mock_get_client.return_value.process_payment.return_value = {"status": "PROOF_GENERATED"}

        result = process_payment({"payTo": "0xanything", "amount": "1000"})

        assert result["status"] == "PROOF_GENERATED"
