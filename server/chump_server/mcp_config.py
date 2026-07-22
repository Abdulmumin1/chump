from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, TypeAlias

DEFAULT_MCP_TIMEOUT_MS = 30_000
_ENV_REFERENCE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\{env:([A-Za-z_][A-Za-z0-9_]*)\}")


@dataclass(frozen=True)
class LocalMCPServerConfig:
    type: Literal["local"]
    command: tuple[str, ...]
    cwd: str | None
    environment: dict[str, str]
    enabled: bool
    timeout_ms: int
    direct_tools: bool | tuple[str, ...]
    exclude_tools: tuple[str, ...]


@dataclass(frozen=True)
class RemoteMCPServerConfig:
    type: Literal["remote"]
    url: str
    headers: dict[str, str]
    transport: Literal["auto", "http", "sse"]
    enabled: bool
    timeout_ms: int
    direct_tools: bool | tuple[str, ...]
    exclude_tools: tuple[str, ...]


MCPServerConfig: TypeAlias = LocalMCPServerConfig | RemoteMCPServerConfig


def load_mcp_server_configs(
    workspace_root: Path,
    repo_config: dict[str, Any],
    global_config: dict[str, Any],
) -> dict[str, MCPServerConfig]:
    layers = [
        _load_standard_file(global_mcp_config_path()),
        _config_entries(global_config, "mcp"),
        _require_project_enable(_load_standard_file(workspace_root / ".mcp.json")),
        _require_project_enable(_config_entries(repo_config, "mcp")),
    ]
    merged: dict[str, object] = {}
    for layer in layers:
        merged.update(layer)
    return {
        name: parse_mcp_server_config(name, value)
        for name, value in merged.items()
    }


def parse_mcp_server_config(name: str, value: object) -> MCPServerConfig:
    if not name.strip():
        raise ValueError("MCP server names cannot be empty")
    if not isinstance(value, dict):
        raise ValueError(f'invalid MCP server "{name}": expected an object')

    server_type = value.get("type")
    has_url = isinstance(value.get("url"), str)
    has_command = isinstance(value.get("command"), (str, list))
    if server_type is None:
        server_type = "remote" if has_url and not has_command else "local"
    if server_type not in {"local", "remote"}:
        raise ValueError(
            f'invalid MCP server "{name}": type must be "local" or "remote"'
        )

    enabled = _enabled(value)
    timeout_ms = _positive_int(value.get("timeout"), DEFAULT_MCP_TIMEOUT_MS, name)
    direct_tools = _direct_tools(value, name)
    exclude_tools = _string_tuple(
        value.get("exclude_tools", value.get("excludeTools", [])),
        f'MCP server "{name}" excludeTools',
    )

    if server_type == "remote":
        url = value.get("url")
        if not isinstance(url, str) or not url.strip():
            raise ValueError(f'invalid MCP server "{name}": remote url is required')
        transport = value.get("transport", "auto")
        if transport in {"streamable-http", "streamable_http", "remote"}:
            transport = "http"
        if transport not in {"auto", "http", "sse"}:
            raise ValueError(
                f'invalid MCP server "{name}": remote transport must be auto, http, or sse'
            )
        return RemoteMCPServerConfig(
            type="remote",
            url=url,
            headers=_string_map(value.get("headers", {}), f'MCP server "{name}" headers'),
            transport=transport,
            enabled=enabled,
            timeout_ms=timeout_ms,
            direct_tools=direct_tools,
            exclude_tools=exclude_tools,
        )

    command = value.get("command")
    if isinstance(command, str):
        args = _string_tuple(value.get("args", []), f'MCP server "{name}" args')
        command_parts = (command, *args)
    elif isinstance(command, list):
        command_parts = _string_tuple(command, f'MCP server "{name}" command')
        if value.get("args") is not None:
            command_parts += _string_tuple(
                value.get("args"), f'MCP server "{name}" args'
            )
    else:
        raise ValueError(f'invalid MCP server "{name}": local command is required')
    if not command_parts or not command_parts[0].strip():
        raise ValueError(f'invalid MCP server "{name}": local command cannot be empty')

    cwd = value.get("cwd")
    if cwd is not None and not isinstance(cwd, str):
        raise ValueError(f'invalid MCP server "{name}": cwd must be a string')
    environment = value.get("environment", value.get("env", {}))
    return LocalMCPServerConfig(
        type="local",
        command=command_parts,
        cwd=cwd,
        environment=_string_map(environment, f'MCP server "{name}" environment'),
        enabled=enabled,
        timeout_ms=timeout_ms,
        direct_tools=direct_tools,
        exclude_tools=exclude_tools,
    )


def expand_mcp_value(value: str) -> str:
    missing: set[str] = set()

    def replace(match: re.Match[str]) -> str:
        name = match.group(1) or match.group(2) or ""
        resolved = os.environ.get(name)
        if resolved is None:
            missing.add(name)
            return match.group(0)
        return resolved

    expanded = _ENV_REFERENCE.sub(replace, value)
    if missing:
        names = ", ".join(sorted(missing))
        raise ValueError(f"missing MCP environment variable(s): {names}")
    if expanded == "~" or expanded.startswith("~/"):
        return str(Path(expanded).expanduser())
    return expanded


def redact_mcp_error(config: MCPServerConfig, error: BaseException) -> str:
    message = str(error)
    values = (
        (*config.command, *config.environment.values())
        if config.type == "local"
        else (config.url, *config.headers.values())
    )
    for value in values:
        for match in _ENV_REFERENCE.finditer(value):
            name = match.group(1) or match.group(2)
            if name and (secret := os.environ.get(name)):
                message = message.replace(secret, "[redacted]")
    return message


def global_mcp_config_path() -> Path:
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base.expanduser() / "mcp" / "mcp.json"


def standard_mcp_config_path(workspace_root: Path, scope: str) -> Path:
    if scope == "project":
        return workspace_root / ".mcp.json"
    if scope == "global":
        return global_mcp_config_path()
    raise ValueError('MCP config scope must be "project" or "global"')


def save_standard_mcp_server(
    workspace_root: Path,
    scope: str,
    name: str,
    server_config: object,
) -> Path:
    parsed = parse_mcp_server_config(name, server_config)
    path = standard_mcp_config_path(workspace_root, scope)
    document = _read_json_object(path)
    entries = document.get("mcpServers", {})
    if not isinstance(entries, dict):
        raise ValueError(f"invalid MCP config at {path}: mcpServers must be an object")
    entries[name] = _standard_config_value(parsed)
    if scope == "project":
        entries[name].pop("disabled", None)
        entries[name]["enabled"] = parsed.enabled
    document["mcpServers"] = entries
    _write_json(path, document)
    return path


def remove_standard_mcp_server(workspace_root: Path, scope: str, name: str) -> Path:
    path = standard_mcp_config_path(workspace_root, scope)
    document = _read_json_object(path)
    entries = document.get("mcpServers", {})
    if not isinstance(entries, dict):
        raise ValueError(f"invalid MCP config at {path}: mcpServers must be an object")
    entries.pop(name, None)
    document["mcpServers"] = entries
    _write_json(path, document)
    return path


def _standard_config_value(config: MCPServerConfig) -> dict[str, object]:
    common: dict[str, object] = {}
    if not config.enabled:
        common["disabled"] = True
    if config.timeout_ms != DEFAULT_MCP_TIMEOUT_MS:
        common["timeout"] = config.timeout_ms
    if config.direct_tools is not False:
        common["directTools"] = (
            list(config.direct_tools)
            if isinstance(config.direct_tools, tuple)
            else config.direct_tools
        )
    if config.exclude_tools:
        common["excludeTools"] = list(config.exclude_tools)

    if config.type == "remote":
        return {
            "url": config.url,
            **({"headers": config.headers} if config.headers else {}),
            **(
                {"transport": config.transport}
                if config.transport != "auto"
                else {}
            ),
            **common,
        }
    return {
        "command": config.command[0],
        **({"args": list(config.command[1:])} if len(config.command) > 1 else {}),
        **({"cwd": config.cwd} if config.cwd else {}),
        **({"env": config.environment} if config.environment else {}),
        **common,
    }


def _load_standard_file(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    document = _read_json_object(path)
    entries = document.get("mcpServers", {})
    if not isinstance(entries, dict):
        raise ValueError(f"invalid MCP config at {path}: mcpServers must be an object")
    return dict(entries)


def _config_entries(config: dict[str, Any], key: str) -> dict[str, object]:
    value = config.get(key, {})
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"invalid Chump config: {key} must be an object")
    return dict(value)


def _require_project_enable(entries: dict[str, object]) -> dict[str, object]:
    result: dict[str, object] = {}
    for name, value in entries.items():
        if not isinstance(value, dict):
            result[name] = value
            continue
        if "enabled" in value or "disabled" in value:
            result[name] = value
            continue
        result[name] = {**value, "enabled": False}
    return result


def _read_json_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid MCP config at {path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"invalid MCP config at {path}: expected an object")
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def _enabled(value: dict[object, object]) -> bool:
    enabled = value.get("enabled")
    disabled = value.get("disabled")
    if enabled is not None and not isinstance(enabled, bool):
        raise ValueError("MCP enabled must be a boolean")
    if disabled is not None and not isinstance(disabled, bool):
        raise ValueError("MCP disabled must be a boolean")
    if isinstance(enabled, bool):
        return enabled
    return not disabled if isinstance(disabled, bool) else True


def _positive_int(value: object, default: int, name: str) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f'invalid MCP server "{name}": timeout must be a positive integer')
    return value


def _direct_tools(value: dict[object, object], name: str) -> bool | tuple[str, ...]:
    raw = value.get("direct_tools", value.get("directTools", False))
    if isinstance(raw, bool):
        return raw
    return _string_tuple(raw, f'MCP server "{name}" directTools')


def _string_tuple(value: object, label: str) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)) or not all(
        isinstance(item, str) and item for item in value
    ):
        raise ValueError(f"{label} must be an array of non-empty strings")
    return tuple(value)


def _string_map(value: object, label: str) -> dict[str, str]:
    if not isinstance(value, dict) or not all(
        isinstance(key, str) and isinstance(item, str) for key, item in value.items()
    ):
        raise ValueError(f"{label} must contain only string values")
    return dict(value)
