from __future__ import annotations

import os

from ai_query.model import LanguageModel
from ai_query.providers.openai.provider import OpenAIProvider


class OpenCodeProvider(OpenAIProvider):
    name = "opencode"

    def __init__(self) -> None:
        api_key = os.environ.get("OPENCODE_API_KEY")
        if not api_key:
            raise ValueError(
                "Error: OPENCODE_API_KEY is missing. Pass it using `chump connect` or the OPENCODE_API_KEY environment variable."
            )
        super().__init__(api_key=api_key, base_url="https://opencode.ai/zen/v1")


class OpenCodeGoProvider(OpenAIProvider):
    name = "opencode_go"

    def __init__(self) -> None:
        api_key = os.environ.get("OPENCODE_API_KEY")
        if not api_key:
            raise ValueError(
                "Error: OPENCODE_API_KEY is missing. Pass it using `chump connect` or the OPENCODE_API_KEY environment variable."
            )
        super().__init__(api_key=api_key, base_url="https://opencode.ai/zen/go/v1")


class ZenMuxProvider(OpenAIProvider):
    name = "zenmux"

    def __init__(self) -> None:
        api_key = os.environ.get("ZENMUX_API_KEY")
        if not api_key:
            raise ValueError(
                "Error: ZENMUX_API_KEY is missing. Pass it using `chump connect` or the ZENMUX_API_KEY environment variable."
            )
        super().__init__(api_key=api_key, base_url="https://zenmux.ai/api/v1")


def opencode_model(model_id: str) -> LanguageModel:
    return LanguageModel(provider=OpenCodeProvider(), model_id=model_id)


def opencode_go_model(model_id: str) -> LanguageModel:
    return LanguageModel(provider=OpenCodeGoProvider(), model_id=model_id)


def zenmux_model(model_id: str) -> LanguageModel:
    return LanguageModel(provider=ZenMuxProvider(), model_id=model_id)
