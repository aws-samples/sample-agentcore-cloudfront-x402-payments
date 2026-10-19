"""Outbound URL handling for requests to the seller API.

Tool arguments that end up in an outbound URL are chosen by the model, so they are untrusted
input: text the agent reads (content, discovery results, user messages) can influence them. A
path is appended to the configured seller base URL only after checking that it cannot change
where the request goes, and the result is verified to stay on the seller's scheme, host and port.
Redirects are followed only while they stay on the seller's origin.
"""

import re
from typing import Any, Callable
from urllib.parse import unquote

import httpx


class UnsafeRequestUrlError(ValueError):
    """Raised when a tool-supplied path would send a request outside the seller API."""


class UnsafeRedirectError(httpx.RequestError):
    """Raised before following a redirect that leaves the seller API's origin."""


# Characters never needed in a seller API path that can move the URL authority.
_FORBIDDEN_PATH_CHARS = frozenset("@\\")

# Decoding rounds before giving up: two layers of percent-encoding plus one round to confirm the
# path is stable. Anything encoded more deeply is rejected.
_MAX_DECODE_ROUNDS = 3

_SEGMENT_SEPARATORS = re.compile(r"[/?#]")


def _decode_percent_encoding(path: str) -> str:
    """Decode percent-encoding until the path stops changing.

    Servers and proxies may decode a path one or more times, so the checks below run on the
    fully decoded form: an encoded "@", "\\", ".." or control character gets the same treatment
    as the literal character.
    """
    for _ in range(_MAX_DECODE_ROUNDS):
        try:
            decoded = unquote(path, errors="strict")
        except UnicodeDecodeError as e:
            raise UnsafeRequestUrlError("path contains invalid percent-encoding") from e
        if decoded == path:
            return path
        path = decoded
    raise UnsafeRequestUrlError("path is percent-encoded too many times")


def build_seller_url(base_url: str, path: str) -> str:
    """Join the configured seller base URL and a tool-supplied path.

    Args:
        base_url: The operator-configured seller API base URL (SELLER_API_URL).
        path: The path supplied by the model, for example "/api/premium-article".

    Returns:
        The full request URL, guaranteed to be on the same scheme, host and port as base_url.

    Raises:
        UnsafeRequestUrlError: If the base URL is missing or the path could redirect the
            request to a different origin.
    """
    if not base_url:
        raise UnsafeRequestUrlError("SELLER_API_URL is not configured")
    if not isinstance(path, str) or not path.startswith("/") or path.startswith("//"):
        raise UnsafeRequestUrlError("path must be a relative path that starts with a single '/'")

    decoded = _decode_percent_encoding(path)
    # Printable ASCII only: rejects whitespace, control characters and non-ASCII look-alikes.
    if any(ch in _FORBIDDEN_PATH_CHARS or not 0x20 < ord(ch) < 0x7F for ch in decoded):
        raise UnsafeRequestUrlError("path contains characters that are not allowed")
    if decoded.startswith("//"):
        raise UnsafeRequestUrlError("path must be a relative path that starts with a single '/'")
    if any(segment in (".", "..") for segment in _SEGMENT_SEPARATORS.split(decoded)):
        raise UnsafeRequestUrlError("path must not contain '.' or '..' segments")

    full_url = f"{base_url.rstrip('/')}{path}"
    base = httpx.URL(base_url)
    full = httpx.URL(full_url)
    if full.userinfo or (full.scheme, full.host, full.port) != (base.scheme, base.host, base.port):
        raise UnsafeRequestUrlError("path would send the request outside the seller API")
    return full_url


def is_seller_origin(base_url: str, url: httpx.URL | str) -> bool:
    """Return True if url is on the seller API's origin.

    An upgrade from http to https on the same host is also accepted, because the seller's
    CloudFront distribution redirects HTTP to HTTPS.
    """
    base = httpx.URL(base_url)
    target = httpx.URL(url)
    if target.userinfo or target.host != base.host:
        return False
    if (target.scheme, target.port) == (base.scheme, base.port):
        return True
    return base.scheme == "http" and target.scheme == "https" and not base.port and not target.port


def _redirect_guard(base_url: str) -> Callable[[httpx.Request], None]:
    def check(request: httpx.Request) -> None:
        if not is_seller_origin(base_url, request.url):
            raise UnsafeRedirectError(
                "Redirect blocked: the seller API redirected to a different origin",
                request=request,
            )

    return check


def redirect_guard_hooks(base_url: str) -> dict[str, list[Any]]:
    """Event hooks for httpx.Client that stop redirects from leaving the seller's origin.

    httpx runs request hooks before sending every request, including each redirect hop, so a
    hop to another origin is refused before any header (including the x402 payment header)
    is sent to it. Same-origin redirects are followed as usual.
    """
    return {"request": [_redirect_guard(base_url)]}


def async_redirect_guard_hooks(base_url: str) -> dict[str, list[Any]]:
    """The same event hooks as redirect_guard_hooks, for httpx.AsyncClient."""
    check = _redirect_guard(base_url)

    async def async_check(request: httpx.Request) -> None:
        check(request)

    return {"request": [async_check]}
