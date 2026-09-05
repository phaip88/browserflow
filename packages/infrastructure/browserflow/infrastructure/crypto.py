from __future__ import annotations

import json
import os
from typing import Any

from browserflow.domain.errors import BrowserFlowError, ErrorCode
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class SecretBox:
    """AES-256-GCM authenticated encryption for credentials."""

    def __init__(self, key: bytes) -> None:
        if len(key) < 32:
            raise BrowserFlowError(ErrorCode.SYSTEM, "master key must be 32 bytes")
        self._aes = AESGCM(key[:32])

    def encrypt(self, payload: dict[str, Any]) -> tuple[bytes, bytes]:
        nonce = os.urandom(12)
        data = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return nonce, self._aes.encrypt(nonce, data, None)

    def decrypt(self, nonce: bytes, ciphertext: bytes) -> dict[str, Any]:
        try:
            raw = self._aes.decrypt(nonce, ciphertext, None)
        except Exception as exc:
            raise BrowserFlowError(ErrorCode.CREDENTIAL, "credential decrypt failed") from exc
        parsed = json.loads(raw.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise BrowserFlowError(ErrorCode.CREDENTIAL, "credential payload is not an object")
        return parsed
