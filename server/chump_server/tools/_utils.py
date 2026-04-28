from __future__ import annotations

import asyncio
import difflib
import hashlib
import os
import signal
from pathlib import Path
from typing import Literal

from ..patch_tool import TextStyle

DEFAULT_DIFF_CHANGE_LIMIT = 400
DEFAULT_DIFF_TEXT_BUDGET = 32_000


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
    *,
    kind: Literal["add", "update", "delete", "move"] = "update",
    source_path: str | None = None,
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
        "kind": kind,
        "source_path": source_path,
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


def _default_text_style() -> TextStyle:
    return TextStyle(bom=b"", newline="\n")


async def _terminate_process(process: asyncio.subprocess.Process) -> None:
    try:
        if process.returncode is not None:
            return
        if process.pid and hasattr(os, "killpg"):
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        await asyncio.wait_for(process.wait(), timeout=1)
    except Exception:
        try:
            if process.pid and hasattr(os, "killpg"):
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            await asyncio.wait_for(process.wait(), timeout=1)
        except Exception:
            pass


def _fingerprint(path: Path) -> dict[str, object]:
    contents = path.read_bytes()
    stat = path.stat()
    return {
        "size": stat.st_size,
        "sha256": hashlib.sha256(contents).hexdigest(),
    }
