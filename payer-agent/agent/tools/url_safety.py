"""Outbound URL handling for requests to the seller API.

Tool arguments that end up in an outbound URL are chosen by the model, so they are untrusted
input: text the agent reads (content, discovery results, user messages) can influence them. A
path is appended to the configured seller base URL only after checking that it cannot change
where the request goes, and the result is verified to stay on the seller's scheme, host and port.
"""

import httpx


class UnsafeRequestUrlError(ValueError):
    """Raised when a tool-supplied path would send a request outside the seller API."""


# Characters never needed in a seller API path that can move the URL authority.
_FORBIDDEN_PATH_CHARS = frozenset("@\\")


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
    if any(ch in _FORBIDDEN_PATH_CHARS or ord(ch) <= 0x20 or ord(ch) == 0x7F for ch in path):
        raise UnsafeRequestUrlError("path contains characters that are not allowed")

    full_url = f"{base_url.rstrip('/')}{path}"
    base = httpx.URL(base_url)
    full = httpx.URL(full_url)
    if full.userinfo or (full.scheme, full.host, full.port) != (base.scheme, base.host, base.port):
        raise UnsafeRequestUrlError("path would send the request outside the seller API")
    return full_url
