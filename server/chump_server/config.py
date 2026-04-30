from __future__ import annotations

import os
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh"}
DEFAULT_MODELS = {
    "codex": "gpt-5.4",
    "openai": "gpt-5.4",
    "google": "gemini-2.5-flash",
    "anthropic": "claude-sonnet-4-20250514",
    "workers_ai": "@cf/moonshotai/kimi-k2.5",
}


@dataclass(frozen=True)
class ChumpConfig:
    host: str
    port: int
    workspace_root: Path
    data_dir: Path
    provider: str
    model: str
    max_steps: int
    command_timeout: int
    reasoning: dict[str, Any] | None
    verbose: bool


def load_config() -> ChumpConfig:
    server_dir = Path(__file__).resolve().parents[1]
    project_root = server_dir.parent
    workspace_root = Path(
        os.environ.get("CHUMP_WORKSPACE_ROOT", str(project_root))
    ).resolve()
    data_dir = Path(
        os.environ.get("CHUMP_DATA_DIR", str(project_root / ".chump"))
    ).resolve()
    auth_config = load_auth_config()
    apply_auth_environment(auth_config)

    provider = normalize_provider_name(
        os.environ.get("CHUMP_PROVIDER")
        or string_value(auth_config.get("provider"))
        or "openai"
    )

    return ChumpConfig(
        host=os.environ.get("CHUMP_HOST", "127.0.0.1"),
        port=int(os.environ.get("CHUMP_PORT", "8080")),
        workspace_root=workspace_root,
        data_dir=data_dir,
        provider=provider,
        model=(
            os.environ.get("CHUMP_MODEL")
            or string_value(auth_config.get("model"))
            or DEFAULT_MODELS[provider]
        ),
        max_steps=int(os.environ.get("CHUMP_MAX_STEPS", "64")),
        command_timeout=int(os.environ.get("CHUMP_COMMAND_TIMEOUT", "120")),
        reasoning=load_reasoning_config(auth_config, provider),
        verbose=os.environ.get("CHUMP_VERBOSE", "1").lower()
        not in {"0", "false", "no"},
    )


def load_auth_config() -> dict[str, Any]:
    auth_path = auth_file_path()
    if not auth_path.exists():
        return {}
    try:
        data = json.loads(auth_path.read_text())
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid auth config at {auth_path}: {error}") from error
    if not isinstance(data, dict):
        raise ValueError(f"invalid auth config at {auth_path}: expected object")
    return data


def auth_file_path() -> Path:
    configured = os.environ.get("CHUMP_AUTH_FILE")
    if configured:
        return Path(configured).expanduser().resolve()
    if xdg_data_home := os.environ.get("XDG_DATA_HOME"):
        return Path(xdg_data_home).expanduser() / "chump" / "auth.json"
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / "chump" / "auth.json"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "chump" / "auth.json"
    return Path.home() / ".local" / "share" / "chump" / "auth.json"


def apply_auth_environment(
    auth_config: dict[str, Any],
    provider_name: str | None = None,
) -> None:
    provider = provider_name or normalize_provider_name(
        string_value(auth_config.get("provider")) or os.environ.get("CHUMP_PROVIDER", "openai")
    )
    credentials = auth_config.get("credentials")
    if not isinstance(credentials, dict):
        return
    provider_credentials = credentials.get(provider)
    if not isinstance(provider_credentials, dict):
        return
    for key, value in provider_credentials.items():
        if isinstance(key, str) and isinstance(value, str) and key not in os.environ:
            os.environ[key] = value


def string_value(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def load_reasoning_config(
    auth_config: dict[str, Any] | None = None,
    provider: str | None = None,
) -> dict[str, Any] | None:
    reasoning: dict[str, Any] = {}
    effort = os.environ.get("CHUMP_REASONING_EFFORT")
    budget = os.environ.get("CHUMP_REASONING_BUDGET")
    configured = auth_config.get("reasoning") if auth_config else None

    if effort:
        if effort not in REASONING_EFFORTS:
            valid = ", ".join(sorted(REASONING_EFFORTS))
            raise ValueError(
                f"invalid CHUMP_REASONING_EFFORT={effort!r}; expected one of: {valid}"
            )
        reasoning["effort"] = effort
    if budget:
        reasoning["budget"] = int(budget)
    if not reasoning and isinstance(configured, dict):
        reasoning = normalize_reasoning_config(configured, provider)

    return reasoning or None


def normalize_reasoning_config(
    value: dict[str, Any] | None,
    provider: str | None,
) -> dict[str, Any] | None:
    if not value:
        return None
    mode = string_value(value.get("mode"))
    if mode == "none":
        return None
    normalized_provider = normalize_provider_name(provider or "openai")
    if normalized_provider == "google":
        budget = value.get("budget")
        if isinstance(budget, int):
            return {"budget": budget}
        if mode:
            return {"budget": reasoning_budget_for_mode(mode)}
        return None
    effort = string_value(value.get("effort")) or mode
    if not effort:
        return None
    if effort not in REASONING_EFFORTS:
        valid = ", ".join(sorted(REASONING_EFFORTS))
        raise ValueError(f"invalid reasoning effort={effort!r}; expected one of: {valid}")
    return {"effort": effort}


def reasoning_budget_for_mode(mode: str) -> int:
    budgets = {
        "low": 1024,
        "high": 8192,
        "xhigh": 16384,
        "minimal": 512,
        "medium": 4096,
    }
    if mode not in budgets:
        valid = ", ".join(["none", *budgets])
        raise ValueError(f"invalid reasoning mode={mode!r}; expected one of: {valid}")
    return budgets[mode]


def normalize_provider_name(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    if normalized in {"workersai", "workers_ai"}:
        return "workers_ai"
    if normalized in {"chatgpt", "openai_codex"}:
        return "codex"
    if normalized not in DEFAULT_MODELS:
        valid = ", ".join(sorted(DEFAULT_MODELS))
        raise ValueError(f"invalid CHUMP_PROVIDER={value!r}; expected one of: {valid}")
    return normalized
