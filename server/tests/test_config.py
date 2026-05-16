import pytest

from chump_server.config import (
    DEFAULT_PROVIDER,
    load_config,
    normalize_model_name,
    normalize_reasoning_config,
)


def test_default_provider_is_chump_cloud():
    assert DEFAULT_PROVIDER == "chump_cloud"


def test_normalize_model_name_accepts_provider_model_pair():
    assert normalize_model_name("deepseek", "deepseek-v4-flash") == "deepseek-v4-flash"


def test_normalize_model_name_accepts_chump_cloud_provider_model_pair():
    assert (
        normalize_model_name("chump_cloud", "deepseek-v4-flash")
        == "deepseek-v4-flash"
    )


def test_chump_cloud_ignores_openai_reasoning_config():
    assert normalize_reasoning_config({"mode": "high"}, "chump_cloud") is None


def test_normalize_model_name_rejects_cross_provider_model_pair():
    with pytest.raises(ValueError, match="invalid model"):
        normalize_model_name("deepseek", "@cf/moonshotai/kimi-k2.6")


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

    config = load_config()

    assert config.data_dir != legacy_dir
    assert (config.data_dir / "chump.sqlite3").read_text(encoding="utf-8") == "db"
    assert (config.data_dir / "server.log").read_text(encoding="utf-8") == "log"
    assert not (legacy_dir / "chump.sqlite3").exists()
    assert not (legacy_dir / "server.log").exists()
    assert legacy_dir.exists()
