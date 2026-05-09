from __future__ import annotations

import codecs
from dataclasses import dataclass
from pathlib import Path


class PatchError(ValueError):
    pass


@dataclass(frozen=True)
class TextStyle:
    bom: bytes
    newline: str


@dataclass(frozen=True)
class TextSnapshot:
    text: str
    style: TextStyle


@dataclass(frozen=True)
class AddFilePatch:
    path: str
    content: str


@dataclass(frozen=True)
class DeleteFilePatch:
    path: str


@dataclass(frozen=True)
class UpdateHunk:
    old_lines: list[str]
    new_lines: list[str]
    eof: bool = False


@dataclass(frozen=True)
class UpdateFilePatch:
    path: str
    move_to: str | None
    hunks: list[UpdateHunk]


PatchOperation = AddFilePatch | DeleteFilePatch | UpdateFilePatch


def parse_patch(patch_text: str) -> list[PatchOperation]:
    lines = _normalize_patch_text(patch_text).split("\n")
    if not lines or lines[0] != "*** Begin Patch":
        raise PatchError("patch must start with '*** Begin Patch'")

    operations: list[PatchOperation] = []
    seen_paths: set[str] = set()
    index = 1

    while index < len(lines):
        line = lines[index]
        if line == "*** End Patch":
            trailing = [item for item in lines[index + 1 :] if item]
            if trailing:
                raise PatchError("patch has unexpected content after '*** End Patch'")
            return operations

        path = _directive_path(line, "Add File")
        if path is not None:
            _validate_path(path)
            _ensure_unique_path(seen_paths, path)
            index += 1
            content_lines: list[str] = []
            while index < len(lines) and not lines[index].startswith("*** "):
                entry = lines[index]
                if entry == "":
                    content_lines.append("")
                    index += 1
                    continue
                if not entry.startswith("+"):
                    raise PatchError(
                        f"add file '{path}' contains a non-add line: {entry!r}"
                    )
                content_lines.append(entry[1:])
                index += 1
            content = "\n".join(content_lines)
            if content and not content.endswith("\n"):
                content += "\n"
            operations.append(AddFilePatch(path=path, content=content))
            continue

        path = _directive_path(line, "Delete File")
        if path is not None:
            _validate_path(path)
            _ensure_unique_path(seen_paths, path)
            operations.append(DeleteFilePatch(path=path))
            index += 1
            continue

        path = _directive_path(line, "Update File")
        if path is not None:
            _validate_path(path)
            _ensure_unique_path(seen_paths, path)
            index += 1
            move_to: str | None = None
            if index < len(lines):
                move_to = _directive_path(lines[index], "Move to")
            if move_to is not None:
                _validate_path(move_to)
                _ensure_unique_path(seen_paths, move_to)
                index += 1

            hunks: list[UpdateHunk] = []
            while index < len(lines) and not lines[index].startswith("*** "):
                header = lines[index]
                if not header.startswith("@@"):
                    raise PatchError(
                        f"update file '{path}' has an invalid hunk header: {header!r}"
                    )
                index += 1
                old_lines: list[str] = []
                new_lines: list[str] = []
                eof = False
                while index < len(lines):
                    entry = lines[index]
                    if entry == "*** End of File":
                        eof = True
                        index += 1
                        break
                    if entry.startswith("@@") or entry.startswith("*** "):
                        break
                    if not entry:
                        old_lines.append("")
                        new_lines.append("")
                        index += 1
                        continue
                    prefix = entry[0]
                    content = entry[1:]
                    if prefix == " ":
                        old_lines.append(content)
                        new_lines.append(content)
                    elif prefix == "-":
                        old_lines.append(content)
                    elif prefix == "+":
                        new_lines.append(content)
                    else:
                        old_lines.append(entry)
                        new_lines.append(entry)
                    index += 1
                if not old_lines and not new_lines:
                    raise PatchError(f"update file '{path}' contains an empty hunk")
                hunks.append(UpdateHunk(old_lines=old_lines, new_lines=new_lines, eof=eof))

            if not hunks:
                raise PatchError(f"update file '{path}' must contain at least one hunk")
            operations.append(UpdateFilePatch(path=path, move_to=move_to, hunks=hunks))
            continue

        raise PatchError(f"unexpected patch line: {line!r}")

    raise PatchError("patch is missing '*** End Patch'")


def _normalize_patch_text(patch_text: str) -> str:
    normalized = patch_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")

    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()

    if lines and lines[0].strip().startswith("```"):
        lines.pop(0)
        if lines and lines[-1].strip() == "```":
            lines.pop()

    if not lines:
        return ""

    if lines[0] != "*** Begin Patch" and _is_patch_directive(lines[0]):
        lines.insert(0, "*** Begin Patch")

    if lines and lines[0] == "*** Begin Patch" and "*** End Patch" not in lines:
        lines.append("*** End Patch")

    return "\n".join(lines)


def _is_patch_directive(line: str) -> bool:
    return any(
        _directive_path(line, name) is not None
        for name in ("Add File", "Delete File", "Update File")
    )


def _directive_path(line: str, name: str) -> str | None:
    colon_prefix = f"*** {name}: "
    space_prefix = f"*** {name} "
    if line.startswith(colon_prefix):
        return line.removeprefix(colon_prefix).strip()
    if line.startswith(space_prefix):
        return line.removeprefix(space_prefix).strip()
    return None


def read_text_snapshot(path: Path) -> TextSnapshot:
    data = path.read_bytes()
    bom = codecs.BOM_UTF8 if data.startswith(codecs.BOM_UTF8) else b""
    text = data[len(bom) :].decode("utf-8")
    newline = "\r\n" if "\r\n" in text else "\n"
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return TextSnapshot(text=normalized, style=TextStyle(bom=bom, newline=newline))


def write_text_snapshot(path: Path, content: str, style: TextStyle) -> None:
    output = content.replace("\n", style.newline)
    data = style.bom + output.encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def apply_update_hunks(content: str, hunks: list[UpdateHunk]) -> str:
    trailing_newline = content.endswith("\n")
    lines = content.split("\n")
    if trailing_newline:
        lines = lines[:-1]

    cursor = 0
    for hunk in hunks:
        old_lines = hunk.old_lines
        new_lines = hunk.new_lines
        if not old_lines:
            insertion = len(lines) if hunk.eof else min(cursor, len(lines))
            lines[insertion:insertion] = new_lines
            cursor = insertion + len(new_lines)
            continue

        start = _find_sequence(lines, old_lines, cursor, hunk.eof)
        if start == -1 and cursor != 0:
            start = _find_sequence(lines, old_lines, 0, hunk.eof)
        if start == -1:
            excerpt = "\n".join(old_lines)
            raise PatchError(
                "failed to find the expected lines in the target file:\n"
                f"{excerpt}"
            )
        lines[start : start + len(old_lines)] = new_lines
        cursor = start + len(new_lines)

    result = "\n".join(lines)
    if trailing_newline or any(hunk.eof for hunk in hunks):
        return result + "\n"
    return result


def _validate_path(path: str) -> None:
    if not path:
        raise PatchError("patch path must not be empty")


def _ensure_unique_path(seen_paths: set[str], path: str) -> None:
    if path in seen_paths:
        raise PatchError(
            f"patch references '{path}' multiple times; combine changes into one block"
        )
    seen_paths.add(path)


def _find_sequence(
    lines: list[str],
    pattern: list[str],
    start_index: int,
    eof: bool,
) -> int:
    if not pattern:
        return -1

    for compare in (_line_exact, _line_rstrip, _line_trim):
        match = _try_match(lines, pattern, start_index, eof, compare)
        if match != -1:
            return match
    return -1


def _try_match(
    lines: list[str],
    pattern: list[str],
    start_index: int,
    eof: bool,
    compare,
) -> int:
    if eof:
        end_index = len(lines) - len(pattern)
        if end_index >= start_index and _matches_at(lines, pattern, end_index, compare):
            return end_index

    max_index = len(lines) - len(pattern)
    for index in range(start_index, max_index + 1):
        if _matches_at(lines, pattern, index, compare):
            return index
    return -1


def _matches_at(
    lines: list[str],
    pattern: list[str],
    index: int,
    compare,
) -> bool:
    return all(compare(lines[index + offset], value) for offset, value in enumerate(pattern))


def _line_exact(left: str, right: str) -> bool:
    return left == right


def _line_rstrip(left: str, right: str) -> bool:
    return left.rstrip() == right.rstrip()


def _line_trim(left: str, right: str) -> bool:
    return left.strip() == right.strip()
