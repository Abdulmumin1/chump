from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ai_query.model import LanguageModel
from ai_query.providers.openai.provider import OpenAIProvider

XAI_API_BASE_URL = "https://api.x.ai/v1"
XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token"
XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
XAI_ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000


class XAIProvider(OpenAIProvider):
    name = "xai"
    _upstream_max_tokens_param = "max_tokens"

    def __init__(
        self,
        *,
        auth_path: Path,
        auth_config: dict[str, Any],
    ) -> None:
        self.auth_path = auth_path
        self.auth_config = auth_config
        self.access_token: str | None = None
        self.refresh_token: str | None = None
        self.expires = 0
        self._uses_oauth = False

        api_key = os.environ.get("XAI_API_KEY")
        if api_key:
            super().__init__(api_key=api_key, base_url=XAI_API_BASE_URL)
            return

        credentials = xai_credentials(auth_config)
        self.access_token = string_value(credentials.get("access"))
        self.refresh_token = string_value(credentials.get("refresh"))
        self.expires = number_value(credentials.get("expires")) or 0
        self._uses_oauth = bool(self.refresh_token)
        if not self._uses_oauth:
            raise ValueError(
                "xai provider requires `chump connect` with an xAI API key or Grok OAuth subscription"
            )

        super().__init__(api_key=self.access_token or "chump-xai-oauth", base_url=XAI_API_BASE_URL)

    def _get_headers(self) -> dict[str, str]:
        if not self._uses_oauth:
            headers = super()._get_headers()
            headers["User-Agent"] = "chump"
            return headers

        self._refresh_if_needed()
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "User-Agent": "chump",
        }

    def _refresh_if_needed(self) -> None:
        if not self._uses_oauth:
            return
        if self.access_token and self.expires > int(time.time() * 1000) + XAI_ACCESS_TOKEN_REFRESH_SKEW_MS:
            return
        if not self.refresh_token:
            raise ValueError("xai oauth credentials are missing a refresh token")

        tokens = refresh_access_token(self.refresh_token)
        self.access_token = string_value(tokens.get("access_token"))
        refreshed_refresh_token = string_value(tokens.get("refresh_token"))
        if refreshed_refresh_token:
            self.refresh_token = refreshed_refresh_token
        self.expires = int(time.time() * 1000) + int(tokens.get("expires_in", 3600)) * 1000
        if not self.access_token:
            raise ValueError("xai token refresh did not return an access token")

        credentials = xai_credentials(self.auth_config)
        credentials.update(
            {
                "type": "oauth",
                "access": self.access_token,
                "refresh": self.refresh_token,
                "expires": self.expires,
            }
        )
        write_auth_config(self.auth_path, self.auth_config)


def xai_model(
    model_id: str,
    *,
    auth_path: Path,
    auth_config: dict[str, Any],
) -> LanguageModel:
    return LanguageModel(
        provider=XAIProvider(auth_path=auth_path, auth_config=auth_config),
        model_id=model_id,
    )


def xai_credentials(auth_config: dict[str, Any]) -> dict[str, Any]:
    credentials = auth_config.setdefault("credentials", {})
    if not isinstance(credentials, dict):
        raise ValueError("invalid auth config: credentials must be an object")
    provider_credentials = credentials.setdefault("xai", {})
    if not isinstance(provider_credentials, dict):
        raise ValueError("invalid auth config: credentials.xai must be an object")
    return provider_credentials


def refresh_access_token(refresh_token: str) -> dict[str, Any]:
    body = urlencode(
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": XAI_CLIENT_ID,
        }
    ).encode()
    request = Request(
        XAI_TOKEN_URL,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "chump",
        },
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def write_auth_config(auth_path: Path, auth_config: dict[str, Any]) -> None:
    auth_path.parent.mkdir(parents=True, exist_ok=True)
    auth_path.write_text(f"{json.dumps(auth_config, indent=2)}\n")
    auth_path.chmod(0o600)


def string_value(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def number_value(value: Any) -> int | None:
    if isinstance(value, (int, float)):
        return int(value)
    return None
