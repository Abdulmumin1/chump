from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, TypedDict


SUBAGENT_PROGRESS_KIND = "delegated_session"

type JsonValue = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]


class DelegatedSessionStartingEvent(TypedDict):
    type: Literal["session_starting"]


class DelegatedReasoningEvent(TypedDict):
    type: Literal["reasoning"]
    text: str


class DelegatedToolCallEvent(TypedDict):
    type: Literal["tool_call"]
    name: str
    call_id: str
    args: dict[str, JsonValue]


class DelegatedToolResultEvent(TypedDict):
    type: Literal["tool_result"]
    name: str
    call_id: str
    status: Literal["ok", "error"]


class DelegatedAssistantTextEvent(TypedDict):
    type: Literal["assistant_text"]


class DelegatedStepStatusEvent(TypedDict):
    type: Literal["status"]
    phase: Literal["step_start", "step_finish"]
    step: int


class DelegatedTurnErrorEvent(TypedDict):
    type: Literal["turn_error"]
    message: str


type DelegatedChildEvent = (
    DelegatedSessionStartingEvent
    | DelegatedReasoningEvent
    | DelegatedToolCallEvent
    | DelegatedToolResultEvent
    | DelegatedAssistantTextEvent
    | DelegatedStepStatusEvent
    | DelegatedTurnErrorEvent
)


class DelegatedSessionProgress(TypedDict):
    kind: Literal["delegated_session"]
    session_id: str
    event: DelegatedChildEvent


def delegated_session_progress(
    session_id: str,
    event: DelegatedChildEvent,
) -> DelegatedSessionProgress:
    return {
        "kind": SUBAGENT_PROGRESS_KIND,
        "session_id": session_id,
        "event": event,
    }


def parse_delegated_child_event(
    event: str,
    data: Mapping[str, object],
) -> DelegatedChildEvent | None:
    """Parse an agent event immediately after it crosses the observer boundary."""
    if event == "reasoning":
        text = data.get("text")
        return {"type": "reasoning", "text": text} if isinstance(text, str) else None
    if event == "tool_call":
        name = data.get("name")
        call_id = data.get("call_id")
        args = _json_object(data.get("args"))
        if isinstance(name, str) and isinstance(call_id, str) and args is not None:
            return {
                "type": "tool_call",
                "name": name,
                "call_id": call_id,
                "args": args,
            }
        return None
    if event == "tool_result":
        name = data.get("name")
        call_id = data.get("call_id")
        status = data.get("status")
        if (
            isinstance(name, str)
            and isinstance(call_id, str)
            and (status == "ok" or status == "error")
        ):
            return {
                "type": "tool_result",
                "name": name,
                "call_id": call_id,
                "status": status,
            }
        return None
    if event == "assistant_text":
        return {"type": "assistant_text"}
    if event == "status":
        phase = data.get("phase")
        step = data.get("step")
        if not isinstance(step, int) or isinstance(step, bool):
            return None
        if phase == "step_start":
            return {"type": "status", "phase": "step_start", "step": step}
        if phase == "step_finish":
            return {"type": "status", "phase": "step_finish", "step": step}
        return None
    if event == "turn_error":
        message = data.get("message")
        return {"type": "turn_error", "message": message} if isinstance(message, str) else None
    return None


def _json_object(value: object) -> dict[str, JsonValue] | None:
    if not isinstance(value, dict):
        return None
    parsed: dict[str, JsonValue] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            return None
        valid, json_item = _json_value(item)
        if not valid:
            return None
        parsed[key] = json_item
    return parsed


def _json_value(value: object) -> tuple[bool, JsonValue]:
    if value is None or isinstance(value, bool | int | float | str):
        return True, value
    if isinstance(value, list):
        parsed_items: list[JsonValue] = []
        for item in value:
            valid, parsed = _json_value(item)
            if not valid:
                return False, None
            parsed_items.append(parsed)
        return True, parsed_items
    parsed_object = _json_object(value)
    return (True, parsed_object) if parsed_object is not None else (False, None)
