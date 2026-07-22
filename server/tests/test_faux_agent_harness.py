from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from ai_query import AbortError, Field, tool
from ai_query.providers import FauxProvider, FauxResponse, faux
from ai_query.types import ImagePart, TextPart, ToolCall, ToolResultPart

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
async def test_provider_failure_before_first_token_is_persisted_and_streamed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = faux(
        responses=[
            FauxResponse(error=RuntimeError("provider rejected request")),
        ]
    )
    config = _test_config(tmp_path)
    monkeypatch.setattr(ChumpAgent, "_server_config", config)
    monkeypatch.setattr(
        ChumpAgent,
        "_server_resources",
        ResourceCatalog(tmp_path),
    )

    agent = ChumpAgent("faux-provider-error")
    agent.model = model

    async with agent:
        frames = [
            frame
            async for frame in agent.handle_request_stream(
                {"message": "Trigger the provider"}
            )
        ]
        events = (await agent.event_log())["events"]

    assert frames == [
        "event: start\ndata: \n\n",
        'event: error\ndata: "provider rejected request"\n\n',
    ]
    turn_error = next(event for event in events if event["type"] == "turn_error")
    assert turn_error["data"] == {
        "message": "provider rejected request",
        "error_type": "RuntimeError",
        "schema_version": 1,
    }
    assert [event["type"] for event in events][-2:] == [
        "turn_error",
        "turn_status",
    ]
    assert events[-1]["data"]["running"] is False
    assert not any(event["type"] == "assistant_text" for event in events)


@pytest.mark.asyncio
async def test_abort_hands_pending_steering_to_one_follow_up_turn(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_started = asyncio.Event()
    provider_cancelled = asyncio.Event()
    image_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
    steering_message = (
        "Use this screenshot [Image: proof.png] and give me the short answer"
    )
    attachment = {
        "type": "image",
        "label": "[Image: proof.png]",
        "filename": "proof.png",
        "mime": "image/png",
        "data": image_data,
    }

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
        assert user_messages[0] == "Start the long task"
        assert user_messages[1] == [
            TextPart(text="Use this screenshot "),
            ImagePart(
                image=f"data:image/png;base64,{image_data}",
                media_type="image/png",
            ),
            TextPart(text=" and give me the short answer"),
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
            steering_message,
            attachments=[attachment],
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
        steering_message,
    ]
    assert user_events[-1]["data"]["steered"] is True
    assert user_events[-1]["data"]["attachments"] == [
        {
            "type": "image",
            "label": "[Image: proof.png]",
            "filename": "proof.png",
            "mime": "image/png",
        }
    ]

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


@pytest.mark.asyncio
async def test_parallel_same_name_tools_keep_reverse_completions_correlated(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _test_config(tmp_path)
    monkeypatch.setattr(ChumpAgent, "_server_config", config)
    monkeypatch.setattr(
        ChumpAgent,
        "_server_resources",
        ResourceCatalog(tmp_path),
    )

    agent = ChumpAgent("faux-parallel-tools")
    second_finished = asyncio.Event()
    completion_order: list[str] = []
    emitted_events: list[tuple[str, dict, int]] = []

    @tool(description="Read a deterministic item")
    async def read_item(
        item: str = Field(description="Item name"),
    ) -> str:
        if item == "first":
            await second_finished.wait()
        result = f"result:{item}"
        completion_order.append(item)
        agent.capture_tool_result_detail(
            "read_item",
            ok=True,
            preview=f"preview:{item}",
            metadata={"item": item},
            result=result,
        )
        if item == "second":
            second_finished.set()
        return result

    def final_response(call):
        tool_message = call.messages[-1]
        assert tool_message.role == "tool"
        assert isinstance(tool_message.content, list)
        assert all(
            isinstance(part, ToolResultPart) for part in tool_message.content
        )
        results = [part.tool_result for part in tool_message.content]
        assert [result.tool_call_id for result in results if result] == [
            "call_first",
            "call_second",
        ]
        assert [result.result for result in results if result] == [
            "result:first",
            "result:second",
        ]
        return FauxResponse(
            text="Both items are ready.",
            chunks=["Both items ", "are ready."],
        )

    model = faux(
        responses=[
            FauxResponse(
                tool_calls=[
                    ToolCall(
                        id="call_first",
                        name="read_item",
                        arguments={"item": "first"},
                    ),
                    ToolCall(
                        id="call_second",
                        name="read_item",
                        arguments={"item": "second"},
                    ),
                ],
                finish_reason="tool_calls",
            ),
            final_response,
        ]
    )
    provider = model.provider
    assert isinstance(provider, FauxProvider)
    agent.model = model
    agent.tools = {"read_item": read_item}

    async def capture_event(event: str, data: dict, event_id: int) -> None:
        emitted_events.append((event, data, event_id))

    agent._emit_handler = capture_event

    async with agent:
        chunks = [
            chunk
            async for chunk in agent.stream("Read the first and second items")
        ]
        durable_events = (await agent.event_log())["events"]

    assert chunks == ["Both items ", "are ready."]
    assert provider.call_count == 2
    provider.assert_exhausted()
    assert completion_order == ["second", "first"]

    execution_started = [
        data
        for event, data, _event_id in emitted_events
        if event == "tool_execution.started"
    ]
    assert [event["call_id"] for event in execution_started] == [
        "call_first",
        "call_second",
    ]

    execution_finished = [
        data
        for event, data, _event_id in emitted_events
        if event == "tool_execution.finished"
    ]
    assert [event["call_id"] for event in execution_finished] == [
        "call_second",
        "call_first",
    ]
    assert [event["preview"] for event in execution_finished] == [
        "preview:second",
        "preview:first",
    ]
    assert [event["metadata"] for event in execution_finished] == [
        {"item": "second"},
        {"item": "first"},
    ]

    tool_calls = [
        event["data"]
        for event in durable_events
        if event["type"] == "tool_call"
    ]
    assert [event["call_id"] for event in tool_calls] == [
        "call_first",
        "call_second",
    ]

    tool_results = [
        event["data"]
        for event in durable_events
        if event["type"] == "tool_result"
    ]
    assert [event["call_id"] for event in tool_results] == [
        "call_first",
        "call_second",
    ]
    assert [event["preview"] for event in tool_results] == [
        "preview:first",
        "preview:second",
    ]
    assert [event["metadata"] for event in tool_results] == [
        {"item": "first"},
        {"item": "second"},
    ]


@pytest.mark.asyncio
async def test_abort_waits_for_all_parallel_tools_before_terminating(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _test_config(tmp_path)
    monkeypatch.setattr(ChumpAgent, "_server_config", config)
    monkeypatch.setattr(
        ChumpAgent,
        "_server_resources",
        ResourceCatalog(tmp_path),
    )

    agent = ChumpAgent("faux-parallel-tool-abort")
    all_started = asyncio.Event()
    slow_cleanup_started = asyncio.Event()
    fast_cancelled = asyncio.Event()
    release_slow_cleanup = asyncio.Event()
    cancelled_tools: list[str] = []
    started_tools: set[str] = set()
    emitted_events: list[tuple[str, dict, int]] = []

    @tool(description="Block until the current turn is cancelled")
    async def wait_for_item(
        item: str = Field(description="Item name"),
    ) -> str:
        started_tools.add(item)
        if len(started_tools) == 2:
            all_started.set()
        try:
            await asyncio.Future()
        finally:
            if item == "slow":
                slow_cleanup_started.set()
                await release_slow_cleanup.wait()
            cancelled_tools.append(item)
            if item == "fast":
                fast_cancelled.set()

    model = faux(
        responses=[
            FauxResponse(
                tool_calls=[
                    ToolCall(
                        id="call_slow",
                        name="wait_for_item",
                        arguments={"item": "slow"},
                    ),
                    ToolCall(
                        id="call_fast",
                        name="wait_for_item",
                        arguments={"item": "fast"},
                    ),
                ],
                finish_reason="tool_calls",
            )
        ]
    )
    provider = model.provider
    assert isinstance(provider, FauxProvider)
    agent.model = model
    agent.tools = {"wait_for_item": wait_for_item}

    async def capture_event(event: str, data: dict, event_id: int) -> None:
        emitted_events.append((event, data, event_id))

    agent._emit_handler = capture_event

    async def collect_chunks() -> list[str]:
        return [
            chunk
            async for chunk in agent.stream(
                "Wait for the slow and fast items"
            )
        ]

    async with agent:
        stream_task = asyncio.create_task(collect_chunks())
        await asyncio.wait_for(all_started.wait(), timeout=1)

        assert await agent.abort_current_turn() == {"status": "aborting"}
        await asyncio.wait_for(fast_cancelled.wait(), timeout=1)
        await asyncio.wait_for(slow_cleanup_started.wait(), timeout=1)
        await asyncio.sleep(0)
        terminated_before_slow_cleanup = stream_task.done()

        release_slow_cleanup.set()
        with pytest.raises(AbortError, match="aborted by user"):
            await asyncio.wait_for(stream_task, timeout=1)

        durable_events = (await agent.event_log())["events"]
        status = await agent.status()

    assert terminated_before_slow_cleanup is False
    assert cancelled_tools == ["fast", "slow"]
    assert provider.call_count == 1
    provider.assert_exhausted()

    execution_finished = [
        data
        for event, data, _event_id in emitted_events
        if event == "tool_execution.finished"
    ]
    assert {event["call_id"] for event in execution_finished} == {
        "call_slow",
        "call_fast",
    }
    assert all(event["aborted"] is True for event in execution_finished)
    assert all(event["ok"] is False for event in execution_finished)
    assert all(event["status"] == "aborted" for event in execution_finished)

    assert not any(
        event["type"] == "tool_result" for event in durable_events
    )
    terminal_events = [
        event
        for event in durable_events
        if event["type"] == "turn_status" and event["data"]["running"] is False
    ]
    assert len(terminal_events) == 1
    assert durable_events[-1] == terminal_events[0]
    assert status["turn_running"] is False


@pytest.mark.asyncio
async def test_manual_skill_command_uses_bundle_but_emits_short_display(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    skill_dir = tmp_path / ".agents" / "skills" / "release"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: release\n"
        "description: Publish the current project.\n"
        "disable-model-invocation: true\n"
        "---\n\n"
        "# Release\n\nRun the release checklist.\n",
        encoding="utf-8",
    )
    resources = ResourceCatalog(tmp_path)
    config = _test_config(tmp_path)
    monkeypatch.setattr(ChumpAgent, "_server_config", config)
    monkeypatch.setattr(ChumpAgent, "_server_resources", resources)

    def response(call):
        user_message = call.messages[-1]
        assert user_message.role == "user"
        assert isinstance(user_message.content, str)
        assert user_message.content.startswith(
            '<skill_content name="release">\n# Release'
        )
        assert "disable-model-invocation" not in user_message.content
        assert user_message.content.endswith("User: publish patch")
        return FauxResponse(text="Release ready.", chunks=["Release ready."])

    model = faux(responses=[response])
    provider = model.provider
    assert isinstance(provider, FauxProvider)
    agent = ChumpAgent("faux-manual-skill")
    agent.model = model

    async with agent:
        loaded = await agent.load_skill("release", "publish patch")
        chunks = [
            chunk
            async for chunk in agent.stream(
                loaded["prompt"],
                display_message="/skill:release publish patch",
            )
        ]
        events = (await agent.event_log())["events"]

    assert chunks == ["Release ready."]
    assert loaded["name"] == "release"
    assert provider.call_count == 1
    provider.assert_exhausted()
    user_event = next(event for event in events if event["type"] == "user_message")
    assert user_event["data"]["content"] == "/skill:release publish patch"
    assert user_event["data"]["display_content"] == (
        "/skill:release publish patch"
    )
