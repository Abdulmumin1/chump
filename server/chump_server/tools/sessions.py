from __future__ import annotations

import re
import sqlite3
import time
from dataclasses import replace
from pathlib import Path
from typing import Any
from uuid import uuid4

from ai_query import Field, tool

from ..config import (
    DEFAULT_MODELS,
    PROVIDER_MODELS,
    ChumpConfig,
    apply_auth_environment,
    load_auth_config,
    normalize_model_name,
    normalize_provider_name,
    normalize_reasoning_config,
)
from ..runtime.messages import message_content_text
from ..runtime.model import model_input_modalities
from ..server.sessions import decode_json, stored_sessions

SESSION_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
DEFAULT_MESSAGE_LIMIT = 20
MAX_MESSAGE_LIMIT = 100
DEFAULT_EVENT_LIMIT = 20
MAX_EVENT_LIMIT = 100
MAX_SESSION_STEPS = 1_000


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

    @tool(
        description="Inspect a saved Chump session and optionally include recent messages."
    )
    async def inspect_session(
        session_id: str = Field(description="Session id to inspect"),
        include_messages: bool = Field(
            description="Whether to include recent messages", default=True
        ),
        message_limit: int = Field(
            description="Maximum recent messages to include, up to 100",
            default=DEFAULT_MESSAGE_LIMIT,
        ),
        include_events: bool = Field(
            description="Whether to include recent durable session events", default=False
        ),
        event_limit: int = Field(
            description="Maximum recent events to include, up to 100",
            default=DEFAULT_EVENT_LIMIT,
        ),
    ) -> str:
        async def runner() -> str:
            payload = inspect_session_payload(
                db_path,
                session_id=session_id,
                include_messages=include_messages,
                message_limit=message_limit,
                include_events=include_events,
                event_limit=event_limit,
            )
            return format_payload(payload)

        return await wrap_tool(
            "inspect_session",
            {
                "session_id": session_id,
                "include_messages": include_messages,
                "message_limit": message_limit,
                "include_events": include_events,
                "event_limit": event_limit,
            },
            runner,
        )

    @tool(
        description=(
            "Search models available through connected providers. Use this before "
            "start_session when selecting a model for delegated work."
        )
    )
    async def search_models(
        query: str = Field(
            description="Optional provider or model text to search", default=""
        ),
        provider: str | None = Field(
            description="Optional connected provider to filter by", default=None
        ),
    ) -> str:
        async def runner() -> str:
            return format_payload(
                search_model_payload(config, query=query, provider=provider)
            )

        return await wrap_tool(
            "search_models",
            {"query": query, "provider": provider},
            runner,
        )

    @tool(
        description=(
            "Start a separate Chump session/thread with an initial prompt and "
            "optional model, reasoning, and step configuration."
        )
    )
    async def start_session(
        prompt: str = Field(description="Initial prompt for the new session"),
        session_id: str | None = Field(
            description="Optional session id. Omit to generate one.", default=None
        ),
        provider: str | None = Field(
            description="Connected provider returned by search_models", default=None
        ),
        model: str | None = Field(
            description="Model returned by search_models", default=None
        ),
        reasoning: str | None = Field(
            description=(
                "Optional reasoning mode: none, minimal, low, medium, high, or xhigh"
            ),
            default=None,
        ),
        max_steps: int | None = Field(
            description="Optional maximum agent steps, from 1 to 1000", default=None
        ),
    ) -> str:
        async def runner() -> str:
            target_id = normalize_session_id(session_id or generated_session_id())
            if target_id == agent.id:
                raise ValueError(
                    "cannot start a new session with the current session id"
                )
            if session_exists(db_path, target_id):
                raise ValueError(f"session already exists: {target_id}")

            normalized_prompt = prompt.strip()
            if not normalized_prompt:
                raise ValueError("prompt is required")

            session_config = resolve_session_config(
                config,
                provider=provider,
                model=model,
                reasoning=reasoning,
                max_steps=max_steps,
            )
            result = await agent.call(
                target_id,
                agent_cls=type(agent),
                timeout=None,
                signal=agent.current_abort_signal,
            ).run_delegated_task(
                prompt=normalized_prompt,
                provider=session_config.provider,
                model=session_config.model,
                reasoning=session_config.reasoning,
                max_steps=session_config.max_steps,
            )

            return format_payload(
                {
                    **result,
                    "resume_command": f"chump -s {target_id}",
                }
            )

        return await wrap_tool(
            "start_session",
            {
                "prompt": prompt,
                "session_id": session_id,
                "provider": provider,
                "model": model,
                "reasoning": reasoning,
                "max_steps": max_steps,
            },
            runner,
        )

    return {
        "list_sessions": list_sessions,
        "inspect_session": inspect_session,
        "search_models": search_models,
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
    include_events: bool = False,
    event_limit: int = DEFAULT_EVENT_LIMIT,
) -> dict[str, Any]:
    normalized_id = normalize_session_id(session_id)
    record = read_session_record(db_path, normalized_id)
    if record is None:
        raise ValueError(f"session not found: {normalized_id}")

    state = record.get("state") if isinstance(record.get("state"), dict) else {}
    messages = (
        record.get("messages") if isinstance(record.get("messages"), list) else []
    )
    event_log = (
        record.get("event_log") if isinstance(record.get("event_log"), list) else []
    )
    event_count = record.get("event_count")
    if not isinstance(event_count, int):
        event_count = len(event_log)
    payload: dict[str, Any] = {
        "id": normalized_id,
        "title": state.get("title"),
        "created_at": state.get("created_at"),
        "updated_at": state.get("updated_at"),
        "last_user_goal": state.get("last_user_goal"),
        "provider": state.get("provider"),
        "model": state.get("model"),
        "reasoning": state.get("reasoning"),
        "max_steps": state.get("max_steps"),
        "delegated_task_status": state.get("delegated_task_status"),
        "delegated_task_error": state.get("delegated_task_error"),
        "message_count": len(messages),
        "event_count": event_count,
    }
    last_error = latest_session_error(event_log)
    if last_error is not None:
        payload["last_error"] = last_error
    if include_messages:
        payload["messages"] = summarize_messages(messages, limit=message_limit)
    if include_events:
        payload["events"] = summarize_events(event_log, limit=event_limit)
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
        if table_exists(conn, "event_log"):
            event_key = keys["event_log"]
            event_count = conn.execute(
                "SELECT COUNT(*) FROM event_log WHERE key = ?",
                (event_key,),
            ).fetchone()[0]
            rows = conn.execute(
                "SELECT value FROM event_log WHERE key = ? "
                "ORDER BY event_id DESC LIMIT ?",
                (event_key, MAX_EVENT_LIMIT),
            ).fetchall()
            if rows:
                values["event_log"] = [
                    decode_json(row[0]) for row in reversed(rows)
                ]
                values["event_count"] = int(event_count)
    return values if values else None


def session_exists(db_path: Path, session_id: str) -> bool:
    if not db_path.exists():
        return False
    keys = (
        f"{session_id}:state",
        f"{session_id}:messages",
        f"{session_id}:event_log",
    )
    with sqlite3.connect(str(db_path)) as conn:
        stored = conn.execute(
            "SELECT 1 FROM kv_store WHERE key IN (?, ?, ?) LIMIT 1",
            keys,
        ).fetchone()
        if stored is not None:
            return True
        if not table_exists(conn, "event_log"):
            return False
        return (
            conn.execute(
                "SELECT 1 FROM event_log WHERE key = ? LIMIT 1",
                (keys[-1],),
            ).fetchone()
            is not None
        )


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


def summarize_events(events: list[Any], *, limit: int) -> list[dict[str, Any]]:
    event_limit = max(
        1,
        min(limit if isinstance(limit, int) else DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT),
    )
    summaries: list[dict[str, Any]] = []
    for event in events[-event_limit:]:
        if not isinstance(event, dict):
            continue
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        summary: dict[str, Any] = {
            "id": event.get("id"),
            "type": event.get("type"),
        }
        message = data.get("message")
        content = data.get("content")
        if isinstance(message, str):
            summary["message"] = truncate_text(message, 4_000)
        if isinstance(content, str):
            summary["content"] = truncate_text(content, 4_000)
        summaries.append(summary)
    return summaries


def latest_session_error(events: list[Any]) -> dict[str, Any] | None:
    for event in reversed(events):
        if not isinstance(event, dict):
            continue
        event_type = event.get("type")
        if event_type in {"assistant_text", "user_message"}:
            return None
        if event_type != "turn_error":
            continue
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        message = data.get("message")
        return {
            "event_id": event.get("id"),
            "type": data.get("error_type"),
            "message": (
                truncate_text(message, 4_000) if isinstance(message, str) else None
            ),
        }
    return None


def search_model_payload(
    config: ChumpConfig,
    *,
    query: str,
    provider: str | None,
) -> dict[str, Any]:
    connected_providers = connected_provider_names(config)
    provider_filter = normalize_provider_name(provider) if provider else None
    if provider_filter is not None and provider_filter not in connected_providers:
        raise ValueError(f"provider is not connected: {provider_filter}")

    normalized_query = query.strip().lower()
    models: list[dict[str, Any]] = []
    for provider_name in connected_providers:
        if provider_filter is not None and provider_name != provider_filter:
            continue
        for model_name in sorted(PROVIDER_MODELS[provider_name]):
            searchable = f"{provider_name} {model_name}".lower()
            if normalized_query and normalized_query not in searchable:
                continue
            models.append(
                {
                    "provider": provider_name,
                    "model": model_name,
                    "input_modalities": list(
                        model_input_modalities(provider_name, model_name)
                    ),
                    "default": model_name == DEFAULT_MODELS[provider_name],
                    "current": (
                        provider_name == config.provider and model_name == config.model
                    ),
                }
            )
    return {
        "connected_providers": list(connected_providers),
        "models": models,
        "count": len(models),
    }


def resolve_session_config(
    config: ChumpConfig,
    *,
    provider: str | None,
    model: str | None,
    reasoning: str | None,
    max_steps: int | None,
) -> ChumpConfig:
    provider_name = normalize_provider_name(provider or config.provider)
    if provider_name not in connected_provider_names(config):
        raise ValueError(f"provider is not connected: {provider_name}")

    if model is not None:
        model_name = normalize_model_name(provider_name, model)
    elif provider is not None and provider_name != config.provider:
        model_name = DEFAULT_MODELS[provider_name]
    else:
        model_name = config.model

    if max_steps is not None and not 1 <= max_steps <= MAX_SESSION_STEPS:
        raise ValueError(f"max_steps must be between 1 and {MAX_SESSION_STEPS}")

    auth_config = load_auth_config()
    apply_auth_environment(auth_config, provider_name)
    if reasoning is not None:
        reasoning_config = normalize_reasoning_config(
            {"mode": reasoning.strip().lower()}, provider_name
        )
    elif provider_name == config.provider:
        reasoning_config = config.reasoning
    else:
        configured_reasoning = auth_config.get("reasoning")
        reasoning_config = normalize_reasoning_config(
            configured_reasoning if isinstance(configured_reasoning, dict) else None,
            provider_name,
        )

    return replace(
        config,
        provider=provider_name,
        model=model_name,
        reasoning=reasoning_config,
        max_steps=max_steps if max_steps is not None else config.max_steps,
    )


def connected_provider_names(config: ChumpConfig) -> tuple[str, ...]:
    providers = {
        provider
        for provider in (*config.available_providers, config.provider)
        if provider in PROVIDER_MODELS
    }
    return tuple(sorted(providers))


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table,),
        ).fetchone()
        is not None
    )


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
