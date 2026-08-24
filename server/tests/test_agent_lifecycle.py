from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from ai_query.types import Message, StepResult, ToolCall, ToolResult, Usage

from chump_server.agent import ChumpAgent
from chump_server.runtime.delegated_progress import (
    PENDING_DELEGATED_SESSIONS_STATE_KEY,
)
from chump_server.runtime.usage import default_usage_summary, zero_usage_dict


def make_agent() -> ChumpAgent:
    agent = object.__new__(ChumpAgent)
    agent._usage_summary = default_usage_summary()
    agent._usage_summary["current_turn"] = zero_usage_dict()
    agent._state = {}
    agent._last_step_records = []
    agent._pending_tool_result_details = defaultdict(deque)
    agent._correlated_tool_result_details = {}
    agent._event_log = []
    agent._event_counter = 0
    agent._persist_usage_summary = AsyncMock()
    agent._persist_messages = AsyncMock()
    agent.emit = AsyncMock()
    agent.status = AsyncMock(return_value={})
    agent._log = lambda message: None
    return agent


def step_event(step_number: int, usage: Usage):
    step = StepResult(
        text="",
        tool_calls=[],
        tool_results=[],
        usage=usage,
    )
    return SimpleNamespace(step_number=step_number, step=step, usage=usage)


def test_codex_provider_options_do_not_duplicate_system_prompt():
    agent = object.__new__(ChumpAgent)
    agent.provider_options = {}
    agent.system = "System instructions"

    assert agent._turn_provider_options() is None


def test_step_usage_accumulates_new_ai_query_per_step_usage():
    agent = make_agent()

    asyncio.run(
        agent._on_step_finish(
            step_event(
                1,
                Usage(input_tokens=10, output_tokens=2, total_tokens=12),
            )
        )
    )
    asyncio.run(
        agent._on_step_finish(
            step_event(
                2,
                Usage(input_tokens=20, output_tokens=3, total_tokens=23),
            )
        )
    )

    assert agent._usage_summary["last_step"] == {
        "input_tokens": 20,
        "output_tokens": 3,
        "cached_tokens": 0,
        "total_tokens": 23,
    }
    assert agent._usage_summary["current_turn"] == {
        "input_tokens": 30,
        "output_tokens": 5,
        "cached_tokens": 0,
        "total_tokens": 35,
    }
    assert agent._last_step_records[-1]["cumulative_usage"]["total_tokens"] == 35


def test_auto_compaction_runs_between_steps_after_context_crosses_threshold():
    agent = make_agent()
    agent._config = SimpleNamespace(compaction_tokens=200_000)
    agent._pending_auto_compaction_tokens = None
    agent._messages = [
        Message(role="user", content="work"),
        Message(role="assistant", content="calling a tool"),
        Message(role="tool", content="large result"),
    ]
    agent._compact_messages = AsyncMock(return_value={"status": "ok"})

    asyncio.run(
        agent.after_step(
            SimpleNamespace(
                event=SimpleNamespace(
                    usage=Usage(
                        input_tokens=204_000,
                        output_tokens=1_000,
                        total_tokens=205_000,
                    )
                )
            )
        )
    )

    runtime_messages = [
        Message(role="system", content="instructions"),
        *agent._messages,
    ]
    asyncio.run(
        agent.before_step(
            SimpleNamespace(
                step_number=2,
                event=SimpleNamespace(messages=runtime_messages),
            )
        )
    )

    agent._compact_messages.assert_awaited_once_with(
        reason="auto",
        estimated_tokens=205_000,
        messages=runtime_messages,
        persist_system_prefix=1,
    )
    assert agent._pending_auto_compaction_tokens is None


def test_in_turn_compaction_replaces_runtime_and_persisted_history():
    agent = make_agent()
    agent._config = SimpleNamespace(compaction_keep_recent_tokens=2)
    agent._usage_summary["current_turn"] = {
        "input_tokens": 205_000,
        "output_tokens": 1_000,
        "cached_tokens": 0,
        "total_tokens": 206_000,
    }
    agent._generate_compaction_summary = AsyncMock(return_value="Durable summary")
    agent.update_state = AsyncMock()
    runtime_messages = [
        Message(role="system", content="instructions"),
        Message(role="user", content="old request"),
        Message(role="assistant", content="old response"),
        Message(role="user", content="recent request"),
        Message(role="assistant", content="recent response"),
    ]
    agent._messages = list(runtime_messages[1:])

    result = asyncio.run(
        agent._compact_messages(
            reason="auto",
            estimated_tokens=206_000,
            messages=runtime_messages,
            persist_system_prefix=1,
        )
    )

    assert result["status"] == "ok"
    assert runtime_messages[0].role == "system"
    assert "Durable summary" in str(runtime_messages[1].content)
    assert agent._messages == runtime_messages[1:]
    assert agent._usage_summary["current_turn"]["total_tokens"] == 206_000
    agent._persist_messages.assert_awaited_once()


def test_auto_compaction_is_not_scheduled_below_threshold():
    agent = make_agent()
    agent._config = SimpleNamespace(compaction_tokens=200_000)
    agent._pending_auto_compaction_tokens = None

    asyncio.run(
        agent.after_step(
            SimpleNamespace(
                event=SimpleNamespace(
                    usage=Usage(
                        input_tokens=198_000,
                        output_tokens=1_000,
                        total_tokens=199_000,
                    )
                )
            )
        )
    )

    assert agent._pending_auto_compaction_tokens is None


def test_finalize_turn_keeps_accumulated_usage_instead_of_final_step_only():
    agent = make_agent()
    agent._usage_summary["current_turn"] = {
        "input_tokens": 30,
        "output_tokens": 5,
        "cached_tokens": 0,
        "total_tokens": 35,
    }
    result = SimpleNamespace(
        usage=Usage(input_tokens=20, output_tokens=3, total_tokens=23)
    )

    response = asyncio.run(agent._finalize_turn(result, "done"))

    assert response == "done"
    assert agent._usage_summary["last_turn"]["total_tokens"] == 35
    assert agent._usage_summary["session_total"]["total_tokens"] == 35


def test_delegated_turn_rejects_tool_only_completion_fallback():
    agent = make_agent()
    agent._state = {"delegated_task_status": "running"}
    tool_call = ToolCall(
        id="call-read",
        name="read_file",
        arguments={"path": "x"},
    )
    result = SimpleNamespace(
        usage=None,
        steps=[
            StepResult(
                text="",
                tool_calls=[tool_call],
                tool_results=[
                    ToolResult(
                        tool_call_id=tool_call.id,
                        tool_name=tool_call.name,
                        result="contents",
                    )
                ],
            )
        ],
    )

    for streamed_text in ["", "I will inspect the file first."]:
        with pytest.raises(RuntimeError, match="ended without a final answer"):
            asyncio.run(agent._finalize_turn(result, streamed_text))


def test_finalize_reconciles_missing_assistant_message_after_tool_steps():
    agent = make_agent()
    agent._messages = [
        Message(role="user", content="Do work"),
        Message(role="assistant", content=[]),
        Message(role="tool", content=[]),
    ]
    final_step = StepResult(
        text="Durable final answer",
        tool_calls=[],
        tool_results=[],
    )

    asyncio.run(
        agent._ensure_final_assistant_persisted(
            SimpleNamespace(steps=[final_step]),
            "Durable final answer",
        )
    )

    assert agent._messages[-1].role == "assistant"
    assert agent._messages[-1].content == "Durable final answer"
    agent._persist_messages.assert_awaited_once()

    asyncio.run(
        agent._ensure_final_assistant_persisted(
            SimpleNamespace(steps=[final_step]),
            "Durable final answer",
        )
    )
    assert len(agent._messages) == 4
    agent._persist_messages.assert_awaited_once()


def test_finalize_does_not_append_aggregated_commentary_after_a_tool_step():
    agent = make_agent()
    original_messages = [
        Message(role="user", content="Review the branch"),
        Message(role="assistant", content="I will inspect the diff."),
        Message(role="tool", content=[]),
    ]
    agent._messages = list(original_messages)
    tool_step = StepResult(
        text="I will inspect the diff.",
        tool_calls=[
            ToolCall(
                id="call_read",
                name="read_file",
                arguments={"path": "README.md"},
            )
        ],
        tool_results=[],
    )

    asyncio.run(
        agent._ensure_final_assistant_persisted(
            SimpleNamespace(steps=[tool_step]),
            "I will inspect the diff.I will run the tests.",
        )
    )

    assert agent._messages == original_messages
    agent._persist_messages.assert_not_awaited()


def test_ready_tool_call_uses_existing_client_event_with_correlation_fields():
    agent = make_agent()
    event = SimpleNamespace(
        type="tool_call.ready",
        step_number=2,
        index=1,
        tool_call=ToolCall(
            id="call_123",
            name="read_file",
            arguments={"path": "README.md"},
        ),
    )

    asyncio.run(agent._on_tool_lifecycle(event))

    agent.emit.assert_awaited_once_with(
        "tool_call",
        {
            "tool": "read_file",
            "name": "read_file",
            "payload": {"path": "README.md"},
            "args": {"path": "README.md"},
            "id": "call_123",
            "call_id": "call_123",
            "tool_call_id": "call_123",
            "step": 2,
            "index": 1,
            "status": "ready",
        },
    )


def test_same_name_parallel_results_keep_call_id_and_completion_metadata():
    agent = make_agent()
    second_call = ToolCall(
        id="call_second",
        name="bash",
        arguments={"command": "second"},
    )
    first_call = ToolCall(
        id="call_first",
        name="bash",
        arguments={"command": "first"},
    )

    agent.capture_tool_result_detail(
        "bash",
        ok=True,
        preview="second output",
        metadata={"command": "second"},
        result="second output",
        display_output="second output\nsecond detail",
    )
    agent.capture_tool_result_detail(
        "bash",
        ok=True,
        preview="first output",
        metadata={"command": "first"},
        result="first output",
        display_output="first output\nfirst detail",
    )

    # Both same-name calls may record their details before lifecycle events are
    # consumed. Completion order must not decide which call receives a result.
    for index, call, output, duration in [
        (1, second_call, "second output", 0.1),
        (0, first_call, "first output", 0.2),
    ]:
        asyncio.run(
            agent._on_tool_lifecycle(
                SimpleNamespace(
                    type="tool_execution.finished",
                    step_number=1,
                    index=index,
                    tool_call=call,
                    tool_result=ToolResult(
                        tool_call_id=call.id,
                        tool_name="bash",
                        result=output,
                    ),
                    duration=duration,
                    error=None,
                    aborted=False,
                )
            )
        )

    for index, call, output in [
        (0, first_call, "first output"),
        (1, second_call, "second output"),
    ]:
        asyncio.run(
            agent._on_tool_lifecycle(
                SimpleNamespace(
                    type="tool_result",
                    step_number=1,
                    index=index,
                    tool_call=call,
                    tool_result=ToolResult(
                        tool_call_id=call.id,
                        tool_name="bash",
                        result=output,
                    ),
                )
            )
        )

    final_events = [
        call
        for call in agent.emit.await_args_list
        if call.args and call.args[0] == "tool_result"
    ]
    assert [event.args[1]["call_id"] for event in final_events] == [
        "call_first",
        "call_second",
    ]
    assert [event.args[1]["preview"] for event in final_events] == [
        "first output",
        "second output",
    ]
    assert [event.args[1]["display_output"] for event in final_events] == [
        "first output\nfirst detail",
        "second output\nsecond detail",
    ]


def test_start_session_execution_completion_is_durable_before_tool_result():
    agent = make_agent()
    call = ToolCall(
        id="parent-delegation",
        name="start_session",
        arguments={"session_id": "child-session"},
    )
    agent.capture_tool_result_detail(
        "start_session",
        ok=True,
        preview='{"delegated_task_status":"completed"}',
        metadata={"delegated_task_status": "completed"},
        result='{"delegated_task_status":"completed"}',
    )

    asyncio.run(
        agent._on_tool_lifecycle(
            SimpleNamespace(
                type="tool_execution.finished",
                step_number=3,
                index=0,
                tool_call=call,
                tool_result=ToolResult(
                    tool_call_id=call.id,
                    tool_name="start_session",
                    result='{"delegated_task_status":"completed"}',
                ),
                duration=1.25,
                error=None,
                aborted=False,
            )
        )
    )

    emitted = agent.emit.await_args
    assert emitted.args[0] == "tool_execution.finished"
    assert emitted.args[1]["call_id"] == "parent-delegation"
    assert emitted.kwargs["replay"] is True


def test_generated_start_session_link_is_saved_in_parent_state():
    agent = make_agent()
    call = ToolCall(
        id="parent-delegation",
        name="start_session",
        arguments={"prompt": "Investigate this"},
    )
    agent._event_log = [
        {
            "id": 41,
            "type": "tool_call",
            "data": {"call_id": call.id, "name": call.name},
        }
    ]

    async def update_state(**changes):
        agent._state.update(changes)

    agent.update_state = AsyncMock(side_effect=update_state)

    asyncio.run(
        agent._on_tool_lifecycle(
            SimpleNamespace(
                type="tool_execution.progress",
                step_number=3,
                index=0,
                tool_call=call,
                message="Delegated session started",
                data={
                    "kind": "delegated_session",
                    "session_id": "generated-child",
                    "event": {"type": "session_starting"},
                },
            )
        )
    )

    assert agent.state[PENDING_DELEGATED_SESSIONS_STATE_KEY] == {
        "parent-delegation": {
            "session_id": "generated-child",
            "event_id": 41,
            "step": 3,
            "index": 0,
        }
    }


def test_persisted_step_result_clears_parent_child_link():
    agent = make_agent()
    agent._state[PENDING_DELEGATED_SESSIONS_STATE_KEY] = {
        "parent-delegation": {
            "session_id": "generated-child",
            "event_id": 41,
            "step": 3,
            "index": 0,
        }
    }

    async def update_state(**changes):
        agent._state.update(changes)

    agent.update_state = AsyncMock(side_effect=update_state)
    step = StepResult(
        text="",
        tool_calls=[
            ToolCall(
                id="parent-delegation",
                name="start_session",
                arguments={"prompt": "Investigate this"},
            )
        ],
        tool_results=[
            ToolResult(
                tool_call_id="parent-delegation",
                tool_name="start_session",
                result="done",
            )
        ],
        usage=Usage(input_tokens=1, output_tokens=1, total_tokens=2),
    )

    asyncio.run(
        agent._on_step_finish(
            SimpleNamespace(step_number=3, step=step, usage=step.usage)
        )
    )

    assert agent.state[PENDING_DELEGATED_SESSIONS_STATE_KEY] == {}
