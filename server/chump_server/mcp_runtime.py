from __future__ import annotations

import asyncio
import base64
import json
import re
from contextlib import AsyncExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

import httpx
from ai_query import FilePart, ImagePart, TextPart, ToolOutput
from ai_query.types import Tool

from .mcp_config import (
    LocalMCPServerConfig,
    MCPServerConfig,
    RemoteMCPServerConfig,
    expand_mcp_value,
    redact_mcp_error,
)

if TYPE_CHECKING:
    from mcp import ClientSession

MAX_MCP_LIST_PAGES = 1_000
MAX_MCP_OUTPUT_CHARS = 100_000
MAX_MCP_OUTPUT_LINES = 2_000
MAX_MCP_BINARY_BYTES = 10_000_000


@dataclass(frozen=True)
class MCPToolDefinition:
    server: str
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class MCPServerStatus:
    state: Literal["not_started", "connecting", "connected", "disabled", "failed"]
    tool_count: int = 0
    error: str | None = None


class MCPConnection:
    def __init__(
        self,
        name: str,
        config: MCPServerConfig,
        workspace_root: Path,
    ) -> None:
        self.name = name
        self.config = config
        self.workspace_root = workspace_root
        self.tools: tuple[MCPToolDefinition, ...] = ()
        self._ready: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self._requests: asyncio.Queue[
            tuple[str, dict[str, object], asyncio.Future[ToolOutput | str]] | None
        ] = asyncio.Queue()
        self._task = asyncio.create_task(self._run())

    @classmethod
    async def connect(
        cls,
        name: str,
        config: MCPServerConfig,
        workspace_root: Path,
    ) -> MCPConnection:
        connection = cls(name, config, workspace_root)
        await connection._ready
        return connection

    async def _run(self) -> None:
        try:
            transports: tuple[Literal["local", "http", "sse"], ...]
            if self.config.type == "local":
                transports = ("local",)
            elif self.config.transport == "auto":
                transports = ("http", "sse")
            else:
                transports = (self.config.transport,)

            for index, transport in enumerate(transports):
                try:
                    async with AsyncExitStack() as stack:
                        async with asyncio.timeout(self.config.timeout_ms / 1_000):
                            session = await self._open_session(stack, transport)
                            await session.initialize()
                            self.tools = await _list_tools(self.name, session)
                        self._ready.set_result(None)
                        await self._serve(session)
                        return
                except Exception:
                    if self._ready.done() or index == len(transports) - 1:
                        raise
        except BaseException as error:
            if not self._ready.done():
                self._ready.set_exception(error)
                return
            while not self._requests.empty():
                request = self._requests.get_nowait()
                if request is not None and not request[2].done():
                    request[2].set_exception(error)

    async def _serve(self, session: ClientSession) -> None:
        while True:
            request = await self._requests.get()
            if request is None:
                return
            tool_name, arguments, result = request
            try:
                async with asyncio.timeout(self.config.timeout_ms / 1_000):
                    response = await session.call_tool(tool_name, arguments=arguments)
                output = _tool_output(response)
                if getattr(response, "isError", False):
                    raise RuntimeError(
                        _text_from_output(output) or "MCP tool returned an error"
                    )
                if not result.cancelled():
                    result.set_result(output)
            except Exception as error:
                if not result.cancelled():
                    result.set_exception(error)

    async def _open_session(
        self,
        stack: AsyncExitStack,
        transport: Literal["local", "http", "sse"],
    ) -> ClientSession:
        if transport == "local":
            assert isinstance(self.config, LocalMCPServerConfig)
            return await self._open_local(stack, self.config)
        assert isinstance(self.config, RemoteMCPServerConfig)
        if transport == "sse":
            return await self._open_sse(stack, self.config)
        return await self._open_http(stack, self.config)

    async def _open_local(
        self,
        stack: AsyncExitStack,
        config: LocalMCPServerConfig,
    ) -> ClientSession:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        cwd = (
            Path(expand_mcp_value(config.cwd)).expanduser()
            if config.cwd
            else self.workspace_root
        )
        if not cwd.is_absolute():
            cwd = self.workspace_root / cwd
        environment = {
            key: expand_mcp_value(value) for key, value in config.environment.items()
        }
        command = tuple(expand_mcp_value(part) for part in config.command)
        streams = await stack.enter_async_context(
            stdio_client(
                StdioServerParameters(
                    command=command[0],
                    args=list(command[1:]),
                    env=environment or None,
                    cwd=cwd,
                )
            )
        )
        return await stack.enter_async_context(ClientSession(*streams))

    async def _open_http(
        self,
        stack: AsyncExitStack,
        config: RemoteMCPServerConfig,
    ) -> ClientSession:
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client

        headers = {
            key: expand_mcp_value(value) for key, value in config.headers.items()
        }
        timeout_seconds = config.timeout_ms / 1_000
        http_client = await stack.enter_async_context(
            httpx.AsyncClient(
                headers=headers,
                follow_redirects=True,
                timeout=httpx.Timeout(timeout_seconds, read=300),
            )
        )
        streams = await stack.enter_async_context(
            streamable_http_client(
                expand_mcp_value(config.url),
                http_client=http_client,
            )
        )
        return await stack.enter_async_context(ClientSession(streams[0], streams[1]))

    async def _open_sse(
        self,
        stack: AsyncExitStack,
        config: RemoteMCPServerConfig,
    ) -> ClientSession:
        from mcp import ClientSession
        from mcp.client.sse import sse_client

        streams = await stack.enter_async_context(
            sse_client(
                expand_mcp_value(config.url),
                headers={
                    key: expand_mcp_value(value)
                    for key, value in config.headers.items()
                },
                timeout=config.timeout_ms / 1_000,
                sse_read_timeout=300,
            )
        )
        return await stack.enter_async_context(ClientSession(*streams))

    async def call(self, tool_name: str, arguments: dict[str, object]) -> ToolOutput | str:
        if self._task.done():
            raise RuntimeError(f'MCP server "{self.name}" connection is closed')
        result: asyncio.Future[ToolOutput | str] = (
            asyncio.get_running_loop().create_future()
        )
        await self._requests.put((tool_name, arguments, result))
        return await result

    async def close(self) -> None:
        if self._task.done():
            await self._task
            return
        await self._requests.put(None)
        await self._task


class MCPManager:
    def __init__(
        self,
        workspace_root: Path,
        configs: dict[str, MCPServerConfig],
    ) -> None:
        self.workspace_root = workspace_root
        self._configs = dict(configs)
        self._connections: dict[str, MCPConnection] = {}
        self._statuses = {
            name: MCPServerStatus("not_started") if config.enabled else MCPServerStatus("disabled")
            for name, config in configs.items()
        }
        self._start_task: asyncio.Task[None] | None = None
        self._change_lock = asyncio.Lock()

    async def start(self) -> None:
        async with self._change_lock:
            if self._start_task is None:
                self._start_task = asyncio.create_task(self._start_all())
            task = self._start_task
        await task

    async def _start_all(self) -> None:
        enabled = [(name, config) for name, config in self._configs.items() if config.enabled]
        for name, _ in enabled:
            self._statuses[name] = MCPServerStatus("connecting")
        results = await asyncio.gather(
            *(self._connect(name, config) for name, config in enabled),
            return_exceptions=True,
        )
        for (name, _), result in zip(enabled, results, strict=True):
            if isinstance(result, BaseException):
                self._statuses[name] = MCPServerStatus(
                    "failed", error=redact_mcp_error(self._configs[name], result)
                )
                continue
            self._connections[name] = result
            self._statuses[name] = MCPServerStatus(
                "connected", tool_count=len(result.tools)
            )

    async def _connect(
        self, name: str, config: MCPServerConfig
    ) -> MCPConnection:
        return await MCPConnection.connect(name, config, self.workspace_root)

    async def upsert(self, name: str, config: MCPServerConfig) -> MCPServerStatus:
        await self.start()
        replacement: MCPConnection | None = None
        status = MCPServerStatus("disabled")
        if config.enabled:
            self._statuses[name] = MCPServerStatus("connecting")
            try:
                replacement = await self._connect(name, config)
                status = MCPServerStatus("connected", tool_count=len(replacement.tools))
            except Exception as error:
                status = MCPServerStatus(
                    "failed", error=redact_mcp_error(config, error)
                )
        async with self._change_lock:
            previous = self._connections.pop(name, None)
            self._configs[name] = config
            if replacement:
                self._connections[name] = replacement
            self._statuses[name] = status
        if previous:
            await previous.close()
        return status

    async def reconnect(self, name: str) -> MCPServerStatus:
        await self.start()
        config = self._configs.get(name)
        if config is None:
            raise ValueError(f'MCP server "{name}" is not configured')
        if not config.enabled:
            raise ValueError(f'MCP server "{name}" is disabled')
        async with self._change_lock:
            connection = self._connections.pop(name, None)
            self._statuses[name] = MCPServerStatus("connecting")
        if connection:
            await connection.close()
        return await self.upsert(name, config)

    async def remove(self, name: str) -> None:
        await self.start()
        async with self._change_lock:
            connection = self._connections.pop(name, None)
            self._configs.pop(name, None)
            self._statuses.pop(name, None)
        if connection:
            await connection.close()

    def status(self) -> list[dict[str, object]]:
        return [
            {
                "name": name,
                "type": config.type,
                "status": self._statuses.get(name, MCPServerStatus("not_started")).state,
                "tools": self._statuses.get(name, MCPServerStatus("not_started")).tool_count,
                **(
                    {"error": self._statuses[name].error}
                    if self._statuses.get(name) and self._statuses[name].error
                    else {}
                ),
            }
            for name, config in sorted(self._configs.items())
        ]

    def list_tools(self, server: str | None = None) -> list[dict[str, object]]:
        return [
            {
                "server": definition.server,
                "name": definition.name,
                "description": definition.description,
                "direct_name": _direct_tool_name(definition.server, definition.name),
            }
            for name, connection in sorted(self._connections.items())
            if server is None or name == server
            for definition in connection.tools
        ]

    def search_tools(self, query: str, server: str | None = None) -> list[dict[str, object]]:
        terms = query.lower().split()
        return [
            item
            for item in self.list_tools(server)
            if all(
                term in f"{item['server']} {item['name']} {item['description']}".lower()
                for term in terms
            )
        ][:50]

    def get_tool(self, server: str, tool_name: str) -> dict[str, object]:
        connection = self._connections.get(server)
        if connection is None:
            raise ValueError(f'MCP server "{server}" is not connected')
        for definition in connection.tools:
            if definition.name == tool_name:
                return {
                    "server": definition.server,
                    "name": definition.name,
                    "description": definition.description,
                    "input_schema": definition.input_schema,
                    "direct_name": _direct_tool_name(
                        definition.server, definition.name
                    ),
                }
        raise ValueError(f'MCP server "{server}" has no tool named "{tool_name}"')

    async def call(
        self,
        server: str,
        tool_name: str,
        arguments: dict[str, object],
    ) -> ToolOutput | str:
        await self.start()
        connection = self._connections.get(server)
        if not connection:
            status = self._statuses.get(server)
            detail = f": {status.error}" if status and status.error else ""
            raise ValueError(f'MCP server "{server}" is not connected{detail}')
        self.get_tool(server, tool_name)
        try:
            return await connection.call(tool_name, arguments)
        except Exception as error:
            raise RuntimeError(redact_mcp_error(self._configs[server], error)) from None

    def direct_tools(self) -> dict[str, Tool]:
        tools: dict[str, Tool] = {}
        for server, connection in self._connections.items():
            config = self._configs[server]
            for definition in connection.tools:
                if not _is_direct(config, definition.name):
                    continue
                name = _direct_tool_name(server, definition.name)
                if name in tools:
                    raise ValueError(f'duplicate MCP tool name "{name}"')

                async def execute(
                    _server: str = server,
                    _tool: str = definition.name,
                    **arguments: object,
                ) -> ToolOutput | str:
                    return await self.call(_server, _tool, arguments)

                tools[name] = Tool(
                    description=definition.description,
                    parameters=_normalize_input_schema(definition.input_schema),
                    execute=execute,
                )
        return tools

    async def close(self) -> None:
        if self._start_task:
            await self._start_task
        async with self._change_lock:
            connections = list(self._connections.values())
            self._connections.clear()
        await asyncio.gather(
            *(connection.close() for connection in connections),
            return_exceptions=True,
        )


async def _list_tools(
    server: str,
    session: ClientSession,
) -> tuple[MCPToolDefinition, ...]:
    definitions: list[MCPToolDefinition] = []
    cursor: str | None = None
    seen: set[str] = set()
    for _ in range(MAX_MCP_LIST_PAGES):
        response = await session.list_tools(cursor=cursor)
        for item in response.tools:
            definitions.append(
                MCPToolDefinition(
                    server=server,
                    name=item.name,
                    description=item.description or f"Run {item.name} on MCP server {server}.",
                    input_schema=dict(item.inputSchema or {}),
                )
            )
        next_cursor = getattr(response, "nextCursor", None)
        if next_cursor is None:
            return tuple(definitions)
        if next_cursor in seen:
            raise RuntimeError(f'MCP server "{server}" returned a duplicate tools cursor')
        seen.add(next_cursor)
        cursor = next_cursor
    raise RuntimeError(f'MCP server "{server}" returned too many tools pages')


def _normalize_input_schema(value: dict[str, Any]) -> dict[str, Any]:
    return {
        **value,
        "type": "object",
        "properties": value.get("properties", {}),
    }


def _is_direct(config: MCPServerConfig, tool_name: str) -> bool:
    if tool_name in config.exclude_tools:
        return False
    if config.direct_tools is True:
        return True
    if config.direct_tools is False:
        return False
    return tool_name in config.direct_tools


def _direct_tool_name(server: str, tool_name: str) -> str:
    return f"mcp_{_sanitize_tool_name(server)}_{_sanitize_tool_name(tool_name)}"


def _sanitize_tool_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", value)


def _tool_output(result: object) -> ToolOutput | str:
    parts: list[TextPart | ImagePart | FilePart] = []
    structured = getattr(result, "structuredContent", None)
    for block in getattr(result, "content", []):
        block_type = getattr(block, "type", None)
        if block_type == "text":
            parts.append(TextPart(text=_guard_output(str(block.text))))
            continue
        if block_type == "image":
            image = _decode_binary(block.data, "image")
            parts.append(
                ImagePart(
                    image=image,
                    media_type=getattr(block, "mimeType", None),
                )
            )
            continue
        if block_type == "resource":
            resource = getattr(block, "resource", None)
            text = getattr(resource, "text", None)
            if isinstance(text, str):
                parts.append(TextPart(text=_guard_output(text)))
                continue
            blob = getattr(resource, "blob", None)
            if isinstance(blob, str):
                parts.append(
                    FilePart(
                        data=_decode_binary(blob, "resource"),
                        media_type=getattr(resource, "mimeType", "application/octet-stream"),
                    )
                )
    if not parts and structured is not None:
        parts.append(
            TextPart(text=_guard_output(json.dumps(structured, ensure_ascii=False)))
        )
    if not parts:
        return _guard_output(str(result))
    return ToolOutput(content=parts)


def _guard_output(value: str) -> str:
    lines = value.splitlines(keepends=True)
    clipped = "".join(lines[:MAX_MCP_OUTPUT_LINES])[:MAX_MCP_OUTPUT_CHARS]
    if clipped == value:
        return value
    return clipped + "\n[MCP output truncated by Chump]"


def _decode_binary(value: str, label: str) -> bytes:
    estimated_size = len(value) * 3 // 4
    if estimated_size > MAX_MCP_BINARY_BYTES:
        raise ValueError(
            f"MCP {label} output exceeds Chump's {MAX_MCP_BINARY_BYTES}-byte limit"
        )
    try:
        return base64.b64decode(value, validate=True)
    except ValueError as error:
        raise ValueError(f"MCP {label} output is not valid base64") from error


def _text_from_output(value: ToolOutput | str) -> str:
    if isinstance(value, str):
        return value
    return "\n".join(
        part.text for part in value.content if isinstance(part, TextPart)
    )
