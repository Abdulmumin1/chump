from __future__ import annotations

import json
from typing import Literal

from ai_query.types import Tool

from ..config import load_global_config, load_repo_config
from ..mcp_config import (
    load_mcp_server_configs,
    remove_standard_mcp_server,
    save_standard_mcp_server,
)
from ..mcp_runtime import MCPManager

MCP_ACTIONS = [
    "status",
    "list_tools",
    "search_tools",
    "get_tool",
    "call_tool",
    "reconnect",
    "add",
    "remove",
]


def bind_mcp_tools(agent, config, manager: MCPManager | None, wrap_tool):
    async def execute_mcp(
        action: str,
        server: str = "",
        tool_name: str = "",
        query: str = "",
        arguments: dict[str, object] | None = None,
        server_config: dict[str, object] | None = None,
        scope: Literal["project", "global"] = "project",
    ) -> str | object:
        async def runner():
            if manager is None:
                raise RuntimeError("MCP runtime is unavailable")
            await manager.start()
            if action == "status":
                return json.dumps(manager.status(), indent=2, ensure_ascii=False)
            if action == "list_tools":
                return json.dumps(
                    manager.list_tools(server or None), indent=2, ensure_ascii=False
                )
            if action == "search_tools":
                if not query.strip():
                    raise ValueError("query is required for search_tools")
                return json.dumps(
                    manager.search_tools(query, server or None),
                    indent=2,
                    ensure_ascii=False,
                )
            if action == "get_tool":
                if not server or not tool_name:
                    raise ValueError("server and tool_name are required for get_tool")
                return json.dumps(
                    manager.get_tool(server, tool_name), indent=2, ensure_ascii=False
                )
            if action == "call_tool":
                if not server or not tool_name:
                    raise ValueError("server and tool_name are required for call_tool")
                return await manager.call(server, tool_name, arguments or {})
            if action == "reconnect":
                if not server:
                    raise ValueError("server is required for reconnect")
                status = await manager.reconnect(server)
                agent.refresh_mcp_tools()
                return json.dumps(
                    {
                        "status": status.state,
                        "server": server,
                        "tools": status.tool_count,
                        **({"error": status.error} if status.error else {}),
                    },
                    indent=2,
                )
            if action == "add":
                if not server or server_config is None:
                    raise ValueError("server and server_config are required for add")
                path = save_standard_mcp_server(
                    config.workspace_root, scope, server, server_config
                )
                effective = load_mcp_server_configs(
                    config.workspace_root,
                    load_repo_config(config.workspace_root),
                    load_global_config(),
                ).get(server)
                if effective is None:
                    raise RuntimeError(f'MCP server "{server}" was not saved')
                status = await manager.upsert(server, effective)
                agent.refresh_mcp_tools()
                return json.dumps(
                    {
                        "status": status.state,
                        "server": server,
                        "tools": status.tool_count,
                        "path": str(path),
                        **({"error": status.error} if status.error else {}),
                    },
                    indent=2,
                )
            if action == "remove":
                if not server:
                    raise ValueError("server is required for remove")
                path = remove_standard_mcp_server(
                    config.workspace_root, scope, server
                )
                effective = load_mcp_server_configs(
                    config.workspace_root,
                    load_repo_config(config.workspace_root),
                    load_global_config(),
                ).get(server)
                if effective is None:
                    await manager.remove(server)
                    effective_status = "not_configured"
                else:
                    effective_status = (await manager.upsert(server, effective)).state
                agent.refresh_mcp_tools()
                return json.dumps(
                    {
                        "status": "removed_from_scope",
                        "server": server,
                        "path": str(path),
                        "effective_status": effective_status,
                    },
                    indent=2,
                )
            raise ValueError(f"unsupported MCP action: {action}")

        return await wrap_tool(
            "mcp",
            {
                "action": action,
                "server": server,
                "tool_name": tool_name,
                "scope": scope,
            },
            runner,
        )

    mcp = Tool(
        description=(
            "Discover, call, and configure Model Context Protocol (MCP) servers. "
            "Use status first when the user asks about MCP. Use search_tools before "
            "get_tool when the exact server or tool name is unknown, then get_tool to "
            "inspect its input schema before call_tool. reconnect retries a failed "
            "server. add/remove edit the shared .mcp.json format; never place secrets "
            "directly in config—use ${ENV_VAR} or {env:ENV_VAR} references."
        ),
        parameters={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": MCP_ACTIONS,
                    "description": "MCP operation",
                },
                "server": {"type": "string", "description": "Server name"},
                "tool_name": {
                    "type": "string",
                    "description": "MCP tool name for get_tool or call_tool",
                },
                "query": {
                    "type": "string",
                    "description": "Search text for search_tools",
                },
                "arguments": {
                    "type": "object",
                    "description": "Arguments passed to the MCP tool",
                    "additionalProperties": True,
                },
                "server_config": {
                    "type": "object",
                    "description": (
                        "Server config for add. Local: {command, args?, env?, cwd?}. "
                        "Remote: {url, headers?}. Optional directTools exposes selected tools directly."
                    ),
                    "additionalProperties": True,
                },
                "scope": {
                    "type": "string",
                    "enum": ["project", "global"],
                    "description": "Where add/remove writes .mcp.json",
                },
            },
            "required": ["action"],
            "additionalProperties": False,
        },
        execute=execute_mcp,
    )

    direct_tools: dict[str, Tool] = {}
    if manager is not None:
        for name, source in manager.direct_tools().items():
            async def execute(
                _source: Tool = source,
                _name: str = name,
                **arguments: object,
            ):
                return await wrap_tool(
                    _name,
                    {"mcp": True},
                    lambda: _source.run(**arguments),
                )

            direct_tools[name] = Tool(
                description=source.description,
                parameters=source.parameters,
                execute=execute,
            )

    return {"mcp": mcp, **direct_tools}
