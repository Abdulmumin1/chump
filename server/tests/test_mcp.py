from __future__ import annotations

import asyncio
import socket
import sys
from pathlib import Path

import pytest

from ai_query import TextPart, ToolOutput

from chump_server.mcp_config import (
    LocalMCPServerConfig,
    load_mcp_server_configs,
    parse_mcp_server_config,
    redact_mcp_error,
    remove_standard_mcp_server,
    save_standard_mcp_server,
)
from chump_server.mcp_runtime import MCPManager


MCP_SERVER = """
from mcp.server.fastmcp import FastMCP

server = FastMCP("chump-test")

@server.tool()
def echo(message: str) -> str:
    \"\"\"Echo a message from the test server.\"\"\"
    return f"echo:{message}"

if __name__ == "__main__":
    server.run()
"""

REMOTE_MCP_SERVER = """
import sys
from mcp.server.fastmcp import FastMCP

server = FastMCP("chump-remote-test", host="127.0.0.1", port=int(sys.argv[2]))

@server.tool()
def echo(message: str) -> str:
    return f"echo:{message}"

server.run(transport=sys.argv[1])
"""


def test_load_mcp_configs_layers_shared_and_chump_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    config_home = tmp_path / "config"
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config_home))
    global_shared = config_home / "mcp" / "mcp.json"
    global_shared.parent.mkdir(parents=True)
    global_shared.write_text(
        '{"mcpServers":{"global":{"command":"global-command"},"override":{"command":"old"}}}',
        encoding="utf-8",
    )
    (workspace / ".mcp.json").write_text(
        '{"mcpServers":{"override":{"command":"project-command","directTools":["echo"]}}}',
        encoding="utf-8",
    )

    configs = load_mcp_server_configs(
        workspace,
        {},
        {"mcp": {"remote": {"type": "remote", "url": "https://example.com/mcp"}}},
    )

    assert set(configs) == {"global", "override", "remote"}
    override = configs["override"]
    assert isinstance(override, LocalMCPServerConfig)
    assert override.command == ("project-command",)
    assert override.direct_tools == ("echo",)
    assert override.enabled is False


def test_parse_mcp_config_rejects_ambiguous_or_invalid_values() -> None:
    with pytest.raises(ValueError, match="command is required"):
        parse_mcp_server_config("broken", {})
    with pytest.raises(ValueError, match="positive integer"):
        parse_mcp_server_config("broken", {"command": "node", "timeout": 0})
    with pytest.raises(ValueError, match="string values"):
        parse_mcp_server_config("broken", {"command": "node", "env": {"PORT": 3}})


def test_mcp_errors_redact_referenced_environment_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MCP_TEST_TOKEN", "super-secret-token")
    config = parse_mcp_server_config(
        "remote",
        {
            "url": "https://example.com/mcp",
            "headers": {"Authorization": "Bearer ${MCP_TEST_TOKEN}"},
        },
    )

    message = redact_mcp_error(config, RuntimeError("Bearer super-secret-token failed"))

    assert message == "Bearer [redacted] failed"


def test_standard_mcp_store_preserves_environment_references(tmp_path: Path) -> None:
    path = save_standard_mcp_server(
        tmp_path,
        "project",
        "github",
        {
            "url": "https://example.com/mcp",
            "headers": {"Authorization": "Bearer ${GITHUB_TOKEN}"},
            "directTools": ["search"],
        },
    )

    text = path.read_text(encoding="utf-8")
    assert "${GITHUB_TOKEN}" in text
    assert '"directTools": [' in text
    assert '"enabled": true' in text

    remove_standard_mcp_server(tmp_path, "project", "github")
    assert '"github"' not in path.read_text(encoding="utf-8")


def test_removing_project_override_reveals_global_server(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    save_standard_mcp_server(workspace, "global", "shared", {"command": "global"})
    save_standard_mcp_server(workspace, "project", "shared", {"command": "project"})

    project = load_mcp_server_configs(workspace, {}, {})["shared"]
    assert isinstance(project, LocalMCPServerConfig)
    assert project.command == ("project",)
    assert project.enabled is True

    remove_standard_mcp_server(workspace, "project", "shared")
    fallback = load_mcp_server_configs(workspace, {}, {})["shared"]
    assert isinstance(fallback, LocalMCPServerConfig)
    assert fallback.command == ("global",)


@pytest.mark.asyncio
async def test_manager_discovers_calls_and_closes_stdio_server(tmp_path: Path) -> None:
    script = tmp_path / "mcp_server.py"
    script.write_text(MCP_SERVER, encoding="utf-8")
    config = parse_mcp_server_config(
        "fixture",
        {
            "command": sys.executable,
            "args": [str(script)],
            "directTools": ["echo"],
            "timeout": 10_000,
        },
    )
    manager = MCPManager(tmp_path, {"fixture": config})

    await manager.start()
    assert manager.status() == [
        {"name": "fixture", "type": "local", "status": "connected", "tools": 1}
    ]
    assert manager.search_tools("echo")[0]["name"] == "echo"
    assert manager.get_tool("fixture", "echo")["input_schema"] == {
        "properties": {"message": {"title": "Message", "type": "string"}},
        "required": ["message"],
        "title": "echoArguments",
        "type": "object",
    }

    output = await manager.call("fixture", "echo", {"message": "hello"})
    assert isinstance(output, ToolOutput)
    assert any(
        isinstance(part, TextPart) and "echo:hello" in part.text
        for part in output.content
    )

    direct = manager.direct_tools()
    assert set(direct) == {"mcp_fixture_echo"}
    direct_output = await direct["mcp_fixture_echo"].run(message="direct")
    assert isinstance(direct_output, ToolOutput)

    reconnected = await manager.reconnect("fixture")
    assert reconnected.state == "connected"
    reconnect_output = await manager.call("fixture", "echo", {"message": "again"})
    assert isinstance(reconnect_output, ToolOutput)

    await manager.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("server_transport", "path", "client_transport"),
    [
        ("streamable-http", "/mcp", "http"),
        ("sse", "/sse", "auto"),
    ],
)
async def test_manager_connects_to_remote_transports(
    tmp_path: Path,
    server_transport: str,
    path: str,
    client_transport: str,
) -> None:
    script = tmp_path / "remote_mcp_server.py"
    script.write_text(REMOTE_MCP_SERVER, encoding="utf-8")
    port = _unused_tcp_port()
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        str(script),
        server_transport,
        str(port),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    manager: MCPManager | None = None
    try:
        await _wait_for_port(process, port)
        config = parse_mcp_server_config(
            "remote",
            {
                "url": f"http://127.0.0.1:{port}{path}",
                "headers": {"X-Chump-Test": "remote"},
                "transport": client_transport,
                "timeout": 5_000,
            },
        )
        manager = MCPManager(tmp_path, {"remote": config})

        await manager.start()
        assert manager.status() == [
            {"name": "remote", "type": "remote", "status": "connected", "tools": 1}
        ]
        output = await manager.call("remote", "echo", {"message": "hello"})
        assert isinstance(output, ToolOutput)
        assert any(
            isinstance(part, TextPart) and "echo:hello" in part.text
            for part in output.content
        )
    finally:
        if manager is not None:
            await manager.close()
        if process.returncode is None:
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=3)
        except TimeoutError:
            process.kill()
            await process.wait()


def _unused_tcp_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


async def _wait_for_port(process: asyncio.subprocess.Process, port: int) -> None:
    for _ in range(100):
        if process.returncode is not None:
            stderr = await process.stderr.read() if process.stderr else b""
            raise RuntimeError(f"remote MCP fixture exited: {stderr.decode()}")
        try:
            _, writer = await asyncio.open_connection("127.0.0.1", port)
        except OSError:
            await asyncio.sleep(0.03)
            continue
        writer.close()
        await writer.wait_closed()
        return
    raise TimeoutError("remote MCP fixture did not start")
