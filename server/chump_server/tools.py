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
        await emit("tool_call", tool=name, payload=payload)
        try:
            result = await runner()
            await emit("tool_result", tool=name, ok=True, preview=_preview(result))
            log(f"ok {name}: {_preview(result, 240)}")
            return result
        except Exception as exc:
            await emit("tool_result", tool=name, ok=False, preview=str(exc))
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

    @tool(description="Find files or directories by name or path fragment within the workspace.")
    async def find_files(
        query: str = Field(description="Filename or path fragment to locate"),
        path: str = Field(description="Directory path relative to workspace root", default="."),
    ) -> str:
        async def runner() -> str:
            directory = guard.ensure_directory(path)
            if not directory.exists():
                raise SafetyError(f"directory does not exist: {path}")

            needle = query.lower()
            matches: list[str] = []
            for candidate in directory.rglob("*"):
                relative_path = str(candidate.relative_to(config.workspace_root))
                if needle in candidate.name.lower() or needle in relative_path.lower():
                    matches.append(relative_path)
                if len(matches) >= 200:
                    break

            if not matches:
                return "No matching files found."

            return "\n".join(matches)

        return await wrap_tool("find_files", {"query": query, "path": path}, runner)

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

        return await wrap_tool("run_command", {"command": command, "cwd": cwd}, runner)

    return {
        "list_files": list_files,
        "find_files": find_files,
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
