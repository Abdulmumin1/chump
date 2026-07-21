from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


def stored_sessions(
    db_path: Path,
    active_agents: dict[str, Any],
    *,
    page: int = 1,
    page_size: int = 15,
) -> tuple[list[dict[str, Any]], int]:
    if not db_path.exists():
        return [], 0

    with sqlite3.connect(str(db_path)) as conn:
        if not table_exists(conn, "kv_store"):
            return [], 0
        has_incremental_events = table_exists(conn, "event_log")
        session_ids_sql = build_session_ids_sql(has_incremental_events)
        total = conn.execute(
            f"SELECT COUNT(*) FROM ({session_ids_sql})",
        ).fetchone()[0]
        rows = conn.execute(
            build_session_page_sql(session_ids_sql, has_incremental_events),
            (page_size, (page - 1) * page_size),
        ).fetchall()

    sessions: list[dict[str, Any]] = []
    active_ids = set(active_agents.keys())
    for row in rows:
        (
            session_id,
            title,
            created_at,
            updated_at,
            last_user_goal,
            message_count,
            event_count,
            total_added,
            total_removed,
        ) = row
        active_meta = active_agents.get(session_id)
        active_last_activity = active_agent_last_activity(active_meta)
        active_connection_count = active_agent_connection_count(active_meta)
        message_count = active_agent_collection_count(
            active_meta,
            "messages",
            message_count,
        )
        event_count = active_agent_collection_count(
            active_meta,
            "_event_log",
            event_count,
        )
        sessions.append(
            {
                "id": session_id,
                "active": session_id in active_ids,
                "message_count": message_count,
                "event_count": event_count,
                "title": title,
                "created_at": created_at,
                "updated_at": updated_at,
                "last_user_goal": last_user_goal,
                "last_activity": active_last_activity,
                "connections": active_connection_count,
                "total_added": total_added,
                "total_removed": total_removed,
            }
        )
    return sessions, int(total)


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table,),
        ).fetchone()
        is not None
    )


def build_session_ids_sql(has_incremental_events: bool) -> str:
    sources = [
        "SELECT substr(key, 1, length(key) - 6) AS session_id "
        "FROM kv_store WHERE substr(key, -6) = ':state'",
        "SELECT substr(key, 1, length(key) - 9) AS session_id "
        "FROM kv_store WHERE substr(key, -9) = ':messages'",
        "SELECT substr(key, 1, length(key) - 10) AS session_id "
        "FROM kv_store WHERE substr(key, -10) = ':event_log'",
    ]
    if has_incremental_events:
        sources.append(
            "SELECT substr(key, 1, length(key) - 10) AS session_id FROM event_log"
        )
    return " UNION ".join(sources)


def build_session_page_sql(
    session_ids_sql: str,
    has_incremental_events: bool,
) -> str:
    # Session lists are startup metadata, so never deserialize unbounded
    # message or legacy replay blobs here. Exact transcript details remain
    # available through inspect_session_payload; live agents and incremental
    # event rows can provide counts without touching those blobs.
    incremental_event_count = (
        "(SELECT COUNT(*) FROM event_log AS events "
        "WHERE events.key = page.session_id || ':event_log')"
        if has_incremental_events
        else "0"
    )
    return f"""
        WITH session_ids AS (
            {session_ids_sql}
        ),
        state_values AS (
            SELECT
                ids.session_id,
                CASE
                    WHEN json_valid(state.value) THEN state.value
                    ELSE '{{}}'
                END AS state_json
            FROM session_ids AS ids
            LEFT JOIN kv_store AS state
                ON state.key = ids.session_id || ':state'
        ),
        ranked AS (
            SELECT
                session_id,
                state_json,
                json_extract(state_json, '$.title') AS title,
                CASE
                    WHEN json_type(state_json, '$.created_at') IN ('integer', 'real')
                    THEN json_extract(state_json, '$.created_at')
                END AS created_at,
                CASE
                    WHEN json_type(state_json, '$.updated_at') IN ('integer', 'real')
                    THEN json_extract(state_json, '$.updated_at')
                END AS updated_at,
                json_extract(state_json, '$.last_user_goal') AS last_user_goal
            FROM state_values
        ),
        page AS (
            SELECT * FROM ranked
            ORDER BY
                COALESCE(updated_at, created_at, 0) DESC,
                session_id DESC
            LIMIT ? OFFSET ?
        )
        SELECT
            page.session_id,
            page.title,
            page.created_at,
            page.updated_at,
            page.last_user_goal,
            0 AS message_count,
            {incremental_event_count} AS event_count,
            COALESCE((
                SELECT SUM(
                    CASE
                        WHEN json_type(diff.value, '$.added') = 'integer'
                        THEN json_extract(diff.value, '$.added')
                        ELSE 0
                    END
                )
                FROM json_each(page.state_json, '$.file_diffs') AS diff
            ), 0) AS total_added,
            COALESCE((
                SELECT SUM(
                    CASE
                        WHEN json_type(diff.value, '$.removed') = 'integer'
                        THEN json_extract(diff.value, '$.removed')
                        ELSE 0
                    END
                )
                FROM json_each(page.state_json, '$.file_diffs') AS diff
            ), 0) AS total_removed
        FROM page
        ORDER BY
            COALESCE(page.updated_at, page.created_at, 0) DESC,
            page.session_id DESC
    """


def active_agent_last_activity(active_meta: Any) -> float | None:
    if active_meta is None:
        return None
    last_activity = getattr(active_meta, "last_activity", None)
    if isinstance(last_activity, (int, float)):
        return float(last_activity)
    state = getattr(active_meta, "state", None)
    if isinstance(state, dict):
        updated_at = state.get("updated_at")
        if isinstance(updated_at, (int, float)):
            return float(updated_at)
    return None


def active_agent_connection_count(active_meta: Any) -> int:
    if active_meta is None:
        return 0
    connection_count = getattr(active_meta, "connection_count", None)
    return connection_count if isinstance(connection_count, int) else 0


def active_agent_collection_count(
    active_meta: Any,
    attribute: str,
    fallback: int,
) -> int:
    agent = getattr(active_meta, "agent", None)
    collection = getattr(agent, attribute, None)
    return len(collection) if isinstance(collection, list) else fallback


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
