from __future__ import annotations

from typing import Any

from ai_query.model import LanguageModel
from ai_query.providers.google.provider import GoogleProvider
from ai_query.types import ProviderOptions


class ChumpGoogleProvider(GoogleProvider):
    def apply_reasoning(
        self,
        provider_options: ProviderOptions | None,
        reasoning: dict[str, Any],
        *,
        model: str,
    ) -> ProviderOptions | None:
        if not reasoning:
            return provider_options

        if "effort" in reasoning:
            raise ValueError(
                f"{self.name} provider does not support normalized reasoning.effort yet; "
                f"use provider_options['{self.name}']['thinking_config'] for model-specific thinking controls."
            )

        unsupported = [key for key in reasoning if key != "budget"]
        if unsupported:
            raise ValueError(
                f"{self.name} provider does not support normalized reasoning fields: {', '.join(sorted(unsupported))}."
            )

        updated, options = self._get_or_create_provider_options_namespace(
            provider_options
        )
        conflicts = [
            key for key in ["thinking_config", "thinkingConfig"] if key in options
        ]
        if conflicts:
            self._raise_reasoning_conflict(model=model, conflicting_keys=conflicts)

        budget = reasoning.get("budget")
        if budget is not None:
            options["thinking_config"] = {
                "thinking_budget": budget,
                "include_thoughts": True,
            }

        return updated


def google_model(model_id: str) -> LanguageModel:
    return LanguageModel(provider=ChumpGoogleProvider(), model_id=model_id)
