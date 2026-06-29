from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from types import SimpleNamespace
from unittest.mock import AsyncMock

from ai_query.types import Message, StepResult, ToolCall, ToolResult, Usage

from chump_server.agent import ChumpAgent
from chump_server.runtime.usage import default_usage_summary, zero_usage_dict


def make_agent() -> ChumpAgent:
    agent = object.__new__(ChumpAgent)
    agent._usage_summary = default_usage_summary()
    agent._usage_summary["current_turn"] = zero_usage_dict()
    agent._last_step_records = []
    agent._pending_tool_result_details = defaultdict(deque)
    agent._correlated_tool_result_details = {}
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
    )
    asyncio.run(
        agent._on_tool_lifecycle(
            SimpleNamespace(
                type="tool_execution.finished",
                step_number=1,
                index=1,
                tool_call=second_call,
                duration=0.1,
                error=None,
                aborted=False,
            )
        )
    )
    agent.capture_tool_result_detail(
        "bash",
        ok=True,
        preview="first output",
        metadata={"command": "first"},
    )
    asyncio.run(
        agent._on_tool_lifecycle(
            SimpleNamespace(
                type="tool_execution.finished",
                step_number=1,
                index=0,
                tool_call=first_call,
                duration=0.2,
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
