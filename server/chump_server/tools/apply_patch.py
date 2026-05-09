from __future__ import annotations

from pathlib import Path

from ai_query import Field, tool

from ..patch_tool import (
    AddFilePatch,
    DeleteFilePatch,
    PatchError,
    UpdateFilePatch,
    apply_update_hunks,
    parse_patch,
    read_text_snapshot,
    write_text_snapshot,
)
from ..safety import WorkspaceGuard, SafetyError
from ._utils import _diff_metadata


@tool(
    description=(
        "Edit files with a small patch. Use sections like `*** Update File: path`, "
        "`*** Add File: path`, or `*** Delete File: path`. For updates, include "
        "`@@` hunks and mark changed lines with `-` or `+`; unchanged context lines "
        "may be prefixed with a space. Read a file before modifying it."
    )
)
async def apply_patch(
    patch_text: str = Field(
        description="The full patch text that describes all changes to make"
    ),
) -> str:
    raise NotImplementedError("apply_patch must be bound via bind_apply_patch")


def bind_apply_patch(
    guard: WorkspaceGuard,
    wrap_tool,
    note_file,
    require_fresh_read,
    remember_file_read,
):
    @tool(
        description=(
            "Edit files with a small patch. Use sections like `*** Update File: path`, "
            "`*** Add File: path`, or `*** Delete File: path`. For updates, include "
            "`@@` hunks and mark changed lines with `-` or `+`; unchanged context lines "
            "may be prefixed with a space. Read a file before modifying it."
        )
    )
    async def apply_patch_impl(
        patch_text: str = Field(
            description="The full patch text that describes all changes to make"
        ),
    ) -> str:
        async def runner() -> str:
            try:
                operations = parse_patch(patch_text)
            except PatchError as exc:
                raise SafetyError(f"apply_patch verification failed: {exc}") from exc

            if not operations:
                raise SafetyError("patch rejected: empty patch")

            prepared: list[dict[str, object]] = []
            file_diffs: list[dict[str, object]] = []

            for operation in operations:
                if isinstance(operation, AddFilePatch):
                    file_path = guard.ensure_text_file(operation.path)
                    if file_path.exists():
                        raise SafetyError(
                            f"apply_patch verification failed: file already exists: {operation.path}"
                        )
                    prepared.append(
                        {
                            "kind": "add",
                            "path": operation.path,
                            "file_path": file_path,
                            "before": "",
                            "after": operation.content,
                            "style": _default_text_style(),
                            "move_to": None,
                        }
                    )
                    file_diffs.append(
                        _diff_metadata(
                            operation.path,
                            "",
                            operation.content,
                            kind="add",
                        )
                    )
                    continue

                if isinstance(operation, DeleteFilePatch):
                    file_path = guard.ensure_text_file(operation.path)
                    if not file_path.exists():
                        raise SafetyError(
                            f"apply_patch verification failed: file does not exist: {operation.path}"
                        )
                    require_fresh_read(operation.path, file_path)
                    snapshot = read_text_snapshot(file_path)
                    prepared.append(
                        {
                            "kind": "delete",
                            "path": operation.path,
                            "file_path": file_path,
                            "before": snapshot.text,
                            "after": "",
                            "style": snapshot.style,
                            "move_to": None,
                        }
                    )
                    file_diffs.append(
                        _diff_metadata(
                            operation.path,
                            snapshot.text,
                            "",
                            kind="delete",
                        )
                    )
                    continue

                if isinstance(operation, UpdateFilePatch):
                    file_path = guard.ensure_text_file(operation.path)
                    if not file_path.exists():
                        raise SafetyError(
                            f"apply_patch verification failed: file does not exist: {operation.path}"
                        )
                    require_fresh_read(operation.path, file_path)
                    snapshot = read_text_snapshot(file_path)
                    try:
                        updated = apply_update_hunks(snapshot.text, operation.hunks)
                    except PatchError as exc:
                        raise SafetyError(
                            f"apply_patch verification failed: {exc}"
                        ) from exc

                    move_target = None
                    if operation.move_to:
                        candidate = guard.ensure_text_file(operation.move_to)
                        if candidate != file_path and candidate.exists():
                            raise SafetyError(
                                "apply_patch verification failed: "
                                f"move target already exists: {operation.move_to}"
                            )
                        if candidate != file_path:
                            move_target = candidate

                    prepared.append(
                        {
                            "kind": "move" if move_target else "update",
                            "path": operation.path,
                            "file_path": file_path,
                            "before": snapshot.text,
                            "after": updated,
                            "style": snapshot.style,
                            "move_to": move_target,
                            "move_to_path": operation.move_to if move_target else None,
                        }
                    )
                    file_diffs.append(
                        _diff_metadata(
                            operation.move_to if move_target else operation.path,
                            snapshot.text,
                            updated,
                            kind="move" if move_target else "update",
                            source_path=operation.path if move_target else None,
                        )
                    )
                    continue

            for item in prepared:
                kind = item["kind"]
                file_path = item["file_path"]
                after = item["after"]
                style = item["style"]
                move_to = item.get("move_to")
                path = item["path"]

                if kind == "delete":
                    assert isinstance(file_path, Path)
                    file_path.unlink()
                    await note_file(path)
                    continue

                target = move_to if isinstance(move_to, Path) else file_path
                assert isinstance(target, Path)
                assert isinstance(after, str)
                write_text_snapshot(target, after, style)
                await note_file(path)

                if move_to and isinstance(move_to, Path):
                    assert isinstance(file_path, Path)
                    file_path.unlink()
                    move_to_path = item.get("move_to_path")
                    if isinstance(move_to_path, str):
                        await note_file(move_to_path)
                        await remember_file_read(move_to_path, move_to)
                else:
                    await remember_file_read(path, target)

            touched_count = len(file_diffs)
            summary = "file" if touched_count == 1 else "files"
            return (
                f"Applied patch to {touched_count} {summary}",
                {"files": file_diffs},
            )

        return await wrap_tool("apply_patch", {}, runner)

    return apply_patch_impl


def _default_text_style():
    from ..patch_tool import TextStyle
    return TextStyle(bom=b"", newline="\n")
