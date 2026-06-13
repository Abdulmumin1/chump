from __future__ import annotations

import json

from ..config import ChumpConfig
from ..resources import ResourceCatalog, build_instruction_bundle, build_skill_bundle
from ..safety import SafetyError, WorkspaceGuard
from ._utils import (
    _fingerprint,
    _multiline_preview,
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
from .skill import bind_skill
from .search import bind_search

MAX_CHANGE_RECORDS = 200


def build_tools(agent, config: ChumpConfig, resources: ResourceCatalog, search):
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
            preview = _multiline_preview(result) if name == "bash" else _preview(result)
            await emit(
                "tool_result",
                tool=name,
                name=name,
                ok=True,
                status="ok",
                preview=preview,
                metadata=metadata,
            )
            log(f"ok {name}: {_preview(result, 240)}")
            return result
        except Exception as exc:
            error_preview = str(exc)
            if name == "apply_patch":
                error_preview = error_preview.splitlines()[0] if error_preview else ""
            elif name == "bash":
                error_preview = _multiline_preview(error_preview)
            await emit(
                "tool_result",
                tool=name,
                name=name,
                ok=False,
                status="error",
                error=str(exc),
                preview=error_preview,
                metadata={
                    "chars": len(str(exc)),
                    "preview_chars": len(error_preview),
                    "truncated": error_preview != str(exc),
                },
            )
            log(f"error {name}: {exc}")
            raise

    def _as_int(value: object) -> int:
        return value if isinstance(value, int) else 0

    async def record_file_changes(diffs: list[dict[str, object]]) -> None:
        if not diffs:
            return

        files_touched = list(agent.state.get("files_touched", []))
        file_diffs = dict(agent.state.get("file_diffs", {}))
        change_records = list(agent.state.get("change_records", []))

        for diff in diffs:
            path = diff.get("path")
            if not isinstance(path, str) or not path:
                continue

            if path not in files_touched:
                files_touched.append(path)

            source_path = diff.get("source_path")
            if isinstance(source_path, str) and source_path and source_path not in files_touched:
                files_touched.append(source_path)

            current = file_diffs.get(path, {"added": 0, "removed": 0})
            file_diffs[path] = {
                "added": _as_int(current.get("added")) + _as_int(diff.get("added")),
                "removed": _as_int(current.get("removed")) + _as_int(diff.get("removed")),
            }
            change_records.append(dict(diff))

        await agent.update_state(
            files_touched=files_touched,
            file_diffs=file_diffs,
            change_records=change_records[-MAX_CHANGE_RECORDS:],
        )

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

    async def resolve_read_context(file_path) -> tuple[str, dict[str, object]]:
        loaded_paths = set(agent._turn_instruction_claims)
        files = resources.instruction_files_for_path(file_path, exclude=loaded_paths)
        if not files:
            return "", {"loaded": []}
        for item in files:
            agent._turn_instruction_claims.add(str(item.path))
        return build_instruction_bundle(files), {
            "loaded": [str(item.path) for item in files]
        }

    read_file = bind_read_file(
        guard=guard,
        wrap_tool=wrap_tool,
        remember_file_read=remember_file_read,
        resolve_read_context=resolve_read_context,
    )

    write_file = bind_write_file(
        guard=guard,
        wrap_tool=wrap_tool,
        record_file_changes=record_file_changes,
        require_fresh_read=require_fresh_read,
        remember_file_read=remember_file_read,
    )

    apply_patch = bind_apply_patch(
        guard=guard,
        wrap_tool=wrap_tool,
        record_file_changes=record_file_changes,
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

    skill = bind_skill(
        wrap_tool=wrap_tool,
        get_skill=lambda name: (
            build_skill_bundle(match) if (match := resources.get_skill(name)) else None
        ),
        available_skills_text="\n".join(
            f"- {skill.name}: {skill.description}" for skill in resources.skills
        )
        or "- none",
    )
    search_tool = bind_search(search=search, wrap_tool=wrap_tool)

    return {
        "read_file": read_file,
        "write_file": write_file,
        "apply_patch": apply_patch,
        "skill": skill,
        "web_fetch": web_fetch,
        "website": website,
        "search": search_tool,
        "bash": bash,
    }
