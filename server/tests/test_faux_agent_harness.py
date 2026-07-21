from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from ai_query import Field, tool
from ai_query.providers import FauxProvider, FauxResponse, faux
from ai_query.types import ToolCall

from chump_server.agent import ChumpAgent
from chump_server.config import ChumpConfig
from chump_server.resources import ResourceCatalog


def _test_config(workspace_root: Path) -> ChumpConfig:
    return ChumpConfig(
        host="127.0.0.1",
        port=0,
        workspace_root=workspace_root,
        data_dir=workspace_root / ".chump-test",
        provider="faux",
        model="faux-1",
        max_steps=4,
        retry_max_attempts=1,
        retry_initial_delay=0,
        retry_max_delay=0,
        retry_backoff=1,
        retry_jitter=False,
        command_timeout=10,
        managed_idle_timeout=None,
        compaction_tokens=None,
        compaction_keep_recent_tokens=1_000,
        reasoning=None,
        verbose=False,
        allowed_origins=(),
        available_providers=("faux",),
    )


@pytest.mark.asyncio
async def test_faux_provider_drives_and_reloads_a_complete_chump_turn(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @tool(description="Read a deterministic profile fixture")
    async def read_profile(
        name: str = Field(description="Profile name"),
    ) -> str:
        return f"profile:{name}"

    def final_response(call):
        assert call.messages[-1].role == "tool"
        return FauxResponse(
            text="Profile ready.",
            chunks=["Profile ", "ready."],
        )

    model = faux(
        responses=[
            FauxResponse(
                tool_calls=[
                    ToolCall(
                        id="call_profile",
                        name="read_profile",
                        arguments={"name": "chump"},
                    )
                ],
                finish_reason="tool_calls",
            ),
            final_response,
        ]
    )
    provider = model.provider
    assert isinstance(provider, FauxProvider)

    config = _test_config(tmp_path)
    monkeypatch.setattr(ChumpAgent, "_server_config", config)
    monkeypatch.setattr(
        ChumpAgent,
        "_server_resources",
        ResourceCatalog(tmp_path),
    )

    agent = ChumpAgent("faux-harness")
    agent.model = model
    agent.tools = {"read_profile": read_profile}

    async with agent:
        chunks = [chunk async for chunk in agent.stream("Load the Chump profile")]
        original_events = (await agent.event_log())["events"]

    assert chunks == ["Profile ", "ready."]
    assert provider.call_count == 2
    provider.assert_exhausted()

    event_types = [event["type"] for event in original_events]
    assert event_types[0] == "user_message"
    assert "state" in event_types
    assert "turn_status" in event_types
    assert event_types[-1] == "turn_status"
    assert "tool_call" in event_types
    assert "tool_result" in event_types
    assert event_types.count("assistant_text") == 2

    tool_result = next(
        event for event in original_events if event["type"] == "tool_result"
    )
    assert tool_result["data"] == {
        "tool": "read_profile",
        "name": "read_profile",
        "tool_name": "read_profile",
        "id": "call_profile",
        "call_id": "call_profile",
        "tool_call_id": "call_profile",
        "step": 1,
        "index": 0,
        "ok": True,
        "status": "ok",
        "is_error": False,
        "preview": "profile:chump",
        "metadata": {},
        "duration": tool_result["data"]["duration"],
        "schema_version": 1,
    }

    chump_event_types = {
        "assistant_text",
        "user_message",
        "tool_call",
        "tool_result",
        "agent_status",
        "turn_status",
        "status",
    }
    assert all(
        event["data"]["schema_version"] == 1
        for event in original_events
        if event["type"] in chump_event_types
    )

    replay_cursor = original_events[len(original_events) // 2]["id"]
    replayed_events = [
        {"id": event.id, "type": event.type, "data": event.data}
        async for event in agent.replay_events(after_id=replay_cursor)
    ]
    assert replayed_events == [
        event for event in original_events if event["id"] > replay_cursor
    ]
    assert [event["id"] for event in replayed_events] == sorted(
        {event["id"] for event in replayed_events}
    )

    reloaded = ChumpAgent("faux-harness")
    async with reloaded:
        reloaded_events = (await reloaded.event_log())["events"]
        reloaded_roles = [message.role for message in reloaded.messages]
        reloaded_final_text = reloaded.messages[-1].content

    assert reloaded_events == original_events
    assert reloaded_roles == ["user", "assistant", "tool", "assistant"]
    assert reloaded_final_text == "Profile ready."


@pytest.mark.asyncio
async def test_abort_hands_pending_steering_to_one_follow_up_turn(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_started = asyncio.Event()
    provider_cancelled = asyncio.Event()

    async def blocked_response(_call):
        provider_started.set()
        try:
            await asyncio.Future()
        finally:
            provider_cancelled.set()

    def follow_up_response(call):
        user_messages = [
            message.content for message in call.messages if message.role == "user"
        ]
        assert user_messages == [
            "Start the long task",
            "Skip it and give me the short answer",
        ]
        return FauxResponse(
            text="Short answer ready.",
            chunks=["Short answer ", "ready."],
        )

    model = faux(responses=[blocked_response, follow_up_response])
    provider = model.provider
    assert isinstance(provider, FauxProvider)

    config = _test_config(tmp_path)
    monkeypatch.setattr(ChumpAgent, "_server_config", config)
    monkeypatch.setattr(
        ChumpAgent,
        "_server_resources",
        ResourceCatalog(tmp_path),
    )

    agent = ChumpAgent("faux-interrupt-steering")
    agent.model = model

    async def collect_chunks() -> list[str]:
        return [chunk async for chunk in agent.stream("Start the long task")]

    async with agent:
        stream_task = asyncio.create_task(collect_chunks())
        await asyncio.wait_for(provider_started.wait(), timeout=1)

        assert await agent.steer_current_turn(
            "Skip it and give me the short answer"
        ) == {"status": "steered"}
        assert await agent.abort_current_turn() == {"status": "aborting"}

        chunks = await asyncio.wait_for(stream_task, timeout=1)
        await asyncio.wait_for(provider_cancelled.wait(), timeout=1)
        events = (await agent.event_log())["events"]
        status = await agent.status()

    assert chunks == ["Short answer ", "ready."]
    assert provider.call_count == 2
    provider.assert_exhausted()

    user_events = [
        event for event in events if event["type"] == "user_message"
    ]
    assert [event["data"]["content"] for event in user_events] == [
        "Start the long task",
        "Skip it and give me the short answer",
    ]
    assert user_events[-1]["data"]["steered"] is True

    terminal_events = [
        event
        for event in events
        if event["type"] == "turn_status" and event["data"]["running"] is False
    ]
    assert len(terminal_events) == 1
    assert events[-1] == terminal_events[0]
    assert terminal_events[0]["data"]["steering_queue"] == []
    assert status["turn_running"] is False
    assert status["steering_queue"] == []
