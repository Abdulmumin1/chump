from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from ai_query.model import LanguageModel
from ai_query.providers.openai.provider import OpenAIProvider

GITHUB_COPILOT_BASE_URL = "https://api.githubcopilot.com"


class GitHubCopilotProvider(OpenAIProvider):
    name = "github_copilot"

    def __init__(
        self,
        *,
        auth_path: Path,
        auth_config: dict[str, Any],
    ) -> None:
        del auth_path
        self.auth_config = auth_config
        credentials = github_copilot_credentials(auth_config)
        self.token = (
            string_value(os.environ.get("GITHUB_COPILOT_TOKEN"))
            or string_value(credentials.get("refresh"))
            or string_value(credentials.get("access"))
        )
        if not self.token:
            raise ValueError(
                "github_copilot provider requires `chump connect` with GitHub Copilot OAuth or the GITHUB_COPILOT_TOKEN environment variable"
            )

        enterprise_url = (
            string_value(os.environ.get("GITHUB_COPILOT_ENTERPRISE_URL"))
            or string_value(credentials.get("enterprise_url"))
            or string_value(credentials.get("enterpriseUrl"))
        )

        super().__init__(
            api_key=self.token,
            base_url=github_copilot_base_url(enterprise_url),
        )

    def _get_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "User-Agent": "chump",
            "Openai-Intent": "conversation-edits",
            "x-initiator": "agent",
        }

    def _should_use_responses_api(
        self,
        *,
        tools,
        request_options: dict[str, Any],
    ) -> bool:
        del request_options
        return bool(tools)


def github_copilot_model(
    model_id: str,
    *,
    auth_path: Path,
    auth_config: dict[str, Any],
) -> LanguageModel:
    return LanguageModel(
        provider=GitHubCopilotProvider(auth_path=auth_path, auth_config=auth_config),
        model_id=model_id,
    )


def github_copilot_credentials(auth_config: dict[str, Any]) -> dict[str, Any]:
    credentials = auth_config.setdefault("credentials", {})
    if not isinstance(credentials, dict):
        raise ValueError("invalid auth config: credentials must be an object")
    provider_credentials = credentials.setdefault("github_copilot", {})
    if not isinstance(provider_credentials, dict):
        raise ValueError("invalid auth config: credentials.github_copilot must be an object")
    return provider_credentials


def github_copilot_base_url(enterprise_url: str | None) -> str:
    if not enterprise_url:
        return GITHUB_COPILOT_BASE_URL
    normalized = enterprise_url.replace("https://", "").replace("http://", "").rstrip("/")
    return f"https://copilot-api.{normalized}"


def string_value(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None
