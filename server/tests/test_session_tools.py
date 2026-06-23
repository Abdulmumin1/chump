from __future__ import annotations

import json
import sqlite3
import time
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.tools.sessions import (
    inspect_session_payload,
    list_session_payload,
    normalize_session_id,
)


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
