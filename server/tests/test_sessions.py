from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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


def test_stored_sessions_keeps_large_transcripts_out_of_summary_loading(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "chump.sqlite3"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT)")
        conn.executemany(
            "INSERT INTO kv_store (key, value) VALUES (?, ?)",
            [
                (
                    "large:state",
                    json.dumps({"title": "Large", "updated_at": 10}),
                ),
                ("large:messages", json.dumps([{"text": "x" * 1_000_000}])),
                ("large:event_log", json.dumps([{"data": "x" * 1_000_000}])),
            ],
        )

    with patch(
        "chump_server.server.sessions.decode_json",
        side_effect=AssertionError("summary loaded a transcript blob"),
    ):
        sessions, total = stored_sessions(db_path, {})

    assert total == 1
    assert sessions[0]["title"] == "Large"
    assert sessions[0]["message_count"] == 0
    assert sessions[0]["event_count"] == 0


def test_stored_sessions_counts_incremental_and_live_events(tmp_path: Path) -> None:
    db_path = tmp_path / "chump.sqlite3"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute(
            "CREATE TABLE event_log (key TEXT, event_id INTEGER, value TEXT)"
        )
        conn.executemany(
            "INSERT INTO kv_store (key, value) VALUES (?, ?)",
            [
                ("stored:state", json.dumps({"updated_at": 20})),
                ("active:state", json.dumps({"updated_at": 10})),
            ],
        )
        conn.executemany(
            "INSERT INTO event_log (key, event_id, value) VALUES (?, ?, ?)",
            [
                ("stored:event_log", 1, "{}"),
                ("stored:event_log", 2, "{}"),
            ],
        )

    sessions, total = stored_sessions(
        db_path,
        {
            "active": SimpleNamespace(
                agent=SimpleNamespace(
                    messages=[1, 2, 3],
                    _event_log=[1, 2, 3, 4],
                )
            )
        },
    )

    assert total == 2
    by_id = {session["id"]: session for session in sessions}
    assert by_id["stored"]["event_count"] == 2
    assert by_id["active"]["message_count"] == 3
    assert by_id["active"]["event_count"] == 4
