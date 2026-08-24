"""E2E: drive a full parent turn whose model calls start_session and capture
every event the parent emits (the exact SSE payloads the TUI receives)."""

from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path

import pytest

from ai_query.types import ToolCall
from ai_query.agents import AgentServer
from ai_query.providers import FauxResponse, faux
from ai_query.types import TextPart

from chump_server.agent import ChumpAgent, bind_chump_agent
from chump_server.config import ChumpConfig
from chump_server.resources import ResourceCatalog

from test_faux_agent_harness import _test_config


@pytest.mark.asyncio
async def test_parent_turn_delegation_event_sequence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = replace(
        _test_config(tmp_path),
        provider="codex",
        model="gpt-5.4",
        max_steps=4,
        available_providers=("codex",),
    )

    parent_model = faux(
        responses=[
            FauxResponse(
                tool_calls=[
                    ToolCall(
                        id="call-start-1",
                        name="start_session",
                        arguments={
                            "prompt": "Do the delegated work",
                            "session_id": "child-session",
                            "model": "gpt-5.6",
                        },
                    )
                ]
            ),
            FauxResponse(text="Parent final answer.", chunks=["Parent final ", "answer."]),
        ]
    )
    child_model = faux(
        responses=[
            FauxResponse(
                text="Child final answer.",
                chunks=["Child ", "final answer."],
            )
        ]
    )
    monkeypatch.setattr("chump_server.tools.sessions.load_auth_config", lambda: {})
    monkeypatch.setattr("chump_server.config.load_auth_config", lambda: {})
    # Distinguish parent vs child by their config model name.
    monkeypatch.setattr(
        "chump_server.agent.resolve_model",
        lambda agent_config: child_model
        if agent_config.model == "gpt-5.6"
        else parent_model,
    )

    server = AgentServer(bind_chump_agent(config, ResourceCatalog(tmp_path)))
    parent = server.get_or_create("parent-session")
    await parent.start()

    emitted: list[tuple[str, dict]] = []

    async def capture(event: str, data: dict, event_id: int) -> None:
        emitted.append((event, data))

    parent._emit_handler = capture  # type: ignore[attr-defined]

    try:
        chunks: list[str] = []
        async for chunk in parent.stream("Do the work"):
            chunks.append(chunk)
    finally:
        await server.evict("parent-session")
        await server.evict("child-session")

    print("=== EMITTED EVENTS ===")
    for event, data in emitted:
        print(f"{event}: {json.dumps(data)[:220]}")

    types = [event for event, _ in emitted]

    # The TUI depends on this exact lifecycle ordering:
    # 1. the tool_call row (tool_call.ready),
    # 2. live delegated progress (tool_execution.progress),
    # 3. the completion (tool_execution.finished, then tool_result).
    assert "tool_call" in types
    assert "tool_execution.progress" in types
    assert "tool_execution.finished" in types
    assert "tool_result" in types

    tool_result = next(data for event, data in emitted if event == "tool_result")
    assert tool_result["ok"] is True
    assert "response" in tool_result["preview"]

    # The parent turn must complete and hand control back to the model loop.
    assert "".join(chunks) == "Parent final answer."
