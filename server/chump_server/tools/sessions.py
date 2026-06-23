from __future__ import annotations

import re
import sqlite3
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from ai_query import Field, tool

from ..runtime.messages import build_session_title, message_content_text
from ..server.sessions import decode_json, stored_sessions

SESSION_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
DEFAULT_MESSAGE_LIMIT = 20
MAX_MESSAGE_LIMIT = 100


def bind_session_tools(agent, config, wrap_tool):
    db_path = config.data_dir / "chump.sqlite3"

    @tool(description="List saved Chump sessions in this workspace.")
    async def list_sessions(
        page: int = Field(description="One-based page number", default=1),
        limit: int = Field(description="Sessions per page, up to 100", default=15),
    ) -> str:
        async def runner() -> str:
            payload = list_session_payload(
                db_path,
                active_agents={agent.id: agent},
                page=page,
                limit=limit,
            )
            return format_payload(payload)

        return await wrap_tool(
            "list_sessions",
            {"page": page, "limit": limit},
            runner,
        )

    @tool(description="Inspect a saved Chump session and optionally include recent messages.")
    async def inspect_session(
        session_id: str = Field(description="Session id to inspect"),
        include_messages: bool = Field(
            description="Whether to include recent messages", default=True
        ),
        message_limit: int = Field(
            description="Maximum recent messages to include, up to 100",
            default=DEFAULT_MESSAGE_LIMIT,
        ),
    ) -> str:
        async def runner() -> str:
            payload = inspect_session_payload(
                db_path,
                session_id=session_id,
                include_messages=include_messages,
                message_limit=message_limit,
            )
            return format_payload(payload)

        return await wrap_tool(
            "inspect_session",
            {
                "session_id": session_id,
                "include_messages": include_messages,
                "message_limit": message_limit,
            },
            runner,
        )

    @tool(description="Start a separate Chump session/thread with an initial prompt.")
    async def start_session(
        prompt: str = Field(description="Initial prompt for the new session"),
        session_id: str | None = Field(
            description="Optional session id. Omit to generate one.", default=None
        ),
    ) -> str:
        async def runner() -> str:
            target_id = normalize_session_id(session_id or generated_session_id())
            if target_id == agent.id:
                raise ValueError("cannot start a new session with the current session id")
            if session_exists(db_path, target_id):
                raise ValueError(f"session already exists: {target_id}")

            normalized_prompt = prompt.strip()
            if not normalized_prompt:
                raise ValueError("prompt is required")

            new_agent = type(agent)(target_id)
            await new_agent.start()
            try:
                response = await new_agent.chat(normalized_prompt)
            finally:
                await new_agent.stop()

            return format_payload(
                {
                    "session_id": target_id,
                    "title": build_session_title(normalized_prompt),
                    "response": response,
                    "resume_command": f"chump -s {target_id}",
                }
            )

        return await wrap_tool(
            "start_session",
            {"prompt": prompt, "session_id": session_id},
            runner,
        )

    return {
        "list_sessions": list_sessions,
        "inspect_session": inspect_session,
        "start_session": start_session,
    }


def list_session_payload(
    db_path: Path,
    active_agents: dict[str, Any],
    *,
    page: int,
    limit: int,
) -> dict[str, Any]:
    page_number = max(1, page if isinstance(page, int) else 1)
    page_size = max(1, min(limit if isinstance(limit, int) else 15, 100))
    sessions, total = stored_sessions(
        db_path,
        active_agents,
        page=page_number,
        page_size=page_size,
    )
    return {
        "sessions": sessions,
        "page": page_number,
        "page_size": page_size,
        "total": total,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


def inspect_session_payload(
    db_path: Path,
    *,
    session_id: str,
    include_messages: bool,
    message_limit: int,
) -> dict[str, Any]:
    normalized_id = normalize_session_id(session_id)
    record = read_session_record(db_path, normalized_id)
    if record is None:
        raise ValueError(f"session not found: {normalized_id}")

    state = record.get("state") if isinstance(record.get("state"), dict) else {}
    messages = record.get("messages") if isinstance(record.get("messages"), list) else []
    event_log = record.get("event_log") if isinstance(record.get("event_log"), list) else []
    payload: dict[str, Any] = {
        "id": normalized_id,
        "title": state.get("title"),
        "created_at": state.get("created_at"),
        "updated_at": state.get("updated_at"),
        "last_user_goal": state.get("last_user_goal"),
        "message_count": len(messages),
        "event_count": len(event_log),
    }
    if include_messages:
        payload["messages"] = summarize_messages(messages, limit=message_limit)
    return payload


def read_session_record(db_path: Path, session_id: str) -> dict[str, Any] | None:
    if not db_path.exists():
        return None
    keys = {
        "state": f"{session_id}:state",
        "messages": f"{session_id}:messages",
        "event_log": f"{session_id}:event_log",
    }
    values: dict[str, Any] = {}
    with sqlite3.connect(str(db_path)) as conn:
        for name, key in keys.items():
            row = conn.execute(
                "SELECT value FROM kv_store WHERE key = ?", (key,)
            ).fetchone()
            if row is not None:
                values[name] = decode_json(row[0])
    return values if values else None


def session_exists(db_path: Path, session_id: str) -> bool:
    return read_session_record(db_path, session_id) is not None


def summarize_messages(messages: list[Any], *, limit: int) -> list[dict[str, Any]]:
    message_limit = max(
        1,
        min(limit if isinstance(limit, int) else DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT),
    )
    recent = messages[-message_limit:]
    offset = len(messages) - len(recent)
    summaries = []
    for index, message in enumerate(recent, start=offset):
        content = message.get("content") if isinstance(message, dict) else None
        summaries.append(
            {
                "index": index,
                "role": message.get("role") if isinstance(message, dict) else None,
                "text": truncate_text(message_content_text(content), 4_000),
            }
        )
    return summaries


def normalize_session_id(value: str) -> str:
    session_id = value.strip()
    if not session_id or not SESSION_ID_RE.fullmatch(session_id):
        raise ValueError(
            "session_id must contain only letters, numbers, dots, underscores, and hyphens"
        )
    return session_id


def generated_session_id() -> str:
    return f"session-{int(time.time() * 1000):x}-{uuid4().hex[:8]}"


def truncate_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 20] + "\n...[truncated]"


def format_payload(payload: dict[str, Any]) -> str:
    import json

    return json.dumps(payload, ensure_ascii=False, indent=2)
