from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict, TypeGuard


CHUMP_EVENT_SCHEMA_VERSION = 1

ChumpEventType = Literal[
    "assistant_text",
    "user_message",
    "tool_call",
    "tool_result",
    "agent_status",
    "steering_queue",
    "turn_status",
    "turn_error",
    "compaction_status",
    "compaction",
    "status",
]

CHUMP_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "assistant_text",
        "user_message",
        "tool_call",
        "tool_result",
        "agent_status",
        "steering_queue",
        "turn_status",
        "turn_error",
        "compaction_status",
        "compaction",
        "status",
    }
)


class VersionedEventPayload(TypedDict):
    schema_version: Literal[1]


class AssistantTextPayload(VersionedEventPayload):
    content: str


class UserMessagePayload(VersionedEventPayload):
    content: str
    display_content: NotRequired[str]
    attachments: NotRequired[list[dict[str, Any]]]
    steered: NotRequired[bool]


class ToolCallPayload(VersionedEventPayload):
    name: str
    call_id: str
    args: dict[str, Any]
    step: int
    index: int


class ToolResultPayload(VersionedEventPayload):
    name: str
    call_id: str
    ok: bool
    status: str
    preview: str
    step: int
    index: int
    duration: NotRequired[float | None]
    error: NotRequired[str]


class AgentStatusPayload(VersionedEventPayload):
    agent_id: str
    provider: str
    model: str
    turn_running: NotRequired[bool]


class SteeringQueuePayload(VersionedEventPayload):
    items: list[dict[str, Any]]


class TurnStatusPayload(VersionedEventPayload):
    running: bool
    steering_queue: list[dict[str, Any]]


class TurnErrorPayload(VersionedEventPayload):
    message: str
    error_type: str


class CompactionStatusPayload(VersionedEventPayload):
    running: bool
    reason: str


class CompactionPayload(VersionedEventPayload):
    reason: str
    tokens_before: int
    tokens_after: int
    messages_before: int
    messages_after: int
    created_at: float


class StepStatusPayload(VersionedEventPayload):
    phase: Literal["step_start", "step_finish"]
    step: int


ChumpEventPayload = (
    AssistantTextPayload
    | UserMessagePayload
    | ToolCallPayload
    | ToolResultPayload
    | AgentStatusPayload
    | SteeringQueuePayload
    | TurnStatusPayload
    | TurnErrorPayload
    | CompactionStatusPayload
    | CompactionPayload
    | StepStatusPayload
)


_REQUIRED_FIELDS: dict[str, dict[str, type[Any] | tuple[type[Any], ...]]] = {
    "assistant_text": {"content": str},
    "user_message": {"content": str},
    "tool_call": {
        "name": str,
        "call_id": str,
        "args": dict,
        "step": int,
        "index": int,
    },
    "tool_result": {
        "name": str,
        "call_id": str,
        "ok": bool,
        "status": str,
        "preview": str,
        "step": int,
        "index": int,
    },
    "agent_status": {"agent_id": str, "provider": str, "model": str},
    "steering_queue": {"items": list},
    "turn_status": {"running": bool, "steering_queue": list},
    "turn_error": {"message": str, "error_type": str},
    "compaction_status": {"running": bool, "reason": str},
    "compaction": {
        "reason": str,
        "tokens_before": int,
        "tokens_after": int,
        "messages_before": int,
        "messages_after": int,
        "created_at": (int, float),
    },
    "status": {"phase": str, "step": int},
}


def is_chump_event_type(event_type: str) -> TypeGuard[ChumpEventType]:
    return event_type in CHUMP_EVENT_TYPES


def version_chump_event_payload(
    event_type: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    """Validate and version Chump-owned event payloads.

    ai-query runtime events are intentionally passed through unchanged. Legacy
    Chump events are accepted by clients, while every newly emitted Chump event
    carries an explicit schema version.
    """
    if not is_chump_event_type(event_type):
        return data

    version = data.get("schema_version", CHUMP_EVENT_SCHEMA_VERSION)
    if version != CHUMP_EVENT_SCHEMA_VERSION:
        raise ValueError(
            f"Unsupported {event_type} schema_version {version!r}; "
            f"expected {CHUMP_EVENT_SCHEMA_VERSION}"
        )

    payload = dict(data)
    payload["schema_version"] = CHUMP_EVENT_SCHEMA_VERSION
    for field, expected_type in _REQUIRED_FIELDS[event_type].items():
        value = payload.get(field)
        if not _matches_type(value, expected_type):
            expected_name = _type_name(expected_type)
            raise ValueError(
                f"Invalid {event_type} event field {field!r}: "
                f"expected {expected_name}"
            )

    if event_type == "status" and payload["phase"] not in {
        "step_start",
        "step_finish",
    }:
        raise ValueError("Invalid status event field 'phase'")
    return payload


def _matches_type(
    value: object,
    expected_type: type[Any] | tuple[type[Any], ...],
) -> bool:
    if expected_type is int:
        return isinstance(value, int) and not isinstance(value, bool)
    if isinstance(expected_type, tuple) and int in expected_type:
        return isinstance(value, expected_type) and not isinstance(value, bool)
    return isinstance(value, expected_type)


def _type_name(expected_type: type[Any] | tuple[type[Any], ...]) -> str:
    if isinstance(expected_type, tuple):
        return " or ".join(item.__name__ for item in expected_type)
    return expected_type.__name__
