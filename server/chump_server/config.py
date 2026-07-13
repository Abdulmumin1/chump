from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh"}
DEFAULT_PROVIDER = "chump_cloud"
DEFAULT_MAX_STEPS = 250
DEFAULT_COMPACTION_TOKENS = 200_000
DEFAULT_COMPACTION_KEEP_RECENT_TOKENS = 20_000
DEFAULT_CHUMP_CLOUD_BASE_URL = "https://chump-cloud.yaqeen.me/v1"
DEFAULT_ALLOWED_ORIGINS: tuple[str, ...] = (
    "https://chump.yaqeen.me",
    # Local dev for the Svelte web client (Vite default port).
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    # SvelteKit preview / build (`vite preview` / `wrangler dev`) defaults.
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)
DEFAULT_MODELS = {
    "codex": "gpt-5.4",
    "github_copilot": "gpt-5.4",
    "openai": "gpt-5.4",
    "chump_cloud": "deepseek-v4-flash",
    "google": "gemini-3.5-flash",
    "anthropic": "claude-sonnet-4-20250514",
    "workers_ai": "@cf/zai-org/glm-5.2",
    "deepseek": "deepseek-v4-pro",
    "openrouter": "anthropic/claude-sonnet-4.5",
    "groq": "openai/gpt-oss-120b",
    "xai": "grok-code-fast-1",
    "opencode": "gpt-5.4",
    "opencode_go": "deepseek-v4-flash",
    "zenmux": "anthropic/claude-sonnet-4.5",
}

PROVIDER_MODELS = {
    "codex": {
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.4-mini",
    },
    "github_copilot": {
        "gpt-5.4",
    },
    "openai": {
        "gpt-5.5",
        "gpt-5.4-pro",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
    },
    "chump_cloud": {
        "deepseek-v4-pro",
        "deepseek-v4-flash",
    },
    "google": {
        "gemini-3.5-flash",
        "gemini-3.1-pro-preview",
        "gemini-3-pro-preview",
        "gemini-3-flash-preview",
    },
    "anthropic": {
        "claude-sonnet-4-20250514",
    },
    "workers_ai": {
        "@cf/zai-org/glm-5.2",
        "@cf/zai-org/glm-4.7-flash",
        "@cf/nvidia/nemotron-3-120b-a12b",
        "@cf/moonshotai/kimi-k2.7-code",
    },
    "deepseek": {
        "deepseek-v4-pro",
        "deepseek-v4-flash",
    },
    "openrouter": {
        "openai/gpt-5.5",
        "openai/gpt-5.4",
        "anthropic/claude-sonnet-4.5",
        "deepseek/deepseek-v4-pro",
        "qwen/qwen3.6-plus",
    },
    "groq": {
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3-32b",
        "groq/compound-mini",
    },
    "xai": {
        "grok-4.3",
        "grok-4-1-fast",
        "grok-4-fast",
        "grok-code-fast-1",
    },
    "opencode": {
        "gpt-5.5",
        "gpt-5.4",
        "claude-sonnet-4-5",
        "gemini-3.1-pro",
        "glm-5.1",
        "qwen3.6-plus",
        "minimax-m2.7",
        "deepseek-v4-flash-free",
    },
    "opencode_go": {
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "glm-5",
        "glm-5.1",
        "mimo-v2.5",
        "mimo-v2.5-pro",
        "minimax-m2.5",
        "minimax-m2.7",
        "qwen3.5-plus",
        "qwen3.6-plus",
    },
    "zenmux": {
        "openai/gpt-5.5",
        "openai/gpt-5.4",
        "anthropic/claude-sonnet-4.5",
        "deepseek/deepseek-v4-pro",
        "qwen/qwen3.6-plus",
        "x-ai/grok-4.1-fast",
        "z-ai/glm-5.1",
        "volcengine/doubao-seed-code",
    },
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
    retry_max_attempts: int
    retry_initial_delay: float
    retry_max_delay: float
    retry_backoff: float
    retry_jitter: bool
    command_timeout: int
    managed_idle_timeout: int | None
    compaction_tokens: int | None
    compaction_keep_recent_tokens: int
    reasoning: dict[str, Any] | None
    verbose: bool
    allowed_origins: tuple[str, ...]
    available_providers: tuple[str, ...]


def load_config() -> ChumpConfig:
    server_dir = Path(__file__).resolve().parents[1]
    project_root = server_dir.parent
    workspace_root = Path(
        os.environ.get("CHUMP_WORKSPACE_ROOT", str(project_root))
    ).resolve()
    data_dir = workspace_state_dir(workspace_root)
    migrate_legacy_workspace_state(workspace_root, data_dir)
    auth_config = load_auth_config()
    apply_auth_environment(auth_config)
    repo_config = load_repo_config(workspace_root)
    global_config = load_global_config()

    provider = normalize_provider_name(
        os.environ.get("CHUMP_PROVIDER")
        or repo_config.get("provider")
        or global_config.get("provider")
        or string_value(auth_config.get("provider"))
        or DEFAULT_PROVIDER
    )

    env_model = os.environ.get("CHUMP_MODEL")
    config_model = (
        repo_config.get("model")
        or global_config.get("model")
        or string_value(auth_config.get("model"))
    )
    model = normalize_model_name(
        provider,
        env_model or config_model or DEFAULT_MODELS[provider],
        strict=env_model is not None,
    )

    host = (
        os.environ.get("CHUMP_HOST")
        or repo_config.get("host")
        or global_config.get("host")
        or "127.0.0.1"
    )

    port_raw = (
        os.environ.get("CHUMP_PORT")
        or repo_config.get("port")
        or global_config.get("port")
    )
    port = int(port_raw) if port_raw is not None else 8080

    max_steps_raw = (
        os.environ.get("CHUMP_MAX_STEPS")
        or repo_config.get("max_steps")
        or global_config.get("max_steps")
    )
    max_steps = int(max_steps_raw) if max_steps_raw is not None else DEFAULT_MAX_STEPS

    retry_max_attempts_raw = (
        os.environ.get("CHUMP_RETRY_MAX_ATTEMPTS")
        or repo_config.get("retry_max_attempts")
        or nested_config_value(repo_config, "retry", "max_attempts")
        or global_config.get("retry_max_attempts")
        or nested_config_value(global_config, "retry", "max_attempts")
    )
    retry_max_attempts = int(retry_max_attempts_raw) if retry_max_attempts_raw is not None else 3

    retry_initial_delay_raw = (
        os.environ.get("CHUMP_RETRY_INITIAL_DELAY")
        or repo_config.get("retry_initial_delay")
        or nested_config_value(repo_config, "retry", "initial_delay")
        or global_config.get("retry_initial_delay")
        or nested_config_value(global_config, "retry", "initial_delay")
    )
    retry_initial_delay = float(retry_initial_delay_raw) if retry_initial_delay_raw is not None else 0.5

    retry_max_delay_raw = (
        os.environ.get("CHUMP_RETRY_MAX_DELAY")
        or repo_config.get("retry_max_delay")
        or nested_config_value(repo_config, "retry", "max_delay")
        or global_config.get("retry_max_delay")
        or nested_config_value(global_config, "retry", "max_delay")
    )
    retry_max_delay = float(retry_max_delay_raw) if retry_max_delay_raw is not None else 8.0

    retry_backoff_raw = (
        os.environ.get("CHUMP_RETRY_BACKOFF")
        or repo_config.get("retry_backoff")
        or nested_config_value(repo_config, "retry", "backoff")
        or global_config.get("retry_backoff")
        or nested_config_value(global_config, "retry", "backoff")
    )
    retry_backoff = float(retry_backoff_raw) if retry_backoff_raw is not None else 2.0

    retry_jitter_raw = (
        os.environ.get("CHUMP_RETRY_JITTER")
        or repo_config.get("retry_jitter")
        or nested_config_value(repo_config, "retry", "jitter")
        or global_config.get("retry_jitter")
        or nested_config_value(global_config, "retry", "jitter")
    )
    retry_jitter = bool_value(retry_jitter_raw, default=True)

    command_timeout_raw = (
        os.environ.get("CHUMP_COMMAND_TIMEOUT")
        or repo_config.get("command_timeout")
        or global_config.get("command_timeout")
    )
    command_timeout = int(command_timeout_raw) if command_timeout_raw is not None else 120

    managed_idle_timeout_raw = (
        os.environ.get("CHUMP_MANAGED_SERVER_IDLE_TIMEOUT")
        or repo_config.get("managed_idle_timeout")
        or repo_config.get("managed_server_idle_timeout")
        or global_config.get("managed_idle_timeout")
        or global_config.get("managed_server_idle_timeout")
    )
    managed_idle_timeout = int_value(managed_idle_timeout_raw)

    verbose_raw = (
        os.environ.get("CHUMP_VERBOSE")
        or repo_config.get("verbose")
        or global_config.get("verbose")
    )
    if verbose_raw is not None:
        verbose = str(verbose_raw).lower() not in {"0", "false", "no", "off"}
    else:
        verbose = True

    return ChumpConfig(
        host=host,
        port=port,
        workspace_root=workspace_root,
        data_dir=data_dir,
        provider=provider,
        model=model,
        max_steps=max_steps,
        retry_max_attempts=retry_max_attempts,
        retry_initial_delay=retry_initial_delay,
        retry_max_delay=retry_max_delay,
        retry_backoff=retry_backoff,
        retry_jitter=retry_jitter,
        command_timeout=command_timeout,
        managed_idle_timeout=managed_idle_timeout,
        compaction_tokens=load_compaction_tokens(auth_config, repo_config, global_config),
        compaction_keep_recent_tokens=load_compaction_keep_recent_tokens(
            auth_config, repo_config, global_config
        ),
        reasoning=load_reasoning_config(auth_config, provider, repo_config, global_config),
        verbose=verbose,
        allowed_origins=load_allowed_origins(repo_config, global_config),
        available_providers=load_available_providers(auth_config),
    )


def load_repo_config(workspace_root: Path) -> dict[str, Any]:
    config_path = workspace_root / ".chump" / "config.json"
    if not config_path.exists():
        return {}
    try:
        data = json.loads(config_path.read_text())
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid repo config at {config_path}: {error}") from error
    if not isinstance(data, dict):
        raise ValueError(f"invalid repo config at {config_path}: expected object")
    return data


def global_config_dir() -> Path:
    configured = os.environ.get("CHUMP_AGENT_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    if xdg_config_home := os.environ.get("XDG_CONFIG_HOME"):
        return Path(xdg_config_home).expanduser() / "chump"
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / "chump"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "chump"
    return Path.home() / ".chump"


def load_global_config() -> dict[str, Any]:
    configured = os.environ.get("CHUMP_CONFIG_FILE")
    if configured:
        config_path = Path(configured).expanduser().resolve()
    else:
        config_path = global_config_dir() / "config.json"

    if not config_path.exists():
        return {}
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid global config at {config_path}: {error}") from error
    if not isinstance(data, dict):
        raise ValueError(f"invalid global config at {config_path}: expected object")
    return data


def load_compaction_tokens(
    auth_config: dict[str, Any],
    repo_config: dict[str, Any],
    global_config: dict[str, Any],
) -> int | None:
    raw = first_config_value(
        os.environ.get("CHUMP_COMPACTION_TOKENS"),
        repo_config.get("compaction_tokens"),
        nested_config_value(repo_config, "compaction", "tokens"),
        global_config.get("compaction_tokens"),
        nested_config_value(global_config, "compaction", "tokens"),
        auth_config.get("compaction_tokens"),
        nested_config_value(auth_config, "compaction", "tokens"),
        DEFAULT_COMPACTION_TOKENS,
    )
    return normalize_optional_positive_int(raw, "compaction_tokens")


def load_compaction_keep_recent_tokens(
    auth_config: dict[str, Any],
    repo_config: dict[str, Any],
    global_config: dict[str, Any],
) -> int:
    raw = first_config_value(
        os.environ.get("CHUMP_COMPACTION_KEEP_RECENT_TOKENS"),
        repo_config.get("compaction_keep_recent_tokens"),
        nested_config_value(repo_config, "compaction", "keep_recent_tokens"),
        global_config.get("compaction_keep_recent_tokens"),
        nested_config_value(global_config, "compaction", "keep_recent_tokens"),
        auth_config.get("compaction_keep_recent_tokens"),
        nested_config_value(auth_config, "compaction", "keep_recent_tokens"),
        DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
    )
    value = normalize_optional_positive_int(raw, "compaction_keep_recent_tokens")
    return value if value is not None else DEFAULT_COMPACTION_KEEP_RECENT_TOKENS


def first_config_value(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def nested_config_value(config: dict[str, Any], section: str, key: str) -> Any:
    section_value = config.get(section)
    if not isinstance(section_value, dict):
        return None
    return section_value.get(key)


def normalize_optional_positive_int(value: Any, name: str) -> int | None:
    if isinstance(value, str) and value.lower() in {
        "0",
        "false",
        "off",
        "none",
        "disabled",
    }:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid {name}: expected positive integer or disabled") from error
    if parsed <= 0:
        return None
    return parsed


def load_available_providers(auth_config: dict[str, Any]) -> tuple[str, ...]:
    credentials = auth_config.get("credentials")
    if not isinstance(credentials, dict):
        return ("chump_cloud",)
    providers = {"chump_cloud"} | set(credentials.keys())
    return tuple(sorted(providers))


def load_allowed_origins(
    repo_config: dict[str, Any] | None = None,
    global_config: dict[str, Any] | None = None,
) -> tuple[str, ...]:
    raw = os.environ.get("CHUMP_ALLOWED_ORIGINS")
    if raw is not None:
        return tuple(origin.strip() for origin in raw.split(",") if origin.strip())

    config_val = (
        (repo_config.get("allowed_origins") if repo_config else None)
        or (global_config.get("allowed_origins") if global_config else None)
    )
    if isinstance(config_val, list):
        return tuple(str(origin).strip() for origin in config_val if str(origin).strip())
    elif isinstance(config_val, str):
        return tuple(origin.strip() for origin in config_val.split(",") if origin.strip())

    return DEFAULT_ALLOWED_ORIGINS


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


def workspace_state_dir(workspace_root: Path) -> Path:
    configured = os.environ.get("CHUMP_STATE_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return (_state_base_dir() / "workspaces" / _workspace_state_slug(workspace_root)).resolve()


def _state_base_dir() -> Path:
    if xdg_state_home := os.environ.get("XDG_STATE_HOME"):
        return Path(xdg_state_home).expanduser() / "chump"
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / "chump"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "chump"
    return Path.home() / ".local" / "state" / "chump"


def _workspace_state_slug(workspace_root: Path) -> str:
    name = re.sub(r"[^a-z0-9_-]+", "-", workspace_root.name.lower()).strip("-")
    if not name:
        name = "workspace"
    digest = hashlib.sha256(str(workspace_root).encode("utf-8")).hexdigest()[:16]
    return f"{name}-{digest}"


def migrate_legacy_workspace_state(workspace_root: Path, data_dir: Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    legacy_dir = workspace_root / ".chump"
    legacy_paths = [
        workspace_root / ".chump.sqlite3",
        legacy_dir / "chump.sqlite3",
        legacy_dir / "server.json",
        legacy_dir / "server.log",
        legacy_dir / "server.lock",
        legacy_dir / "client.log",
    ]

    for source in legacy_paths:
        _move_legacy_path(source, data_dir / source.name)


def _move_legacy_path(source: Path, destination: Path) -> None:
    if not source.exists():
        return
    if source.resolve() == destination.resolve():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return
    shutil.move(str(source), str(destination))


def apply_auth_environment(
    auth_config: dict[str, Any],
    provider_name: str | None = None,
) -> None:
    provider = provider_name or normalize_provider_name(
        string_value(auth_config.get("provider"))
        or os.environ.get("CHUMP_PROVIDER", DEFAULT_PROVIDER)
    )
    credentials = auth_config.get("credentials")
    if not isinstance(credentials, dict):
        return
    provider_credentials = credentials.get(provider)
    if not isinstance(provider_credentials, dict):
        return
    for key, value in provider_credentials.items():
        if (
            isinstance(key, str)
            and isinstance(value, str)
            and re.fullmatch(r"[A-Z][A-Z0-9_]*", key)
            and key not in os.environ
        ):
            os.environ[key] = value


def string_value(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def int_value(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    parsed = int(value)
    return parsed if parsed > 0 else None


def bool_value(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    return value.lower() not in {"0", "false", "no"}


def load_reasoning_config(
    auth_config: dict[str, Any] | None = None,
    provider: str | None = None,
    repo_config: dict[str, Any] | None = None,
    global_config: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    reasoning: dict[str, Any] = {}
    effort = os.environ.get("CHUMP_REASONING_EFFORT")
    budget = os.environ.get("CHUMP_REASONING_BUDGET")

    configured = None
    if repo_config and "reasoning" in repo_config:
        configured = repo_config.get("reasoning")
    elif global_config and "reasoning" in global_config:
        configured = global_config.get("reasoning")
    elif auth_config and "reasoning" in auth_config:
        configured = auth_config.get("reasoning")

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
    normalized_provider = normalize_provider_name(provider or DEFAULT_PROVIDER)
    if normalized_provider == "chump_cloud":
        return None
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
        raise ValueError(
            f"invalid reasoning effort={effort!r}; expected one of: {valid}"
        )
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
    if normalized in {"githubcopilot", "copilot"}:
        return "github_copilot"
    if normalized in {"deepseek"}:
        return "deepseek"
    if normalized in {"chumpcloud", "chump_cloud"}:
        return "chump_cloud"
    if normalized in {"open_router"}:
        return "openrouter"
    if normalized in {"x_ai", "grok"}:
        return "xai"
    if normalized in {"opencodezen", "opencode_zen"}:
        return "opencode"
    if normalized in {"opencodego"}:
        return "opencode_go"
    if normalized not in DEFAULT_MODELS:
        valid = ", ".join(sorted(DEFAULT_MODELS))
        raise ValueError(f"invalid CHUMP_PROVIDER={value!r}; expected one of: {valid}")
    return normalized


def normalize_model_name(
    provider: str,
    model: str,
    *,
    strict: bool = True,
) -> str:
    normalized_provider = normalize_provider_name(provider)
    normalized_model = model.strip()
    allowed = PROVIDER_MODELS[normalized_provider]
    if normalized_model in allowed:
        return normalized_model
    if not strict:
        return DEFAULT_MODELS[normalized_provider]
    valid = ", ".join(sorted(allowed))
    raise ValueError(
        f"invalid model={model!r} for provider={normalized_provider!r}; expected one of: {valid}"
    )
