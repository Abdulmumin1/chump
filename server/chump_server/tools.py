from __future__ import annotations

import asyncio
import json

from ai_query import Field, tool

from .config import ChumpConfig
from .safety import SafetyError, WorkspaceGuard, validate_command


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
            await emit(
                "tool_result",
                tool=name,
                name=name,
                ok=True,
                status="ok",
                preview=_preview(result),
                metadata=_result_metadata(result),
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

    @tool(description="Read a UTF-8 text file from the workspace.")
    async def read_file(
        path: str = Field(description="File path relative to workspace root"),
        offset: int = Field(description="Zero-based line offset to start reading from", default=0),
        limit: int = Field(description="Maximum number of lines to read", default=200),
    ) -> str:
        async def runner() -> str:
            file_path = guard.ensure_text_file(path)
            if not file_path.exists():
                raise SafetyError(f"file does not exist: {path}")

            await note_file(path)
            contents = file_path.read_text(encoding="utf-8")
            lines = contents.splitlines()
            start_index = max(offset, 0)
            line_count = max(limit, 1)
            end_index = start_index + line_count
            numbered = [
                f"{index + 1}: {line}"
                for index, line in enumerate(lines[start_index:end_index], start=start_index)
            ]
            return "\n".join(numbered)

        return await wrap_tool(
            "read_file",
            {"path": path, "offset": offset, "limit": limit},
            runner,
        )

    @tool(description="Write a UTF-8 text file inside the workspace.")
    async def write_file(
        path: str = Field(description="File path relative to workspace root"),
        content: str = Field(description="Full file contents to write"),
    ) -> str:
        async def runner() -> str:
            file_path = guard.ensure_text_file(path)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")
            await note_file(path)
            return f"Wrote {path} ({len(content)} bytes)"

        return await wrap_tool("write_file", {"path": path}, runner)

    @tool(description="Replace text in a UTF-8 file inside the workspace.")
    async def replace_in_file(
        path: str = Field(description="File path relative to workspace root"),
        old_text: str = Field(description="Text to replace"),
        new_text: str = Field(description="Replacement text"),
        replace_all: bool = Field(description="Replace all matches when true", default=False),
    ) -> str:
        async def runner() -> str:
            file_path = guard.ensure_text_file(path)
            if not file_path.exists():
                raise SafetyError(f"file does not exist: {path}")

            contents = file_path.read_text(encoding="utf-8")
            if old_text not in contents:
                raise SafetyError("target text not found")

            if replace_all:
                updated = contents.replace(old_text, new_text)
            else:
                updated = contents.replace(old_text, new_text, 1)

            file_path.write_text(updated, encoding="utf-8")
            await note_file(path)
            return f"Updated {path}"

        return await wrap_tool(
            "replace_in_file",
            {"path": path, "replace_all": replace_all},
            runner,
        )

    @tool(description="Run a non-destructive bash command inside the workspace.")
    async def bash(
        command: str = Field(description="Shell command to execute"),
        cwd: str = Field(description="Working directory relative to workspace root", default="."),
    ) -> str:
        async def runner() -> str:
            validate_command(command)
            directory = guard.ensure_directory(cwd)
            if not directory.exists():
                raise SafetyError(f"directory does not exist: {cwd}")

            await note_command(command)
            process = await asyncio.create_subprocess_shell(
                command,
                cwd=str(directory),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=20)
            except asyncio.TimeoutError:
                process.kill()
                raise RuntimeError("command timed out after 20 seconds")

            output = _truncate((stdout + stderr).decode().strip())
            if process.returncode != 0:
                raise RuntimeError(output or f"command failed with exit code {process.returncode}")
            return output or "(command produced no output)"

        return await wrap_tool("bash", {"command": command, "cwd": cwd}, runner)

    return {
        "read_file": read_file,
        "write_file": write_file,
        "replace_in_file": replace_in_file,
        "bash": bash,
    }


def _truncate(value: str, limit: int = 4000) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 20] + "\n...[truncated]"


def _preview(value: str, limit: int = 160) -> str:
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def _result_metadata(value: str, limit: int = 160) -> dict[str, object]:
    compact = " ".join(value.split())
    return {
        "chars": len(value),
        "preview_chars": min(len(compact), limit),
        "truncated": len(compact) > limit,
    }
