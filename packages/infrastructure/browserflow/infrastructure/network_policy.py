from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from browserflow.domain.errors import BrowserFlowError, ErrorCode
from browserflow.infrastructure.config import get_settings

_BLOCKED_HOSTS = {
    "localhost",
    "metadata.google.internal",
    "metadata.google.com",
    "instance-data",
    "kubernetes",
    "kubernetes.default",
    "kubernetes.default.svc",
}

_BLOCKED_SUFFIXES = (".internal", ".local", ".localhost")


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast:
        return True
    if ip.is_reserved or ip.is_unspecified:
        return True
    # IPv4-mapped IPv6
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return _is_blocked_ip(ip.ipv4_mapped)
    # Cloud metadata 169.254.169.254
    return str(ip) in {"169.254.169.254", "fd00:ec2::254"}


class HttpRequestNetworkPolicy:
    def __init__(
        self, allow_private: bool | None = None, allowlist: list[str] | None = None
    ) -> None:
        settings = get_settings()
        self.allow_private = (
            settings.allow_private_network if allow_private is None else allow_private
        )
        self.allowlist = allowlist if allowlist is not None else settings.private_allowlist()

    def assert_url_allowed(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise BrowserFlowError(ErrorCode.NETWORK, "only http/https URLs are allowed")
        host = (parsed.hostname or "").lower()
        if not host:
            raise BrowserFlowError(ErrorCode.NETWORK, "URL host is required")
        if host in _BLOCKED_HOSTS or host.endswith(_BLOCKED_SUFFIXES):
            if not self._allowlisted(host):
                raise BrowserFlowError(ErrorCode.NETWORK, "host is blocked by network policy")
        if parsed.port in {5432, 6379, 2375, 2376, 8000, 8080} and host in {
            "127.0.0.1",
            "localhost",
        }:
            raise BrowserFlowError(ErrorCode.NETWORK, "internal service port blocked")
        self._assert_resolved(host)

    def _allowlisted(self, host: str) -> bool:
        return host in self.allowlist

    def _assert_resolved(self, host: str) -> None:
        try:
            infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        except socket.gaierror as exc:
            raise BrowserFlowError(ErrorCode.NETWORK, "DNS resolution failed") from exc
        if not infos:
            raise BrowserFlowError(ErrorCode.NETWORK, "DNS resolution returned no addresses")
        for info in infos:
            sockaddr = info[4]
            ip = ipaddress.ip_address(sockaddr[0])
            if _is_blocked_ip(ip) and not (self.allow_private and self._allowlisted(host)):
                if self.allow_private and self._allowlisted(str(ip)):
                    continue
                raise BrowserFlowError(
                    ErrorCode.NETWORK, "resolved IP is blocked by network policy"
                )


class BrowserRequestNetworkPolicy(HttpRequestNetworkPolicy):
    """Same rules as HTTP; used for page.goto and route interception."""

    def allow_request(self, url: str) -> bool:
        try:
            self.assert_url_allowed(url)
            return True
        except BrowserFlowError:
            return False
