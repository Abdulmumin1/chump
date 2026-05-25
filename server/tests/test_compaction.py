from ai_query.types import Message

from chump_server.runtime.compaction import choose_compaction_start


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
