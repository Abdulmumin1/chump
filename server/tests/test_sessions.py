from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

from chump_server.server.sessions import stored_sessions


def test_stored_sessions_returns_pages_in_recent_order(tmp_path: Path) -> None:
    db_path = tmp_path / "chump.sqlite3"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT)")
        for index in range(65):
            session_id = f"session-{index:02d}"
            conn.execute(
                "INSERT INTO kv_store (key, value) VALUES (?, ?)",
                (
                    f"{session_id}:state",
                    json.dumps(
                        {
                            "title": session_id,
                            "created_at": index,
                            "updated_at": index,
                        }
                    ),
                ),
            )

    first, total = stored_sessions(db_path, {}, page=1, page_size=15)
    second, _ = stored_sessions(db_path, {}, page=2, page_size=15)
    fifth, _ = stored_sessions(db_path, {}, page=5, page_size=15)

    assert total == 65
    assert len(first) == 15
    assert first[0]["id"] == "session-64"
    assert first[-1]["id"] == "session-50"
    assert second[0]["id"] == "session-49"
    assert second[-1]["id"] == "session-35"
    assert [session["id"] for session in fifth] == [
        "session-04",
        "session-03",
        "session-02",
        "session-01",
        "session-00",
    ]


def test_stored_sessions_handles_missing_database(tmp_path: Path) -> None:
    assert stored_sessions(tmp_path / "missing.sqlite3", {}) == ([], 0)


def test_stored_sessions_accepts_live_agent_without_connection_metadata(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "chump.sqlite3"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute(
            "INSERT INTO kv_store (key, value) VALUES (?, ?)",
            (
                "active-session:state",
                json.dumps(
                    {
                        "title": "Active session",
                        "created_at": 100,
                        "updated_at": 200,
                    }
                ),
            ),
        )

    sessions, total = stored_sessions(
        db_path,
        {
            "active-session": SimpleNamespace(
                state={"updated_at": 300},
            )
        },
    )

    assert total == 1
    assert sessions[0]["active"] is True
    assert sessions[0]["last_activity"] == 300
    assert sessions[0]["connections"] == 0
