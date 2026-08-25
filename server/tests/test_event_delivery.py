import asyncio
from types import SimpleNamespace

import pytest

from chump_server.main import ChumpServer


class BlockingConnection:
    async def send(self, _message: str) -> None:
        await asyncio.sleep(10)


class RecordingConnection:
    def __init__(self) -> None:
        self.messages: list[str] = []

    async def send(self, message: str) -> None:
        self.messages.append(message)


class BlockingSse:
    async def write(self, _message: bytes) -> None:
        await asyncio.sleep(10)


class RecordingSse:
    def __init__(self) -> None:
        self.messages: list[bytes] = []

    async def write(self, message: bytes) -> None:
        self.messages.append(message)


@pytest.mark.asyncio
async def test_event_delivery_drops_blocked_connections(monkeypatch) -> None:
    monkeypatch.setattr("chump_server.main.EVENT_DELIVERY_TIMEOUT_SECONDS", 0.01)
    blocked_ws = BlockingConnection()
    healthy_ws = RecordingConnection()
    blocked_sse = BlockingSse()
    healthy_sse = RecordingSse()
    agent = SimpleNamespace(
        _connections={blocked_ws, healthy_ws},
        _sse_connections={blocked_sse, healthy_sse},
    )

    deliver = ChumpServer._create_emit_handler(object(), agent)

    await deliver("assistant_text", {"content": "hello"}, 42)

    assert blocked_ws not in agent._connections
    assert blocked_sse not in agent._sse_connections
    assert healthy_ws in agent._connections
    assert healthy_sse in agent._sse_connections
    assert healthy_ws.messages == ['{"type": "assistant_text", "id": 42, "content": "hello"}']
    assert healthy_sse.messages == [
        b'id: 42\nevent: assistant_text\ndata: {"content": "hello"}\n\n'
    ]
