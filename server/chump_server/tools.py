from __future__ import annotations

import asyncio
import difflib
import hashlib
import json
from pathlib import Path
from typing import Literal

from ai_query import Field, tool

from .config import ChumpConfig
from .safety import SafetyError, WorkspaceGuard, validate_command


DEFAULT_DIFF_CHANGE_LIMIT = 400
DEFAULT_DIFF_TEXT_BUDGET = 32_000


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

    async def remember_file_read(raw_path: str, file_path: Path) -> None:
        read_files = dict(agent.state.get("read_files", {}))
        read_files[_workspace_key(file_path)] = _fingerprint(file_path)
        await agent.update_state(read_files=read_files)

    def require_fresh_read(raw_path: str, file_path: Path) -> None:
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

    @tool(description="Read a UTF-8 text file from the workspace.")
    async def read_file(
        path: str = Field(description="File path relative to workspace root"),
        offset: int = Field(
            description="Zero-based line offset to start reading from", default=0
        ),
        limit: int = Field(description="Maximum number of lines to read", default=200),
    ) -> str:
        async def runner() -> str:
            file_path = guard.ensure_text_file(path)
            if not file_path.exists():
                raise SafetyError(f"file does not exist: {path}")

            await note_file(path)
            contents = file_path.read_text(encoding="utf-8")
            await remember_file_read(path, file_path)
            lines = contents.splitlines()
            start_index = max(offset, 0)
            line_count = max(limit, 1)
            end_index = start_index + line_count
            numbered = [
                f"{index + 1}: {line}"
                for index, line in enumerate(
                    lines[start_index:end_index], start=start_index
                )
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
            require_fresh_read(path, file_path)
            before = file_path.read_text(encoding="utf-8") if file_path.exists() else ""
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")
            await note_file(path)
            return (
                f"Wrote {path} ({len(content)} bytes)",
                {"diff": _diff_metadata(path, before, content)},
            )

        return await wrap_tool("write_file", {"path": path}, runner)

    @tool(description="Replace text in a UTF-8 file inside the workspace.")
    async def replace_in_file(
        path: str = Field(description="File path relative to workspace root"),
        old_text: str = Field(description="Text to replace"),
        new_text: str = Field(description="Replacement text"),
        replace_all: bool = Field(
            description="Replace all matches when true", default=False
        ),
    ) -> str:
        async def runner() -> str:
            file_path = guard.ensure_text_file(path)
            if not file_path.exists():
                raise SafetyError(f"file does not exist: {path}")
            require_fresh_read(path, file_path)

            contents = file_path.read_text(encoding="utf-8")
            if old_text not in contents:
                raise SafetyError("target text not found")

            if replace_all:
                updated = contents.replace(old_text, new_text)
            else:
                updated = contents.replace(old_text, new_text, 1)

            file_path.write_text(updated, encoding="utf-8")
            await note_file(path)
            return (
                f"Updated {path}",
                {"diff": _diff_metadata(path, contents, updated)},
            )

        return await wrap_tool(
            "replace_in_file",
            {"path": path, "replace_all": replace_all},
            runner,
        )

    @tool(description="Run a shell command inside the workspace.")
    async def bash(
        command: str = Field(description="Shell command to execute"),
        cwd: str = Field(
            description="Working directory relative to workspace root", default="."
        ),
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
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=config.command_timeout,
                )
            except asyncio.TimeoutError:
                process.kill()
                raise RuntimeError(
                    f"command timed out after {config.command_timeout} seconds"
                )

            output = _truncate((stdout + stderr).decode().strip())
            if process.returncode != 0:
                raise RuntimeError(
                    output or f"command failed with exit code {process.returncode}"
                )
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


def _diff_metadata(
    path: str,
    before: str,
    after: str,
    limit: int = DEFAULT_DIFF_CHANGE_LIMIT,
    text_budget: int = DEFAULT_DIFF_TEXT_BUDGET,
) -> dict[str, object]:
    before_lines = before.splitlines()
    after_lines = after.splitlines()
    changes = _diff_changes(before_lines, after_lines)
    added = sum(1 for change in changes if change["type"] == "add")
    removed = sum(1 for change in changes if change["type"] == "remove")

    visible_changes: list[dict[str, int | str | None]] = []
    visible_text = 0
    for change in changes:
        text = change["text"]
        text_size = len(text) if isinstance(text, str) else len(str(text))
        over_limit = len(visible_changes) >= limit
        over_budget = bool(visible_changes) and visible_text + text_size > text_budget
        if over_limit or over_budget:
            break
        visible_changes.append(change)
        visible_text += text_size

    truncated = len(visible_changes) < len(changes)
    return {
        "path": path,
        "added": added,
        "removed": removed,
        "changes": visible_changes,
        "truncated": truncated,
        "shown_changes": len(visible_changes),
        "total_changes": len(changes),
    }


def _diff_changes(
    before_lines: list[str],
    after_lines: list[str],
) -> list[dict[str, int | str | None]]:
    changes: list[dict[str, int | str | None]] = []
    matcher = difflib.SequenceMatcher(a=before_lines, b=after_lines)
    for tag, old_start, old_end, new_start, new_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag in ("replace", "delete"):
            changes.extend(
                _line_change("remove", index + 1, None, before_lines[index])
                for index in range(old_start, old_end)
            )
        if tag in ("replace", "insert"):
            changes.extend(
                _line_change("add", None, index + 1, after_lines[index])
                for index in range(new_start, new_end)
            )
    return changes


def _line_change(
    kind: Literal["add", "remove"],
    old_line: int | None,
    new_line: int | None,
    text: str,
) -> dict[str, int | str | None]:
    return {
        "type": kind,
        "old_line": old_line,
        "new_line": new_line,
        "text": text,
    }


def _workspace_key(path: Path) -> str:
    return str(path)


def _fingerprint(path: Path) -> dict[str, object]:
    contents = path.read_bytes()
    stat = path.stat()
    return {
        "size": stat.st_size,
        "sha256": hashlib.sha256(contents).hexdigest(),
    }
