import asyncio
import json
import sys
from pathlib import Path

from ai_query.types import Message

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.providers.codex import CODEX_API_BASE_URL, CodexProvider


def test_codex_generate_uses_required_streaming_responses_api_for_compaction(tmp_path):
    provider = CodexProvider(
        auth_path=tmp_path / "auth.json",
        auth_config={
            "credentials": {
                "codex": {
                    "access": "access-token",
                    "refresh": "refresh-token",
                    "expires": 9_999_999_999_999,
                }
            }
        },
    )

    calls: list[tuple[str, dict]] = []

    events = [
        {"type": "response.output_text.delta", "delta": "summary text"},
        {
            "type": "response.completed",
            "response": {
                "id": "resp_123",
                "model": "gpt-5.5",
                "status": "completed",
                "output": [],
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 5,
                    "total_tokens": 15,
                    "input_tokens_details": {"cached_tokens": 0},
                },
            },
        },
    ]
    stream_bytes = "".join(
        f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events
    ).encode()

    class DummyTransport:
        async def stream(self, url, json, headers=None):
            calls.append((url, json))
            yield stream_bytes

    provider._transport = DummyTransport()

    result = asyncio.run(
        provider.generate(
            model="gpt-5.5",
            messages=[Message(role="user", content="summarize this transcript")],
        )
    )

    assert result.text == "summary text"
    assert calls == [
        (
            f"{CODEX_API_BASE_URL}/responses",
            {
                "model": "gpt-5.5",
                "input": [{"role": "user", "content": "summarize this transcript"}],
                "include": ["reasoning.encrypted_content"],
                "store": False,
                "stream": True,
            },
        )
    ]


def test_codex_stream_forwards_tool_call_argument_deltas(tmp_path):
    provider = CodexProvider(
        auth_path=tmp_path / "auth.json",
        auth_config={
            "credentials": {
                "codex": {
                    "access": "access-token",
                    "refresh": "refresh-token",
                    "expires": 9_999_999_999_999,
                }
            }
        },
    )
    tool_item = {
        "id": "fc_123",
        "type": "function_call",
        "status": "completed",
        "arguments": '{"path":"README.md"}',
        "call_id": "call_123",
        "name": "read_file",
    }
    events = [
        {
            "type": "response.output_item.added",
            "output_index": 2,
            "item": {**tool_item, "status": "in_progress", "arguments": ""},
        },
        {
            "type": "response.function_call_arguments.delta",
            "output_index": 2,
            "item_id": "fc_123",
            "delta": '{"path":',
        },
        {
            "type": "response.function_call_arguments.delta",
            "output_index": 2,
            "item_id": "fc_123",
            "delta": '"README.md"}',
        },
        {"type": "response.output_item.done", "output_index": 2, "item": tool_item},
        {
            "type": "response.completed",
            "response": {
                "status": "completed",
                "output": [tool_item],
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 5,
                    "total_tokens": 15,
                },
            },
        },
    ]
    stream_bytes = "".join(
        f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events
    ).encode()

    class DummyTransport:
        async def stream(self, url, body, headers=None):
            yield stream_bytes

    provider._transport = DummyTransport()

    async def collect_chunks():
        return [
            chunk
            async for chunk in provider.stream(
                model="gpt-5.5",
                messages=[Message(role="user", content="Read the README")],
            )
        ]

    chunks = asyncio.run(collect_chunks())

    assert chunks[0].tool_call_events[0].kind == "start"
    assert chunks[0].tool_call_events[0].index == 0
    assert chunks[0].tool_call_events[0].tool_call_id == "call_123"
    assert chunks[0].tool_call_events[0].name == "read_file"
    assert chunks[1].tool_call_events[0].arguments_delta == '{"path":'
    assert chunks[1].tool_call_events[0].index == 0
    assert chunks[2].tool_call_events[0].arguments_delta == '"README.md"}'
    assert chunks[-1].tool_calls[0].id == "call_123"
    assert chunks[-1].tool_calls[0].arguments == {"path": "README.md"}
