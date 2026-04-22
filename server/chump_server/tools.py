from __future__ import annotations

import asyncio
import json
from pathlib import Path

from ai_query import Field, tool

from .config import ChumpConfig
from .safety import SafetyError, WorkspaceGuard, validate_command


def build_tools(agent, config: ChumpConfig):
    guard = WorkspaceGuard(config.workspace_root)

    async def emit(event: str, **data: object) -> None:
        await agent.emit(event, data)

    async def wrap_tool(name: str, payload: dict[str, object], runner):
        await emit("tool_call", tool=name, payload=payload)
        try:
            result = await runner()
            await emit("tool_result", tool=name, ok=True, preview=_preview(result))
            return result
        except Exception as exc:
            await emit("tool_result", tool=name, ok=False, preview=str(exc))
            raise

    @tool(description="List files and directories within the workspace.")
    async def list_files(
        path: str = Field(description="Directory path relative to workspace root", default="."),
    ) -> str:
        async def runner() -> str:
            directory = guard.ensure_directory(path)
            if not directory.exists():
                raise SafetyError(f"directory does not exist: {path}")

            entries = sorted(directory.iterdir(), key=lambda item: item.name.lower())
            payload = [
                {
                    "name": entry.name,
                    "path": str(entry.relative_to(config.workspace_root)),
                    "kind": "dir" if entry.is_dir() else "file",
                }
                for entry in entries[:200]
            ]
            return json.dumps(payload, indent=2)

        return await wrap_tool("list_files", {"path": path}, runner)

    @tool(description="Search for text within workspace files using ripgrep when available.")
    async def search_files(
        query: str = Field(description="Literal or regex text to search for"),
        path: str = Field(description="Directory path relative to workspace root", default="."),
    ) -> str:
        async def runner() -> str:
            directory = guard.ensure_directory(path)
            if not directory.exists():
                raise SafetyError(f"directory does not exist: {path}")

            process = await asyncio.create_subprocess_exec(
                "rg",
                "--line-number",
                "--with-filename",
                query,
                str(directory),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()
            if process.returncode not in (0, 1):
                raise RuntimeError(stderr.decode().strip() or "ripgrep failed")

            output = stdout.decode().strip()
            if not output:
                return "No matches found."

            return "\n".join(output.splitlines()[:200])

        return await wrap_tool("search_files", {"query": query, "path": path}, runner)

    @tool(description="Read a UTF-8 text file from the workspace.")
    async def read_file(
        path: str = Field(description="File path relative to workspace root"),
        start_line: int = Field(description="First line number to read", default=1),
        end_line: int = Field(description="Last line number to read", default=200),
    ) -> str:
        async def runner() -> str:
            file_path = guard.ensure_text_file(path)
            if not file_path.exists():
                raise SafetyError(f"file does not exist: {path}")

            contents = file_path.read_text(encoding="utf-8")
            lines = contents.splitlines()
            start_index = max(start_line - 1, 0)
            end_index = max(end_line, start_line)
            numbered = [
                f"{index + 1}: {line}"
                for index, line in enumerate(lines[start_index:end_index], start=start_index)
            ]
            return "\n".join(numbered)

        return await wrap_tool(
            "read_file",
            {"path": path, "start_line": start_line, "end_line": end_line},
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
            return f"Updated {path}"

        return await wrap_tool(
            "replace_in_file",
            {"path": path, "replace_all": replace_all},
            runner,
        )

    @tool(description="Run a non-destructive shell command inside the workspace.")
    async def run_command(
        command: str = Field(description="Shell command to execute"),
        cwd: str = Field(description="Working directory relative to workspace root", default="."),
    ) -> str:
        async def runner() -> str:
            validate_command(command)
            directory = guard.ensure_directory(cwd)
            if not directory.exists():
                raise SafetyError(f"directory does not exist: {cwd}")

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

        return await wrap_tool("run_command", {"command": command, "cwd": cwd}, runner)

    return {
        "list_files": list_files,
        "search_files": search_files,
        "read_file": read_file,
        "write_file": write_file,
        "replace_in_file": replace_in_file,
        "run_command": run_command,
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

