from __future__ import annotations

import json
import sqlite3
import time
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.tools.sessions import (
    inspect_session_payload,
    list_session_payload,
    normalize_session_id,
    resolve_session_config,
    search_model_payload,
)
from chump_server.config import ChumpConfig


class SessionToolTests(unittest.TestCase):
    def test_lists_and_inspects_stored_sessions(self) -> None:
        db_path = self._session_db(
            {
                "alpha": {
                    "state": {
                        "title": "Alpha work",
                        "created_at": 100,
                        "updated_at": 200,
                        "last_user_goal": "finish alpha",
                    },
                    "messages": [
                        {"role": "user", "content": "hello"},
                        {"role": "assistant", "content": "hi"},
                    ],
                    "event_log": [{"type": "done"}],
                },
                "beta": {
                    "state": {
                        "title": "Beta work",
                        "created_at": 100,
                        "updated_at": 300,
                    },
                    "messages": [{"role": "user", "content": "newer"}],
                    "event_log": [],
                },
            }
        )

        listed = list_session_payload(db_path, {}, page=1, limit=1)
        self.assertEqual(listed["total"], 2)
        self.assertEqual(listed["total_pages"], 2)
        self.assertEqual(listed["sessions"][0]["id"], "beta")

        inspected = inspect_session_payload(
            db_path,
            session_id="alpha",
            include_messages=True,
            message_limit=10,
        )
        self.assertEqual(inspected["title"], "Alpha work")
        self.assertEqual(inspected["message_count"], 2)
        self.assertEqual(inspected["event_count"], 1)
        self.assertEqual(
            inspected["messages"],
            [
                {"index": 0, "role": "user", "text": "hello"},
                {"index": 1, "role": "assistant", "text": "hi"},
            ],
        )

    def test_rejects_unsafe_session_ids(self) -> None:
        self.assertEqual(normalize_session_id(" session.demo_1 "), "session.demo_1")
        for value in ["", "../secret", "bad/session", "bad session"]:
            with self.assertRaises(ValueError):
                normalize_session_id(value)

    def test_searches_only_models_from_connected_providers(self) -> None:
        config = self._config()

        payload = search_model_payload(config, query="gpt-5.6", provider="codex")

        self.assertEqual(payload["connected_providers"], ["chump_cloud", "codex"])
        self.assertGreater(payload["count"], 0)
        self.assertTrue(
            all(model["provider"] == "codex" for model in payload["models"])
        )
        self.assertTrue(
            any(model["model"] == "gpt-5.6" for model in payload["models"])
        )

    @patch("chump_server.tools.sessions.load_auth_config", return_value={})
    def test_resolves_session_model_reasoning_and_step_overrides(self, _auth) -> None:
        resolved = resolve_session_config(
            self._config(),
            provider="codex",
            model="gpt-5.6",
            reasoning="low",
            max_steps=40,
        )

        self.assertEqual(resolved.provider, "codex")
        self.assertEqual(resolved.model, "gpt-5.6")
        self.assertEqual(resolved.reasoning, {"effort": "low"})
        self.assertEqual(resolved.max_steps, 40)

    def test_inspection_reads_incremental_events_and_reports_turn_failure(self) -> None:
        db_path = self._session_db(
            {
                "failed-child": {
                    "state": {
                        "title": "Failed child",
                        "provider": "codex",
                        "model": "gpt-5.6",
                    },
                    "messages": [
                        {"role": "user", "content": "investigate"},
                        {"role": "assistant", "content": []},
                        {"role": "tool", "content": []},
                    ],
                }
            }
        )
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute(
                "CREATE TABLE event_log ("
                "key TEXT NOT NULL, event_id INTEGER NOT NULL, value TEXT NOT NULL, "
                "PRIMARY KEY (key, event_id))"
            )
            conn.execute(
                "INSERT INTO event_log (key, event_id, value) VALUES (?, ?, ?)",
                (
                    "failed-child:event_log",
                    9,
                    json.dumps(
                        {
                            "id": 9,
                            "type": "turn_error",
                            "data": {
                                "message": "provider overloaded",
                                "error_type": "RuntimeError",
                            },
                        }
                    ),
                ),
            )
            conn.commit()

        inspected = inspect_session_payload(
            db_path,
            session_id="failed-child",
            include_messages=True,
            message_limit=10,
            include_events=True,
            event_limit=10,
        )

        self.assertEqual(inspected["event_count"], 1)
        self.assertEqual(
            inspected["last_error"],
            {
                "event_id": 9,
                "type": "RuntimeError",
                "message": "provider overloaded",
            },
        )
        self.assertEqual(
            inspected["events"],
            [{"id": 9, "type": "turn_error", "message": "provider overloaded"}],
        )

    def _config(self) -> ChumpConfig:
        root = Path("/tmp/chump-session-tools-config")
        return ChumpConfig(
            host="127.0.0.1",
            port=8080,
            workspace_root=root,
            data_dir=root,
            provider="codex",
            model="gpt-5.4",
            max_steps=250,
            retry_max_attempts=3,
            retry_initial_delay=0.5,
            retry_max_delay=8,
            retry_backoff=2,
            retry_jitter=True,
            command_timeout=120,
            managed_idle_timeout=None,
            compaction_tokens=None,
            compaction_keep_recent_tokens=20_000,
            reasoning={"effort": "high"},
            verbose=False,
            allowed_origins=(),
            available_providers=("chump_cloud", "codex"),
        )

    def _session_db(self, sessions: dict[str, dict[str, object]]) -> Path:
        root = Path("/tmp") / f"chump-session-tools-{time.time_ns()}"
        root.mkdir(parents=True)
        db_path = root / "chump.sqlite3"
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute("CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            for session_id, values in sessions.items():
                for suffix, value in values.items():
                    conn.execute(
                        "INSERT INTO kv_store (key, value) VALUES (?, ?)",
                        (f"{session_id}:{suffix}", json.dumps(value)),
                    )
            conn.commit()
        return db_path


if __name__ == "__main__":
    unittest.main()
