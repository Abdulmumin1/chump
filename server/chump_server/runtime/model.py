from __future__ import annotations

import os
from typing import Any

from ai_query.model import InputModality, LanguageModel
from ai_query.providers import (
    anthropic,
    deepseek,
    groq,
    openai,
    openrouter,
    workers_ai,
)
from ai_query.providers.openai.provider import OpenAIProvider
from ai_query.types import Message

from ..config import (
    DEFAULT_CHUMP_CLOUD_BASE_URL,
    ChumpConfig,
    auth_file_path,
    load_auth_config,
)
from ..providers.codex import codex_model
from ..providers.github_copilot import github_copilot_model
from ..providers.google import google_model
from ..providers.openai_compatible import (
    opencode_go_model,
    opencode_model,
    zenmux_model,
)
from ..providers.xai import xai_model


IMAGE_INPUT_MODELS = {
    "anthropic": frozenset({"claude-sonnet-4-20250514"}),
    "chump_cloud": frozenset({"gemini-3.7-flash"}),
    "codex": frozenset(
        {
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5.5",
            "gpt-5.6",
            "gpt-5.6-luna",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
        }
    ),
    "github_copilot": frozenset({"gpt-5.4"}),
    "google": frozenset(
        {
            "gemini-3-flash-preview",
            "gemini-3-pro-preview",
            "gemini-3.1-pro-preview",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.7-flash",
        }
    ),
    "openai": frozenset(
        {
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5.4-nano",
            "gpt-5.4-pro",
            "gpt-5.5",
            "gpt-5.6",
            "gpt-5.6-luna",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
        }
    ),
    "opencode": frozenset(
        {"claude-sonnet-4-5", "gemini-3.1-pro", "gpt-5.4", "gpt-5.5"}
    ),
    "openrouter": frozenset(
        {"anthropic/claude-sonnet-4.5", "openai/gpt-5.4", "openai/gpt-5.5"}
    ),
    "workers_ai": frozenset(
        {"@cf/moonshotai/kimi-k2.6", "@cf/moonshotai/kimi-k2.7-code"}
    ),
    "xai": frozenset({"grok-4-fast", "grok-4.3", "grok-4-1-fast"}),
    "zenmux": frozenset(
        {
            "anthropic/claude-sonnet-4.5",
            "openai/gpt-5.4",
            "openai/gpt-5.5",
            "x-ai/grok-4.1-fast",
        }
    ),
}

FILE_INPUT_MODELS = {
    provider: IMAGE_INPUT_MODELS[provider]
    for provider in ("anthropic", "chump_cloud", "google", "openai")
}


def model_input_modalities(provider: str, model: str) -> tuple[InputModality, ...]:
    modalities: list[InputModality] = ["text"]
    if model in IMAGE_INPUT_MODELS.get(provider, ()):
        modalities.append("image")
    if model in FILE_INPUT_MODELS.get(provider, ()):
        modalities.append("file")
    return tuple(modalities)


def resolve_model(config: ChumpConfig) -> LanguageModel:
    provider_name = config.provider.lower()
    model = _create_model(config, provider_name)
    model.input_modalities = model_input_modalities(provider_name, config.model)
    return model


def _create_model(config: ChumpConfig, provider_name: str) -> LanguageModel:
    auth_path = auth_file_path()
    auth_config = load_auth_config()
    if provider_name == "codex":
        return codex_model(
            config.model,
            auth_path=auth_path,
            auth_config=auth_config,
        )
    if provider_name == "openai":
        return openai(
            config.model,
            base_url=os.environ.get("OPENAI_BASE_URL"),
            organization=os.environ.get("OPENAI_ORGANIZATION"),
        )
    if provider_name == "chump_cloud":
        base_url = (
            os.environ.get("CHUMP_CLOUD_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or DEFAULT_CHUMP_CLOUD_BASE_URL
        ).rstrip("/")
        return LanguageModel(
            provider=ChumpCloudProvider(
                api_key="chump-cloud",
                base_url=base_url,
            ),
            model_id=config.model,
        )
    if provider_name == "google":
        return google_model(config.model)
    if provider_name == "anthropic":
        return anthropic(config.model, base_url=os.environ.get("ANTHROPIC_BASE_URL"))
    if provider_name == "workers_ai":
        return workers_ai(config.model)
    if provider_name == "deepseek":
        return deepseek(config.model)
    if provider_name == "openrouter":
        return openrouter(config.model)
    if provider_name == "groq":
        return groq(config.model)
    if provider_name == "xai":
        return xai_model(
            config.model,
            auth_path=auth_path,
            auth_config=auth_config,
        )
    if provider_name == "github_copilot":
        return github_copilot_model(
            config.model,
            auth_path=auth_path,
            auth_config=auth_config,
        )
    if provider_name == "opencode":
        return opencode_model(config.model)
    if provider_name == "opencode_go":
        return opencode_go_model(config.model)
    if provider_name == "zenmux":
        return zenmux_model(config.model)
    raise ValueError(f"unsupported provider: {config.provider}")


class ChumpCloudProvider(OpenAIProvider):
    name = "chump_cloud"
    _upstream_max_tokens_param = "max_tokens"

    def __init__(self, *, api_key: str, base_url: str) -> None:
        super().__init__(api_key=api_key, base_url=base_url)

    def _get_headers(self) -> dict[str, str]:
        headers = super()._get_headers()
        if self.cache_key:
            headers["x-session-affinity"] = self.cache_key
        return headers

    async def _convert_messages(
        self, messages: list[Message]
    ) -> list[dict[str, Any]]:
        converted: list[dict[str, Any]] = []
        for message in messages:
            message_items = await super()._convert_messages([message])
            if message.role == "assistant":
                for item in message_items:
                    if item.get("role") == "assistant":
                        item["reasoning_content"] = self.reasoning_text(message)
            converted.extend(message_items)
        return converted
