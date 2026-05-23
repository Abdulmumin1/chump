from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


def stored_sessions(db_path: Path, active_agents: dict[str, Any]) -> list[dict[str, Any]]:
    if not db_path.exists():
        return []

    session_ids: set[str] = set()
    values: dict[str, Any] = {}
    with sqlite3.connect(str(db_path)) as conn:
        cursor = conn.execute("SELECT key, value FROM kv_store")
        for key, raw_value in cursor.fetchall():
            if ":" not in key:
                continue
            session_id, suffix = key.rsplit(":", 1)
            if suffix not in {"state", "messages", "event_log"}:
                continue
            session_ids.add(session_id)
            values[key] = decode_json(raw_value)

    sessions = []
    active_ids = set(active_agents.keys())
    for session_id in sorted(session_ids):
        state = values.get(f"{session_id}:state") or {}
        messages = values.get(f"{session_id}:messages") or []
        event_log = values.get(f"{session_id}:event_log") or []
        active_meta = active_agents.get(session_id)
        file_diffs = state.get("file_diffs") if isinstance(state, dict) else None
        total_added, total_removed = diff_totals(file_diffs)
        created_at = state.get("created_at") if isinstance(state, dict) else None
        updated_at = state.get("updated_at") if isinstance(state, dict) else None
        sessions.append(
            {
                "id": session_id,
                "active": session_id in active_ids,
                "message_count": len(messages) if isinstance(messages, list) else 0,
                "event_count": len(event_log) if isinstance(event_log, list) else 0,
                "title": state.get("title") if isinstance(state, dict) else None,
                "created_at": created_at
                if isinstance(created_at, (int, float))
                else None,
                "updated_at": updated_at
                if isinstance(updated_at, (int, float))
                else None,
                "last_user_goal": (
                    state.get("last_user_goal") if isinstance(state, dict) else None
                ),
                "last_activity": active_meta.last_activity if active_meta else None,
                "connections": active_meta.connection_count if active_meta else 0,
                "total_added": total_added,
                "total_removed": total_removed,
            }
        )
    sessions.sort(
        key=lambda session: (
            session.get("updated_at")
            or session.get("created_at")
            or session.get("last_activity")
            or 0,
            session["id"],
        ),
        reverse=True,
    )
    return sessions


def diff_totals(file_diffs: Any) -> tuple[int, int]:
    total_added = 0
    total_removed = 0
    if not isinstance(file_diffs, dict):
        return total_added, total_removed
    for value in file_diffs.values():
        if not isinstance(value, dict):
            continue
        added = value.get("added")
        removed = value.get("removed")
        total_added += added if isinstance(added, int) else 0
        total_removed += removed if isinstance(removed, int) else 0
    return total_added, total_removed


def decode_json(value: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None
