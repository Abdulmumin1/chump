from __future__ import annotations

import json
import sqlite3
from copy import deepcopy
from pathlib import Path
from typing import Any, TypedDict

from ..runtime.delegated_progress import (
    PENDING_DELEGATED_SESSIONS_STATE_KEY,
    PendingDelegatedSession,
    parse_pending_delegated_sessions,
)
from .sessions import table_exists


TERMINAL_DELEGATED_TASK_STATUSES = frozenset({"completed", "failed", "aborted"})

type PendingDelegatedCall = tuple[str, int, int, int]


class DelegatedChildState(TypedDict):
    delegated_task_status: str
    delegated_task_error: object


def reconcile_delegated_session_snapshot(
    db_path: Path,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    events = snapshot.get("events")
    messages = snapshot.get("messages")
    status = snapshot.get("status")
    if not isinstance(events, list) or not isinstance(messages, list):
        return snapshot

    reconciled_events = reconcile_delegated_session_lifecycles(
        db_path,
        events,
        snapshot.get(PENDING_DELEGATED_SESSIONS_STATE_KEY),
    )
    projected_messages = _append_reconciled_delegated_messages(
        messages,
        reconciled_events,
        reconciled_events,
    )
    if reconciled_events is events and projected_messages is messages:
        return snapshot

    result = deepcopy(snapshot)
    result["messages"] = projected_messages
    if (
        isinstance(status, dict)
        and status.get("turn_running") is False
        and _latest_turn_is_unfinished(reconciled_events)
        and not _pending_tool_call_ids_in_latest_turn(reconciled_events)
    ):
        result["events"] = [
            *reconciled_events,
            {
                "id": _latest_event_id(reconciled_events),
                "type": "turn_status",
                "data": {
                    "running": False,
                    "steering_queue": status.get("steering_queue", []),
                    "schema_version": 1,
                    "reconciled_from_child_sessions": True,
                },
            },
        ]
    else:
        result["events"] = reconciled_events
    return result


def reconcile_delegated_session_lifecycles(
    db_path: Path,
    events: list[Any],
    durable_links: object = None,
) -> list[Any]:
    """Settle orphaned start_session calls from durable child-session state."""
    pending = _pending_start_session_calls(events, durable_links)
    if not pending:
        return events

    missing_calls = [
        (call_id, lifecycle)
        for call_id, lifecycle in pending.items()
        if not _has_tool_call(events, call_id)
    ]
    reconciled = deepcopy(events) if missing_calls else events
    for call_id, (session_id, event_id, step, index) in missing_calls:
        reconciled.append(
            _reconciled_tool_call_event(
                event_id=event_id,
                call_id=call_id,
                step=step,
                index=index,
                session_id=session_id,
            )
        )

    if not db_path.exists():
        return reconciled

    terminal_states = _read_terminal_child_states(
        db_path,
        {call[0] for call in pending.values()},
    )
    if not terminal_states:
        return reconciled

    if reconciled is events:
        reconciled = deepcopy(events)
    for call_id, (session_id, event_id, step, index) in pending.items():
        state = terminal_states.get(session_id)
        if state is None:
            continue
        status = state["delegated_task_status"]
        error = state.get("delegated_task_error")
        reconciled.append(
            _terminal_result_event(
                # Reconciliation is a snapshot-only projection, not a durable
                # event. Reuse the call cursor so clients never skip the next
                # real SSE event after hydrating this synthetic result.
                event_id=event_id,
                call_id=call_id,
                step=step,
                index=index,
                session_id=session_id,
                status=status,
                error=error,
                reconciled=True,
            )
        )
    return reconciled


def _reconciled_tool_call_event(
    *,
    event_id: int,
    call_id: str,
    step: int,
    index: int,
    session_id: str,
) -> dict[str, Any]:
    return {
        "id": event_id,
        "type": "tool_call",
        "data": {
            "tool": "start_session",
            "name": "start_session",
            "call_id": call_id,
            "tool_call_id": call_id,
            "args": {"session_id": session_id},
            "payload": {"session_id": session_id},
            "step": step,
            "index": index,
            "status": "ready",
            "schema_version": 1,
            "reconciled_from_parent_state": True,
        },
    }


def _terminal_result_event(
    *,
    event_id: int,
    call_id: str,
    step: int,
    index: int,
    session_id: str,
    status: str,
    error: object,
    reconciled: bool,
) -> dict[str, Any]:
    failed = status != "completed"
    metadata: dict[str, Any] = {"delegated_task_status": status}
    if reconciled:
        metadata["reconciled_from_child_session"] = True
    return {
        "id": event_id,
        "type": "tool_result",
        "data": {
            "tool": "start_session",
            "name": "start_session",
            "tool_name": "start_session",
            "call_id": call_id,
            "tool_call_id": call_id,
            "step": step,
            "index": index,
            "ok": not failed,
            "status": "ok" if status == "completed" else "error",
            "is_error": failed,
            "aborted": status == "aborted",
            "preview": _terminal_result_preview(session_id, status, error),
            "metadata": metadata,
            **({"error": str(error)} if failed and error else {}),
            "schema_version": 1,
        },
    }


def _pending_start_session_calls(
    events: list[Any],
    durable_links: object,
) -> dict[str, PendingDelegatedCall]:
    pending = {
        call_id: _pending_call_tuple(lifecycle)
        for call_id, lifecycle in parse_pending_delegated_sessions(
            durable_links
        ).items()
    }
    for event in events:
        if not isinstance(event, dict):
            continue
        event_type = event.get("type")
        data = event.get("data")
        if not isinstance(data, dict):
            continue
        call_id = _call_id(data)
        if event_type in {"tool_result", "tool_execution.finished"}:
            if call_id:
                pending.pop(call_id, None)
            continue
        if event_type != "tool_call" or _tool_name(data) != "start_session":
            continue
        session_id = _started_session_id(data)
        event_id = event.get("id")
        step = data.get("step")
        index = data.get("index")
        if (
            call_id
            and session_id
            and isinstance(event_id, int)
            and isinstance(step, int)
            and not isinstance(step, bool)
            and isinstance(index, int)
            and not isinstance(index, bool)
        ):
            pending[call_id] = (session_id, event_id, step, index)
    return pending


def _pending_call_tuple(
    lifecycle: PendingDelegatedSession,
) -> PendingDelegatedCall:
    return (
        lifecycle["session_id"],
        lifecycle["event_id"],
        lifecycle["step"],
        lifecycle["index"],
    )


def _has_tool_call(events: list[Any], call_id: str) -> bool:
    return any(
        isinstance(event, dict)
        and event.get("type") == "tool_call"
        and isinstance((data := event.get("data")), dict)
        and _call_id(data) == call_id
        for event in events
    )


def _read_terminal_child_states(
    db_path: Path,
    session_ids: set[str],
) -> dict[str, DelegatedChildState]:
    if not session_ids:
        return {}
    placeholders = ", ".join("?" for _ in session_ids)
    keys = [f"{session_id}:state" for session_id in session_ids]
    with sqlite3.connect(str(db_path)) as conn:
        if not table_exists(conn, "kv_store"):
            return {}
        rows = conn.execute(
            f"SELECT key, value FROM kv_store WHERE key IN ({placeholders})",
            keys,
        ).fetchall()

    states: dict[str, DelegatedChildState] = {}
    for key, value in rows:
        try:
            state = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(state, dict):
            continue
        status = state.get("delegated_task_status")
        if status not in TERMINAL_DELEGATED_TASK_STATUSES:
            continue
        states[str(key).removesuffix(":state")] = {
            "delegated_task_status": status,
            "delegated_task_error": state.get("delegated_task_error"),
        }
    return states


def _call_id(data: dict[str, Any]) -> str | None:
    for key in ("call_id", "tool_call_id", "id"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _tool_name(data: dict[str, Any]) -> str | None:
    for key in ("name", "tool", "tool_name"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _started_session_id(data: dict[str, Any]) -> str | None:
    for key in ("args", "payload"):
        arguments = data.get(key)
        if not isinstance(arguments, dict):
            continue
        session_id = arguments.get("session_id")
        if isinstance(session_id, str) and session_id.strip():
            return session_id.strip()
    return None


def _terminal_result_preview(
    session_id: str,
    status: str,
    error: object,
) -> str:
    result: dict[str, Any] = {
        "session_id": session_id,
        "delegated_task_status": status,
    }
    if error:
        result["error"] = str(error)
    return json.dumps(result)


def _append_reconciled_delegated_messages(
    messages: list[Any],
    events: list[Any],
    settlements: list[dict[str, Any]],
) -> list[Any]:
    settlement_by_call_id = {
        call_id: event
        for event in settlements
        if event.get("type") in {"tool_result", "tool_execution.finished"}
        and isinstance((data := event.get("data")), dict)
        and _tool_name(data) == "start_session"
        and (call_id := _call_id(data)) is not None
    }
    if not settlement_by_call_id:
        return messages

    existing_calls, existing_results = _stored_message_tool_ids(messages)
    call_parts: list[dict[str, Any]] = []
    for event in events:
        if not isinstance(event, dict):
            continue
        data = event.get("data")
        if event.get("type") != "tool_call" or not isinstance(data, dict):
            continue
        call_id = _call_id(data)
        if call_id not in settlement_by_call_id or call_id in existing_calls:
            continue
        arguments = data.get("args", data.get("payload", {}))
        call_parts.append(
            {
                "type": "tool_call",
                "tool_call": {
                    "id": call_id,
                    "name": "start_session",
                    "arguments": arguments if isinstance(arguments, dict) else {},
                    "step": data.get("step"),
                    "index": data.get("index"),
                    "status": "ready",
                },
            }
        )

    result_parts: list[dict[str, Any]] = []
    for call_id, event in settlement_by_call_id.items():
        if call_id in existing_results:
            continue
        data = event["data"]
        result_parts.append(
            {
                "type": "tool_result",
                "tool_result": {
                    "tool_call_id": call_id,
                    "tool_name": "start_session",
                    "result": data["preview"],
                    "is_error": data["ok"] is not True,
                    "metadata": data.get("metadata", {}),
                    "step": data.get("step"),
                    "index": data.get("index"),
                    "status": _stored_result_status(data),
                },
            }
        )

    if not call_parts and not result_parts:
        return messages
    reconciled = deepcopy(messages)
    if call_parts:
        reconciled.append({"role": "assistant", "content": call_parts})
    if result_parts:
        reconciled.append({"role": "tool", "content": result_parts})
    return reconciled


def _stored_message_tool_ids(messages: list[Any]) -> tuple[set[str], set[str]]:
    calls: set[str] = set()
    results: set[str] = set()
    for message in messages:
        if not isinstance(message, dict) or not isinstance(message.get("content"), list):
            continue
        for part in message["content"]:
            if not isinstance(part, dict):
                continue
            call = part.get("tool_call")
            if part.get("type") == "tool_call" and isinstance(call, dict):
                call_id = call.get("id")
                if isinstance(call_id, str):
                    calls.add(call_id)
            tool_result = part.get("tool_result")
            if part.get("type") == "tool_result" and isinstance(tool_result, dict):
                call_id = tool_result.get("tool_call_id")
                if isinstance(call_id, str):
                    results.add(call_id)
    return calls, results


def _latest_turn_is_unfinished(events: list[Any]) -> bool:
    for event in reversed(events):
        if not isinstance(event, dict):
            continue
        if event.get("type") != "turn_status":
            continue
        data = event.get("data")
        return isinstance(data, dict) and data.get("running") is True
    return False


def _pending_tool_call_ids_in_latest_turn(events: list[Any]) -> set[str]:
    pending: set[str] = set()
    turn_start = next(
        (
            index
            for index in range(len(events) - 1, -1, -1)
            if isinstance(events[index], dict)
            and events[index].get("type") == "turn_status"
            and isinstance(events[index].get("data"), dict)
            and events[index]["data"].get("running") is True
        ),
        len(events),
    )
    for event in events[turn_start + 1 :]:
        if not isinstance(event, dict):
            continue
        data = event.get("data")
        if not isinstance(data, dict):
            continue
        call_id = _call_id(data)
        if not call_id:
            continue
        if event.get("type") == "tool_call":
            pending.add(call_id)
        elif event.get("type") in {"tool_result", "tool_execution.finished"}:
            pending.discard(call_id)
    return pending


def _latest_event_id(events: list[Any]) -> int:
    return max(
        (
            event.get("id", 0)
            for event in events
            if isinstance(event, dict) and isinstance(event.get("id"), int)
        ),
        default=0,
    )


def _stored_result_status(data: dict[str, Any]) -> str:
    if data.get("aborted") is True:
        return "aborted"
    return "completed" if data.get("status") == "ok" else "error"
