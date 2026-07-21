import os

import pytest

from chump_server.config import (
    DEFAULT_MAX_STEPS,
    DEFAULT_PROVIDER,
    apply_auth_environment,
    load_config,
    normalize_model_name,
    normalize_provider_name,
    normalize_reasoning_config,
)


def test_default_provider_is_chump_cloud():
    assert DEFAULT_PROVIDER == "chump_cloud"


def test_default_max_steps_is_250():
    assert DEFAULT_MAX_STEPS == 250


def test_normalize_model_name_accepts_provider_model_pair():
    assert normalize_model_name("deepseek", "deepseek-v4-flash") == "deepseek-v4-flash"


@pytest.mark.parametrize(
    "model",
    [
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash",
    ],
)
def test_normalize_model_name_accepts_public_google_models(model):
    assert normalize_model_name("google", model) == model


def test_normalize_model_name_rejects_limited_access_google_models():
    with pytest.raises(ValueError, match="invalid model"):
        normalize_model_name("google", "gemini-3.5-flash-cyber")


def test_normalize_model_name_accepts_chump_cloud_provider_model_pair():
    assert (
        normalize_model_name("chump_cloud", "deepseek-v4-flash")
        == "deepseek-v4-flash"
    )


def test_normalize_model_name_accepts_openrouter_provider_model_pair():
    assert (
        normalize_model_name("openrouter", "anthropic/claude-sonnet-4.5")
        == "anthropic/claude-sonnet-4.5"
    )


def test_normalize_model_name_accepts_opencode_go_provider_model_pair():
    assert normalize_model_name("opencode_go", "deepseek-v4-flash") == "deepseek-v4-flash"


def test_normalize_model_name_accepts_github_copilot_provider_model_pair():
    assert normalize_model_name("github_copilot", "gpt-5.4") == "gpt-5.4"


@pytest.mark.parametrize(
    "provider, model",
    [
        ("openai", "gpt-5.6"),
        ("openai", "gpt-5.6-sol"),
        ("openai", "gpt-5.6-terra"),
        ("openai", "gpt-5.6-luna"),
        ("codex", "gpt-5.6"),
        ("codex", "gpt-5.6-sol"),
        ("codex", "gpt-5.6-terra"),
        ("codex", "gpt-5.6-luna"),
    ],
)
def test_normalize_model_name_accepts_gpt_5_6_family(provider, model):
    assert normalize_model_name(provider, model) == model


def test_normalize_provider_name_accepts_x_ai_alias():
    assert normalize_provider_name("x-ai") == "xai"


def test_normalize_provider_name_accepts_copilot_alias():
    assert normalize_provider_name("copilot") == "github_copilot"


def test_chump_cloud_ignores_openai_reasoning_config():
    assert normalize_reasoning_config({"mode": "high"}, "chump_cloud") is None


def test_normalize_model_name_rejects_cross_provider_model_pair():
    with pytest.raises(ValueError, match="invalid model"):
        normalize_model_name("deepseek", "@cf/moonshotai/kimi-k2.6")


def test_workers_ai_accepts_kimi_k2_7_code():
    assert (
        normalize_model_name("workers_ai", "@cf/moonshotai/kimi-k2.7-code")
        == "@cf/moonshotai/kimi-k2.7-code"
    )


def test_workers_ai_accepts_glm_5_2():
    assert (
        normalize_model_name("workers_ai", "@cf/zai-org/glm-5.2")
        == "@cf/zai-org/glm-5.2"
    )


def test_normalize_model_name_uses_provider_default_when_not_strict():
    assert (
        normalize_model_name("deepseek", "@cf/moonshotai/kimi-k2.6", strict=False)
        == "deepseek-v4-pro"
    )


def test_load_config_reads_retry_policy(monkeypatch, tmp_path):
    auth_file = tmp_path / "missing-auth.json"
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))
    monkeypatch.setenv("CHUMP_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("CHUMP_RETRY_MAX_ATTEMPTS", "5")
    monkeypatch.setenv("CHUMP_RETRY_INITIAL_DELAY", "0.25")
    monkeypatch.setenv("CHUMP_RETRY_MAX_DELAY", "4")
    monkeypatch.setenv("CHUMP_RETRY_BACKOFF", "1.5")
    monkeypatch.setenv("CHUMP_RETRY_JITTER", "0")

    config = load_config()

    assert config.retry_max_attempts == 5
    assert config.retry_initial_delay == 0.25
    assert config.retry_max_delay == 4
    assert config.retry_backoff == 1.5
    assert config.retry_jitter is False


def test_load_config_uses_default_max_steps(monkeypatch, tmp_path):
    auth_file = tmp_path / "missing-auth.json"
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))
    monkeypatch.setenv("CHUMP_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.delenv("CHUMP_MAX_STEPS", raising=False)

    config = load_config()

    assert config.max_steps == DEFAULT_MAX_STEPS


def test_load_config_reads_compaction_env(monkeypatch, tmp_path):
    auth_file = tmp_path / "missing-auth.json"
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))
    monkeypatch.setenv("CHUMP_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("CHUMP_COMPACTION_TOKENS", "150000")
    monkeypatch.setenv("CHUMP_COMPACTION_KEEP_RECENT_TOKENS", "30000")

    config = load_config()

    assert config.compaction_tokens == 150_000
    assert config.compaction_keep_recent_tokens == 30_000


def test_load_config_disables_compaction_env(monkeypatch, tmp_path):
    auth_file = tmp_path / "missing-auth.json"
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))
    monkeypatch.setenv("CHUMP_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("CHUMP_COMPACTION_TOKENS", "off")

    config = load_config()

    assert config.compaction_tokens is None


def test_load_config_repo_compaction_overrides_global(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    chump_dir = workspace / ".chump"
    chump_dir.mkdir(parents=True)
    (chump_dir / "config.json").write_text(
        '{"compaction": {"tokens": 123000, "keep_recent_tokens": 11000}}',
        encoding="utf-8",
    )
    auth_file = tmp_path / "auth.json"
    auth_file.write_text(
        '{"compaction": {"tokens": 180000, "keep_recent_tokens": 22000}}',
        encoding="utf-8",
    )
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))
    monkeypatch.setenv("CHUMP_WORKSPACE_ROOT", str(workspace))
    monkeypatch.setenv("CHUMP_STATE_DIR", str(tmp_path / "state"))

    config = load_config()

    assert config.compaction_tokens == 123_000
    assert config.compaction_keep_recent_tokens == 11_000


def test_load_config_uses_latest_google_default_model(monkeypatch, tmp_path):
    auth_file = tmp_path / "missing-auth.json"
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))
    monkeypatch.setenv("CHUMP_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("CHUMP_PROVIDER", "google")

    config = load_config()

    assert config.model == "gemini-3.6-flash"


def test_load_config_uses_opencode_go_default_model(monkeypatch, tmp_path):
    auth_file = tmp_path / "missing-auth.json"
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))
    monkeypatch.setenv("CHUMP_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("CHUMP_PROVIDER", "opencode-go")

    config = load_config()

    assert config.provider == "opencode_go"
    assert config.model == "deepseek-v4-flash"


def test_load_config_uses_github_copilot_default_model(monkeypatch, tmp_path):
    auth_file = tmp_path / "missing-auth.json"
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))
    monkeypatch.setenv("CHUMP_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("CHUMP_PROVIDER", "github-copilot")

    config = load_config()

    assert config.provider == "github_copilot"
    assert config.model == "gpt-5.4"


def test_apply_auth_environment_only_exports_env_style_keys(monkeypatch):
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.delenv("type", raising=False)
    monkeypatch.delenv("access", raising=False)
    monkeypatch.delenv("refresh", raising=False)

    apply_auth_environment(
        {
            "credentials": {
                "xai": {
                    "type": "oauth",
                    "access": "token",
                    "refresh": "refresh-token",
                    "XAI_API_KEY": "manual-key",
                }
            }
        },
        "xai",
    )

    assert os.environ.get("XAI_API_KEY") == "manual-key"
    assert os.environ.get("type") is None
    assert os.environ.get("access") is None
    assert os.environ.get("refresh") is None


def test_load_config_migrates_legacy_workspace_state(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    legacy_dir = workspace / ".chump"
    legacy_dir.mkdir(parents=True)
    (legacy_dir / "chump.sqlite3").write_text("db", encoding="utf-8")
    (legacy_dir / "server.log").write_text("log", encoding="utf-8")

    auth_file = tmp_path / "missing-auth.json"
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))
    monkeypatch.setenv("CHUMP_WORKSPACE_ROOT", str(workspace))
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state-home"))
    monkeypatch.delenv("CHUMP_STATE_DIR", raising=False)

    config = load_config()

    assert config.data_dir != legacy_dir
    assert (config.data_dir / "chump.sqlite3").read_text(encoding="utf-8") == "db"
    assert (config.data_dir / "server.log").read_text(encoding="utf-8") == "log"
    assert not (legacy_dir / "chump.sqlite3").exists()
    assert not (legacy_dir / "server.log").exists()
    assert legacy_dir.exists()


def test_load_config_global_config_file_resolution(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    # 1. Setup global config file
    global_config_file = tmp_path / "global-config.json"
    global_config_file.write_text(
        '{"provider": "openai", "model": "gpt-5.5", "max_steps": 42, "compaction_tokens": 80000}',
        encoding="utf-8",
    )
    monkeypatch.setenv("CHUMP_CONFIG_FILE", str(global_config_file))

    # 2. Setup auth config
    auth_file = tmp_path / "auth.json"
    auth_file.write_text('{"provider": "anthropic"}', encoding="utf-8")
    monkeypatch.setenv("CHUMP_AUTH_FILE", str(auth_file))

    monkeypatch.setenv("CHUMP_WORKSPACE_ROOT", str(workspace))
    monkeypatch.setenv("CHUMP_STATE_DIR", str(tmp_path / "state"))

    config = load_config()
    assert config.provider == "openai" # global config overrides auth config
    assert config.model == "gpt-5.5"   # global config
    assert config.max_steps == 42       # global config
    assert config.compaction_tokens == 80000

    # 3. Setup local config file
    local_chump_dir = workspace / ".chump"
    local_chump_dir.mkdir()
    (local_chump_dir / "config.json").write_text(
        '{"provider": "deepseek", "max_steps": 15}',
        encoding="utf-8",
    )

    config = load_config()
    assert config.provider == "deepseek" # local config overrides global config
    assert config.max_steps == 15        # local config overrides global config
