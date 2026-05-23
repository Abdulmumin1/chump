from __future__ import annotations

import os

from ai_query.model import LanguageModel
from ai_query.providers import anthropic, deepseek, google, openai, workers_ai
from ai_query.providers.deepseek.provider import DeepSeekProvider

from ..codex_provider import codex_model
from ..config import (
    DEFAULT_CHUMP_CLOUD_BASE_URL,
    ChumpConfig,
    auth_file_path,
    load_auth_config,
)


def resolve_model(config: ChumpConfig):
    provider_name = config.provider.lower()
    if provider_name == "codex":
        return codex_model(
            config.model,
            auth_path=auth_file_path(),
            auth_config=load_auth_config(),
        )
    if provider_name == "openai":
        return openai(
            config.model,
            base_url=os.environ.get("OPENAI_BASE_URL"),
            organization=os.environ.get("OPENAI_ORGANIZATION"),
        )
    if provider_name == "chump_cloud":
        return LanguageModel(
            provider=ChumpCloudProvider(
                api_key="chump-cloud",
                base_url=os.environ.get("CHUMP_CLOUD_BASE_URL")
                or os.environ.get("OPENAI_BASE_URL")
                or DEFAULT_CHUMP_CLOUD_BASE_URL,
            ),
            model_id=config.model,
        )
    if provider_name == "google":
        return google(config.model)
    if provider_name == "anthropic":
        return anthropic(config.model, base_url=os.environ.get("ANTHROPIC_BASE_URL"))
    if provider_name == "workers_ai":
        return workers_ai(config.model)
    if provider_name == "deepseek":
        return deepseek(config.model)
    raise ValueError(f"unsupported provider: {config.provider}")


class ChumpCloudProvider(DeepSeekProvider):
    name = "chump_cloud"

    def __init__(self, *, api_key: str, base_url: str) -> None:
        super().__init__(api_key=api_key)
        self.base_url = base_url
