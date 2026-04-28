from __future__ import annotations

from pathlib import Path

from ai_query import Field, tool

from ..safety import WorkspaceGuard, SafetyError
from ..patch_tool import read_text_snapshot, write_text_snapshot
from ._utils import _default_text_style, _diff_metadata


@tool(description="Write a UTF-8 text file inside the workspace.")
async def write_file(
    path: str = Field(description="File path relative to workspace root"),
    content: str = Field(description="Full file contents to write"),
) -> str:
    raise NotImplementedError("write_file must be bound via bind_write_file")


def bind_write_file(
    guard: WorkspaceGuard,
    wrap_tool,
    note_file,
    require_fresh_read,
    remember_file_read,
):
    @tool(description="Write a UTF-8 text file inside the workspace.")
    async def write_file_impl(
        path: str = Field(description="File path relative to workspace root"),
        content: str = Field(description="Full file contents to write"),
    ) -> str:
        async def runner() -> str:
            file_path = guard.ensure_text_file(path)
            require_fresh_read(path, file_path)
            before_snapshot = read_text_snapshot(file_path) if file_path.exists() else None
            before = before_snapshot.text if before_snapshot else ""
            style = before_snapshot.style if before_snapshot else _default_text_style()
            normalized_content = content.replace("\r\n", "\n").replace("\r", "\n")
            write_text_snapshot(file_path, normalized_content, style)
            await note_file(path)
            await remember_file_read(path, file_path)
            return (
                f"Wrote {path} ({len(content)} bytes)",
                {
                    "diff": _diff_metadata(
                        path,
                        before,
                        normalized_content,
                        kind="update" if before_snapshot else "add",
                    )
                },
            )

        return await wrap_tool("write_file", {"path": path}, runner)

    return write_file_impl
