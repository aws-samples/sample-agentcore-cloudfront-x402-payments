"""Tests for outbound request URL handling and payee checks in the payer agent tools."""

from unittest.mock import patch

import httpx
import pytest

from agent.mcp_client import MCPClient, MCPToolDefinition
from agent.tools.content import request_content, request_content_with_payment
from agent.tools.discovery import request_service
from agent.tools.payment import _is_allowed_payee, _last_payment_context, process_payment
from agent.tools.url_safety import UnsafeRequestUrlError, build_seller_url, is_seller_origin

SELLER = "https://seller.example.com"
OTHER = "https://other.example"

_REAL_CLIENT = httpx.Client
_REAL_ASYNC_CLIENT = httpx.AsyncClient


class _MockSeller:
    """httpx.MockTransport handler that records requests and serves scripted responses by URL."""

    def __init__(self, routes: dict[str, httpx.Response]):
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.routes.get(str(request.url), httpx.Response(404))

    @property
    def hosts(self) -> set[str]:
        return {request.url.host for request in self.requests}


def _real_client(seller: _MockSeller):
    """Patch side effect: a real httpx.Client on a mock transport, keeping the tool's kwargs."""
    return lambda **kwargs: _REAL_CLIENT(transport=httpx.MockTransport(seller), **kwargs)


def _real_async_client(seller: _MockSeller):
    return lambda **kwargs: _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(seller), **kwargs)


def _redirect(location: str, status: int = 302) -> httpx.Response:
    return httpx.Response(status, headers={"Location": location})


def _set_payment_context():
    _last_payment_context["proof"] = {"payload": {"signature": "0xabc"}}
    _last_payment_context["x402_version"] = 1
    _last_payment_context["x402_payload"] = {"scheme": "exact", "network": "eip155:84532"}


class TestBuildSellerUrl:
    """build_seller_url keeps every request on the configured seller origin."""

    @pytest.mark.parametrize(
        "path, expected",
        [
            ("/api/premium-article", f"{SELLER}/api/premium-article"),
            ("/api/premium-article?format=json", f"{SELLER}/api/premium-article?format=json"),
            ("/api/v1.2/report.json", f"{SELLER}/api/v1.2/report.json"),
            ("/api/x%41", f"{SELLER}/api/x%41"),
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
            "/api/caf\u00e9",
            "api/premium-article",
            "",
        ],
    )
    def test_rejects_paths_that_could_leave_the_seller(self, path):
        with pytest.raises(UnsafeRequestUrlError):
            build_seller_url(SELLER, path)

    @pytest.mark.parametrize(
        "path",
        [
            "/api/../internal/admin",
            "/api/./x",
            "/..",
            "/api/x?/../y",
        ],
    )
    def test_rejects_dot_segments(self, path):
        with pytest.raises(UnsafeRequestUrlError):
            build_seller_url(f"{SELLER}/prod", path)

    @pytest.mark.parametrize(
        "path",
        [
            "/api/%2e%2e/secret",
            "/api/%2E%2E/secret",
            "/api/%252e%252e/secret",
            "/api/x%2F..%2Fy",
            "/api/x%40other.example",
            "/api/x%5cother.example",
            "/%2Fother.example/x",
            "/api/x%0d%0aHost:%20other.example",
            "/api/x%00",
            "/api/x%20y",
            "/api/%c0%ae%c0%ae/x",
            "/api/%ef%bc%8e%ef%bc%8e/x",
            "/api/%2525252e",
        ],
    )
    def test_rejects_percent_encoded_variants(self, path):
        with pytest.raises(UnsafeRequestUrlError):
            build_seller_url(SELLER, path)

    def test_rejects_missing_base_url(self):
        with pytest.raises(UnsafeRequestUrlError):
            build_seller_url("", "/api/x")


class TestIsSellerOrigin:
    """Redirect targets must stay on the seller's origin."""

    @pytest.mark.parametrize(
        "base, target",
        [
            (SELLER, f"{SELLER}/api/new"),
            (SELLER, "https://SELLER.example.com/api/new"),
            ("http://seller.example.com", f"{SELLER}/api/new"),
        ],
    )
    def test_accepts_same_origin_and_https_upgrade(self, base, target):
        assert is_seller_origin(base, target)

    @pytest.mark.parametrize(
        "target",
        [
            f"{OTHER}/collect",
            "https://evil.seller.example.com/api/new",
            "https://seller.example.com:8443/api/new",
            "http://seller.example.com/api/new",
            "https://user@seller.example.com/api/new",
        ],
    )
    def test_rejects_other_origins(self, target):
        assert not is_seller_origin(SELLER, target)


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
    def test_request_content_rejects_encoded_traversal_without_sending(self, mock_config):
        mock_config.seller_api_url = SELLER

        with patch("httpx.Client") as mock_client_cls:
            result = request_content("/api/%2e%2e/internal")

        assert result["http_status"] == 0
        mock_client_cls.assert_not_called()

    @patch("agent.tools.content.config")
    def test_request_content_follows_same_origin_redirect(self, mock_config):
        mock_config.seller_api_url = SELLER
        seller = _MockSeller(
            {
                f"{SELLER}/api/old": _redirect("/api/new"),
                f"{SELLER}/api/new": httpx.Response(200, json={"content": "article"}),
            }
        )

        with patch("httpx.Client", side_effect=_real_client(seller)):
            result = request_content("/api/old")

        assert result == {"http_status": 200, "data": {"content": "article"}}

    @patch("agent.tools.content.config")
    def test_request_content_blocks_cross_origin_redirect(self, mock_config):
        mock_config.seller_api_url = SELLER
        seller = _MockSeller({f"{SELLER}/api/premium-article": _redirect(f"{OTHER}/402")})

        with patch("httpx.Client", side_effect=_real_client(seller)):
            result = request_content("/api/premium-article")

        assert result["http_status"] == 0
        assert "Redirect blocked" in result["error_message"]
        assert seller.hosts == {"seller.example.com"}

    @patch("agent.tools.content.config")
    def test_payment_proof_is_not_sent_to_unsafe_path(self, mock_config):
        mock_config.seller_api_url = SELLER
        _set_payment_context()

        with patch("httpx.Client") as mock_client_cls:
            result = request_content_with_payment(".other.example/api/premium-article")

        assert result["http_status"] == 0
        mock_client_cls.assert_not_called()

    @pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
    @patch("agent.tools.content.config")
    def test_payment_header_is_not_sent_across_origins(self, mock_config, status):
        mock_config.seller_api_url = SELLER
        _set_payment_context()
        seller = _MockSeller(
            {f"{SELLER}/api/premium-article": _redirect(f"{OTHER}/collect", status)}
        )

        with patch("httpx.Client", side_effect=_real_client(seller)):
            result = request_content_with_payment("/api/premium-article")

        assert result["http_status"] == 0
        assert "Redirect blocked" in result["error_message"]
        assert seller.hosts == {"seller.example.com"}

    @patch("agent.tools.content.config")
    def test_payment_request_follows_same_origin_redirect(self, mock_config):
        mock_config.seller_api_url = SELLER
        _set_payment_context()
        seller = _MockSeller(
            {
                f"{SELLER}/api/premium-article": _redirect("/api/premium-article/v2", 307),
                f"{SELLER}/api/premium-article/v2": httpx.Response(200, json={"content": "paid"}),
            }
        )

        with patch("httpx.Client", side_effect=_real_client(seller)):
            result = request_content_with_payment("/api/premium-article")

        assert result["http_status"] == 200
        assert all("X-PAYMENT" in request.headers for request in seller.requests)


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
    def test_blocks_cross_origin_redirect(self, mock_config):
        mock_config.seller_api_url = SELLER
        seller = _MockSeller({f"{SELLER}/api/premium-article": _redirect(f"{OTHER}/402")})

        with patch("httpx.Client", side_effect=_real_client(seller)):
            result = request_service("get_premium_article")

        assert result["http_status"] == 0
        assert "Redirect blocked" in result["error_message"]
        assert seller.hosts == {"seller.example.com"}


class TestMcpInvokeUrlHandling:
    """MCPClient.invoke_tool applies the same path checks and redirect guard."""

    @staticmethod
    def _client(endpoint_path: str) -> MCPClient:
        client = MCPClient(gateway_url=SELLER)
        client._tools_cache = [
            MCPToolDefinition(
                name="get_premium_article",
                description="Get a premium article",
                operation_id="get_premium_article",
                endpoint_path=endpoint_path,
            )
        ]
        return client

    async def test_rejects_unsafe_endpoint_path_without_sending(self):
        client = self._client("@other.example/api/premium-article")

        with patch("httpx.AsyncClient") as mock_client_cls:
            result = await client.invoke_tool("get_premium_article", payment_signature="sig")

        assert result.success is False
        assert "Invalid endpoint path" in result.error
        mock_client_cls.assert_not_called()

    async def test_payment_signature_is_not_sent_across_origins(self):
        client = self._client("/api/premium-article")
        seller = _MockSeller({f"{SELLER}/api/premium-article": _redirect(f"{OTHER}/collect")})

        with patch("httpx.AsyncClient", side_effect=_real_async_client(seller)):
            result = await client.invoke_tool("get_premium_article", payment_signature="sig")

        assert result.success is False
        assert "Redirect blocked" in result.error
        assert seller.hosts == {"seller.example.com"}

    async def test_follows_same_origin_redirect(self):
        client = self._client("/api/premium-article")
        seller = _MockSeller(
            {
                f"{SELLER}/api/premium-article": _redirect("/api/premium-article/v2"),
                f"{SELLER}/api/premium-article/v2": httpx.Response(200, json={"title": "A"}),
            }
        )

        with patch("httpx.AsyncClient", side_effect=_real_async_client(seller)):
            result = await client.invoke_tool("get_premium_article")

        assert result.success is True
        assert result.data == {"title": "A"}


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
