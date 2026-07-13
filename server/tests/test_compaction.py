from ai_query.types import Message

from chump_server.agent import ChumpAgent
from chump_server.runtime.compaction import (
    choose_compaction_start,
    replace_compacted_messages,
)
from chump_server.runtime.usage import context_usage_dict, latest_usage_context_tokens


def test_compaction_boundary_keeps_tool_call_with_single_result():
    messages = [
        Message(role="user", content="start"),
        Message(role="assistant", content="ok"),
        Message(
            role="assistant",
            content=[
                {
                    "type": "tool_call",
                    "tool_call": {
                        "id": "call_1",
                        "name": "bash",
                        "arguments": {"command": "pwd"},
                    },
                }
            ],
        ),
        Message(
            role="tool",
            content=[
                {
                    "type": "tool_result",
                    "tool_result": {
                        "tool_call_id": "call_1",
                        "tool_name": "bash",
                        "result": "/tmp",
                        "is_error": False,
                    },
                }
            ],
        ),
        Message(role="user", content="next"),
    ]

    assert choose_compaction_start(messages, keep_recent_tokens=2, force=True) == 2


def test_compaction_boundary_keeps_tool_call_with_multiple_results():
    messages = [
        Message(role="user", content="start"),
        Message(
            role="assistant",
            content=[
                {
                    "type": "tool_call",
                    "tool_call": {
                        "id": "call_1",
                        "name": "bash",
                        "arguments": {"command": "pwd"},
                    },
                },
                {
                    "type": "tool_call",
                    "tool_call": {
                        "id": "call_2",
                        "name": "bash",
                        "arguments": {"command": "ls"},
                    },
                },
            ],
        ),
        Message(
            role="tool",
            content=[
                {
                    "type": "tool_result",
                    "tool_result": {
                        "tool_call_id": "call_1",
                        "tool_name": "bash",
                        "result": "/tmp",
                        "is_error": False,
                    },
                }
            ],
        ),
        Message(
            role="tool",
            content=[
                {
                    "type": "tool_result",
                    "tool_result": {
                        "tool_call_id": "call_2",
                        "tool_name": "bash",
                        "result": "file.txt",
                        "is_error": False,
                    },
                }
            ],
        ),
        Message(role="user", content="next"),
    ]

    assert choose_compaction_start(messages, keep_recent_tokens=2, force=True) == 1


def test_forced_compaction_keeps_recent_messages_when_local_estimate_is_low():
    messages = [
        Message(role="user", content="one"),
        Message(role="assistant", content="two"),
        Message(role="user", content="three"),
        Message(role="assistant", content="four"),
        Message(role="user", content="five"),
    ]

    assert choose_compaction_start(messages, keep_recent_tokens=200_000) == 1
    assert choose_compaction_start(messages, keep_recent_tokens=200_000, force=True) == 3


def test_compaction_preserves_leading_system_messages():
    messages = [
        Message(role="system", content="Follow these instructions."),
        Message(role="user", content="one"),
        Message(role="assistant", content="two"),
        Message(role="user", content="three"),
        Message(role="assistant", content="four"),
    ]

    keep_start = choose_compaction_start(
        messages,
        keep_recent_tokens=2,
        force=True,
    )
    compacted = replace_compacted_messages(messages, keep_start, "Summary.")

    assert keep_start == 3
    assert compacted[0] == messages[0]
    assert compacted[0].role == "system"
    assert compacted[1].role == "user"
    assert "Summary." in str(compacted[1].content)


def test_context_token_estimate_uses_last_step_total_as_source_of_truth():
    agent = ChumpAgent.__new__(ChumpAgent)
    agent._usage_summary = {
        "last_step": {
            "input_tokens": 45_000,
            "output_tokens": 1_000,
            "cached_tokens": 0,
            "total_tokens": 46_000,
        },
        "current_turn": {
            "input_tokens": 900_000,
            "output_tokens": 20_000,
            "cached_tokens": 0,
            "total_tokens": 920_000,
        },
        "last_turn": {
            "input_tokens": 800_000,
            "output_tokens": 20_000,
            "cached_tokens": 0,
            "total_tokens": 820_000,
        },
        "session_total": {
            "input_tokens": 5_000_000,
            "output_tokens": 100_000,
            "cached_tokens": 0,
            "total_tokens": 5_100_000,
        },
    }

    assert agent._context_token_estimate() == 46_000


def test_post_compaction_usage_updates_last_step_total():
    usage = {
        "last_step": context_usage_dict(12_345),
        "current_turn": context_usage_dict(900_000),
        "last_turn": context_usage_dict(800_000),
        "session_total": context_usage_dict(5_100_000),
    }

    assert usage["last_step"]["total_tokens"] == 12_345
    assert latest_usage_context_tokens(usage) == 12_345
