from __future__ import annotations

import json
from pathlib import Path

import pytest

from chump_server.events import (
    CHUMP_EVENT_SCHEMA_VERSION,
    CHUMP_EVENT_TYPES,
    version_chump_event_payload,
)


PROTOCOL_ROOT = Path(__file__).resolve().parents[2] / "protocol"


def test_shared_v1_fixtures_match_the_server_contract() -> None:
    fixture = json.loads(
        (PROTOCOL_ROOT / "fixtures" / "chump-events-v1.json").read_text()
    )

    assert fixture["schema_version"] == CHUMP_EVENT_SCHEMA_VERSION
    assert {event["type"] for event in fixture["events"]} == CHUMP_EVENT_TYPES
    for event in fixture["events"]:
        assert version_chump_event_payload(event["type"], event["data"]) == event["data"]


def test_schema_and_server_declare_the_same_event_vocabulary() -> None:
    schema = json.loads((PROTOCOL_ROOT / "chump-events-v1.schema.json").read_text())
    schema_types = {
        definition["properties"]["type"]["const"]
        for name, definition in schema["$defs"].items()
        if name.startswith("event_") and "properties" in definition
    }

    assert schema_types == CHUMP_EVENT_TYPES


def test_server_versions_new_events_without_mutating_the_caller() -> None:
    original = {"content": "hello"}

    versioned = version_chump_event_payload("assistant_text", original)

    assert versioned == {"schema_version": 1, "content": "hello"}
    assert original == {"content": "hello"}


@pytest.mark.parametrize(
    ("event_type", "payload"),
    [
        ("assistant_text", {}),
        ("turn_status", {"running": "yes", "steering_queue": []}),
        ("turn_error", {"message": "failed", "error_type": 500}),
        ("status", {"phase": "unknown", "step": 1}),
        ("user_message", {"schema_version": 2, "content": "hello"}),
    ],
)
def test_server_rejects_malformed_or_future_events(
    event_type: str,
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValueError):
        version_chump_event_payload(event_type, payload)


def test_ai_query_runtime_events_pass_through_unchanged() -> None:
    payload = {"step": 1, "index": 0}

    assert version_chump_event_payload("tool_execution.started", payload) is payload
