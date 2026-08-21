from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from aiohttp import WSMsgType, WSServerHandshakeError, web

from chump_server.terminal import (
    is_allowed_terminal_origin,
    parse_resize_message,
    parse_terminal_theme,
    terminal_websocket,
)


def test_resize_control_message_is_strict() -> None:
    assert parse_resize_message('{"type":"resize","cols":120,"rows":40}') == (
        120,
        40,
    )
    assert parse_resize_message('{"type":"resize","cols":0,"rows":40}') is None
    assert parse_resize_message('{"type":"input","cols":120,"rows":40}') is None
    assert parse_resize_message("not json") is None


def test_terminal_origin_requires_a_trusted_web_client() -> None:
    allowed = ("https://chmp.dev", "http://localhost:5173")
    assert is_allowed_terminal_origin("https://chmp.dev", allowed)
    assert is_allowed_terminal_origin("http://localhost:5173", allowed)
    assert not is_allowed_terminal_origin("http://localhost:9999", allowed)
    assert not is_allowed_terminal_origin("http://127.0.0.1:4173", allowed)
    assert not is_allowed_terminal_origin("https://attacker.example", allowed)
    assert not is_allowed_terminal_origin(None, allowed)


def test_terminal_theme_is_strict() -> None:
    assert parse_terminal_theme(None) is None
    assert parse_terminal_theme("light") == "light"
    assert parse_terminal_theme("dark") == "dark"
    with pytest.raises(web.HTTPBadRequest):
        parse_terminal_theme("system")


@pytest.mark.skipif(os.name != "posix", reason="PTY integration requires POSIX")
@pytest.mark.asyncio
async def test_terminal_websocket_streams_shell_bytes(
    aiohttp_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("SHELL", "/bin/sh")
    app = web.Application()

    async def handler(request: web.Request) -> web.WebSocketResponse:
        return await terminal_websocket(
            request,
            workspace_root=tmp_path,
            allowed_origins=("https://chmp.dev",),
        )

    app.router.add_get("/terminal", handler)
    client = await aiohttp_client(app)
    websocket = await client.ws_connect(
        "/terminal?cols=90&rows=30&theme=light",
        headers={"Origin": "https://chmp.dev"},
        protocols=("chump-terminal-v1",),
    )
    await websocket.send_bytes(
        b"printf 'chump-pty-ready:%s:%s\\n' \"$CHUMP_THEME\" \"$COLORFGBG\"; exit\n"
    )

    output = bytearray()
    exit_code: int | None = None
    while True:
        message = await websocket.receive(timeout=5)
        if message.type is WSMsgType.BINARY:
            output.extend(message.data)
            continue
        if message.type is WSMsgType.TEXT:
            control = json.loads(message.data)
            if control.get("type") == "exit":
                exit_code = control["code"]
                break
        if message.type in {WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR}:
            break

    assert b"chump-pty-ready:light:0;15" in output
    assert exit_code == 0


@pytest.mark.asyncio
async def test_terminal_websocket_rejects_untrusted_origins(
    aiohttp_client,
    tmp_path: Path,
) -> None:
    app = web.Application()

    async def handler(request: web.Request) -> web.WebSocketResponse:
        return await terminal_websocket(
            request,
            workspace_root=tmp_path,
            allowed_origins=("https://chmp.dev",),
        )

    app.router.add_get("/terminal", handler)
    client = await aiohttp_client(app)
    response = await client.get(
        "/terminal",
        headers={"Origin": "https://attacker.example"},
    )

    assert response.status == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("protocols", [(), ("wrong-protocol",)])
async def test_terminal_websocket_requires_its_protocol_before_spawning(
    aiohttp_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    protocols: tuple[str, ...],
) -> None:
    starts = 0

    async def unexpected_start(*args, **kwargs):
        nonlocal starts
        starts += 1
        raise AssertionError("PTY must not start for a rejected protocol")

    monkeypatch.setattr("chump_server.terminal.PtySession.start", unexpected_start)
    app = web.Application()

    async def handler(request: web.Request) -> web.WebSocketResponse:
        return await terminal_websocket(
            request,
            workspace_root=tmp_path,
            allowed_origins=("https://chmp.dev",),
        )

    app.router.add_get("/terminal", handler)
    client = await aiohttp_client(app)

    with pytest.raises(WSServerHandshakeError) as error:
        await client.ws_connect(
            "/terminal",
            headers={"Origin": "https://chmp.dev"},
            protocols=protocols,
        )

    assert error.value.status == 400
    assert starts == 0


@pytest.mark.asyncio
async def test_terminal_unavailable_is_rejected_before_websocket_upgrade(
    aiohttp_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from chump_server.terminal import TerminalUnavailableError

    def unavailable_shell() -> str:
        raise TerminalUnavailableError("No interactive shell was found")

    monkeypatch.setattr("chump_server.terminal.resolve_shell", unavailable_shell)
    app = web.Application()

    async def handler(request: web.Request) -> web.WebSocketResponse:
        return await terminal_websocket(
            request,
            workspace_root=tmp_path,
            allowed_origins=("https://chmp.dev",),
        )

    app.router.add_get("/terminal", handler)
    client = await aiohttp_client(app)

    with pytest.raises(WSServerHandshakeError) as error:
        await client.ws_connect(
            "/terminal",
            headers={"Origin": "https://chmp.dev"},
            protocols=("chump-terminal-v1",),
        )

    assert error.value.status == 501
