import json
import sqlite3

from scripts.benchmark_prompt_cache import (
    ScanDiagnostics,
    aggregate_cache_stats,
    read_session_logs,
)


def write_log(database_path, session_id, events):
    with sqlite3.connect(database_path) as connection:
        connection.execute("CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute(
            "INSERT INTO kv_store (key, value) VALUES (?, ?)",
            (f"{session_id}:event_log", json.dumps(events)),
        )


def status(provider, model):
    return {
        "type": "agent_status",
        "data": {"provider": provider, "model": model},
    }


def step(input_tokens, cached_tokens):
    return {
        "type": "status",
        "data": {
            "phase": "step_finish",
            "usage": {
                "input_tokens": input_tokens,
                "cached_tokens": cached_tokens,
            },
        },
    }


def test_aggregates_cache_usage_by_model_and_tracks_switches(tmp_path):
    database = tmp_path / "chump.sqlite3"
    write_log(
        database,
        "session-1",
        [
            status("codex", "gpt-5.4"),
            step(2_000, 0),
            step(2_500, 2_000),
            status("google", "gemini-3.7-flash"),
            step(5_000, 4_000),
        ],
    )
    diagnostics = ScanDiagnostics()

    stats = aggregate_cache_stats(read_session_logs([database], diagnostics), diagnostics)

    codex = stats[("codex", "gpt-5.4")]
    assert codex.calls == 2
    assert codex.hit_calls == 1
    assert codex.input_tokens == 4_500
    assert codex.cached_tokens == 2_000
    assert codex.request_hit_rate == 0.5
    assert codex.token_hit_rate == 2_000 / 4_500

    gemini = stats[("google", "gemini-3.7-flash")]
    assert gemini.calls == 1
    assert gemini.hit_calls == 1
    assert gemini.token_hit_rate == 0.8


def test_attributes_legacy_steps_before_first_agent_status(tmp_path):
    database = tmp_path / "chump.sqlite3"
    write_log(
        database,
        "legacy-session",
        [
            step(2_000, 1_500),
            status("workers_ai", "@cf/zai-org/glm-5.2"),
        ],
    )
    diagnostics = ScanDiagnostics()

    stats = aggregate_cache_stats(read_session_logs([database], diagnostics), diagnostics)

    row = stats[("workers_ai", "@cf/zai-org/glm-5.2")]
    assert row.calls == 1
    assert row.cached_tokens == 1_500
    assert diagnostics.unattributed_steps == 0


def test_skips_missing_and_invalid_usage(tmp_path):
    database = tmp_path / "chump.sqlite3"
    write_log(
        database,
        "session-1",
        [
            status("chump_cloud", "deepseek-v4-flash"),
            {"type": "status", "data": {"phase": "step_finish", "usage": None}},
            step(100, 101),
        ],
    )
    diagnostics = ScanDiagnostics()

    stats = aggregate_cache_stats(read_session_logs([database], diagnostics), diagnostics)

    assert stats[("chump_cloud", "deepseek-v4-flash")].calls == 0
    assert diagnostics.steps_without_usage == 1
    assert diagnostics.invalid_usage_steps == 1
