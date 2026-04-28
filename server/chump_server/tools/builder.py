from __future__ import annotations

import json

from ..config import ChumpConfig
from ..safety import SafetyError, WorkspaceGuard
from ._utils import (
    _fingerprint,
    _preview,
    _result_metadata,
    _workspace_key,
)
from .read_file import bind_read_file
from .write_file import bind_write_file
from .apply_patch import bind_apply_patch
from .bash import bind_bash
from .web_fetch import bind_web_fetch
from .website import bind_website


def build_tools(agent, config: ChumpConfig):
    guard = WorkspaceGuard(config.workspace_root)

    def log(message: str) -> None:
        if config.verbose:
            print(f"[chump:{agent.id}:tool] {message}", flush=True)

    async def emit(event: str, **data: object) -> None:
        await agent.emit(event, data)

    async def wrap_tool(name: str, payload: dict[str, object], runner):
        log(f"start {name} {json.dumps(payload, ensure_ascii=True)}")
        await emit("tool_call", tool=name, name=name, payload=payload, args=payload)
        try:
            result = await runner()
            if isinstance(result, tuple):
                result, extra_metadata = result
                metadata = {**_result_metadata(result), **extra_metadata}
            else:
                metadata = _result_metadata(result)
            await emit(
                "tool_result",
                tool=name,
                name=name,
                ok=True,
                status="ok",
                preview=_preview(result),
                metadata=metadata,
            )
            log(f"ok {name}: {_preview(result, 240)}")
            return result
        except Exception as exc:
            await emit(
                "tool_result",
                tool=name,
                name=name,
                ok=False,
                status="error",
                error=str(exc),
                preview=str(exc),
                metadata={"chars": len(str(exc)), "truncated": False},
            )
            log(f"error {name}: {exc}")
            raise

    async def note_file(path: str) -> None:
        files_touched = list(agent.state.get("files_touched", []))
        if path not in files_touched:
            files_touched.append(path)
            await agent.update_state(files_touched=files_touched)

    async def note_command(command: str) -> None:
        commands_run = list(agent.state.get("commands_run", []))
        commands_run.append(command)
        await agent.update_state(commands_run=commands_run[-20:])

    async def remember_file_read(raw_path: str, file_path) -> None:
        read_files = dict(agent.state.get("read_files", {}))
        read_files[_workspace_key(file_path)] = _fingerprint(file_path)
        await agent.update_state(read_files=read_files)

    def require_fresh_read(raw_path: str, file_path) -> None:
        if not file_path.exists():
            return

        read_files = agent.state.get("read_files", {})
        if not isinstance(read_files, dict):
            read_files = {}

        key = _workspace_key(file_path)
        recorded = read_files.get(key)
        if not recorded:
            raise SafetyError(
                f"must read_file {raw_path} before modifying it; "
                "read the file, then retry the write"
            )

        current = _fingerprint(file_path)
        if recorded != current:
            raise SafetyError(
                f"{raw_path} changed since it was last read; "
                "read_file it again before writing"
            )

    read_file = bind_read_file(
        guard=guard,
        wrap_tool=wrap_tool,
        note_file=note_file,
        remember_file_read=remember_file_read,
    )

    write_file = bind_write_file(
        guard=guard,
        wrap_tool=wrap_tool,
        note_file=note_file,
        require_fresh_read=require_fresh_read,
        remember_file_read=remember_file_read,
    )

    apply_patch = bind_apply_patch(
        guard=guard,
        wrap_tool=wrap_tool,
        note_file=note_file,
        require_fresh_read=require_fresh_read,
        remember_file_read=remember_file_read,
    )

    bash = bind_bash(
        guard=guard,
        config=config,
        wrap_tool=wrap_tool,
        note_command=note_command,
        agent=agent,
    )

    web_fetch = bind_web_fetch(
        wrap_tool=wrap_tool,
    )

    website = bind_website(
        wrap_tool=wrap_tool,
    )

    return {
        "read_file": read_file,
        "write_file": write_file,
        "apply_patch": apply_patch,
        "web_fetch": web_fetch,
        "website": website,
        "bash": bash,
    }
