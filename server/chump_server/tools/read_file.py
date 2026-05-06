from __future__ import annotations

from pathlib import Path

from ai_query import Field, tool

from ..safety import WorkspaceGuard, SafetyError
from ..patch_tool import read_text_snapshot
from ._utils import _workspace_key, _fingerprint


@tool(description="Read a UTF-8 text file from the workspace.")
async def read_file(
    path: str = Field(description="File path relative to workspace root"),
    offset: int = Field(
        description="Zero-based line offset to start reading from", default=0
    ),
    limit: int = Field(description="Maximum number of lines to read", default=200),
) -> str:
    raise NotImplementedError("read_file must be bound via bind_read_file")


def bind_read_file(
    guard: WorkspaceGuard,
    wrap_tool,
    note_file,
    remember_file_read,
    resolve_read_context,
):
    @tool(description="Read a UTF-8 text file from the workspace.")
    async def read_file_impl(
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
            snapshot = read_text_snapshot(file_path)
            await remember_file_read(path, file_path)
            lines = snapshot.text.splitlines()
            start_index = max(offset, 0)
            line_count = max(limit, 1)
            end_index = start_index + line_count
            numbered = [
                f"{index + 1}: {line}"
                for index, line in enumerate(
                    lines[start_index:end_index], start=start_index
                )
            ]
            content = "\n".join(numbered)
            extra_text, metadata = await resolve_read_context(file_path)
            if extra_text:
                content = f"{content}\n\n{extra_text}" if content else extra_text
            return content, metadata

        return await wrap_tool(
            "read_file",
            {"path": path, "offset": offset, "limit": limit},
            runner,
        )

    return read_file_impl
