from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


INSTRUCTION_FILE_NAMES = ("AGENTS.md", "CLAUDE.md")
DEFAULT_SKILL_DIRS = (".chump/skills", ".agents/skills")
SKILL_ROOT_FILE_NAMES = ("SKILL.md",)
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.DOTALL)


@dataclass(frozen=True)
class InstructionFile:
    path: Path
    content: str


@dataclass(frozen=True)
class SkillInfo:
    name: str
    description: str
    file_path: Path
    base_dir: Path
    content: str
    disable_model_invocation: bool


class ResourceCatalog:
    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root.resolve()
        self.global_agent_dir = _global_agent_dir()
        self._system_instructions = self._discover_system_instructions()
        self._system_instruction_paths = {
            str(item.path.resolve()) for item in self._system_instructions
        }
        self._skills = self._discover_skills()
        self._skills_by_name = {item.name: item for item in self._skills}

    @property
    def system_instructions(self) -> list[InstructionFile]:
        return list(self._system_instructions)

    @property
    def skills(self) -> list[SkillInfo]:
        return list(self._skills)

    def get_skill(self, name: str) -> SkillInfo | None:
        return self._skills_by_name.get(name)

    def build_prompt_sections(self) -> str:
        sections: list[str] = []
        instruction_section = self.build_instruction_prompt()
        if instruction_section:
            sections.append(instruction_section)
        return "\n\n".join(section for section in sections if section)

    def build_instruction_prompt(self) -> str:
        return self._format_instruction_section(self._system_instructions)

    def instruction_files_for_path(
        self,
        file_path: Path,
        *,
        exclude: set[str] | None = None,
    ) -> list[InstructionFile]:
        resolved = file_path.resolve()
        current = resolved.parent
        loaded = exclude or set()
        found: list[InstructionFile] = []
        seen: set[str] = set()
        while current == self.workspace_root or self.workspace_root in current.parents:
            for file_name in INSTRUCTION_FILE_NAMES:
                candidate = current / file_name
                key = str(candidate.resolve())
                if key in self._system_instruction_paths or key in loaded or key in seen:
                    continue
                instruction = _read_instruction(candidate)
                if instruction is None:
                    continue
                found.append(instruction)
                seen.add(key)
            if current == self.workspace_root:
                break
            current = current.parent
        return found

    def skill_names(self) -> list[str]:
        return sorted(self._skills_by_name)

    def _discover_system_instructions(self) -> list[InstructionFile]:
        results: list[InstructionFile] = []
        seen: set[str] = set()

        for file_name in INSTRUCTION_FILE_NAMES:
            instruction = _read_instruction(self.global_agent_dir / file_name)
            if instruction is None:
                continue
            key = str(instruction.path.resolve())
            if key not in seen:
                results.append(instruction)
                seen.add(key)
            break

        current = self.workspace_root
        root = current.anchor or "/"
        ancestor_instructions: list[InstructionFile] = []
        while True:
            for file_name in INSTRUCTION_FILE_NAMES:
                instruction = _read_instruction(current / file_name)
                if instruction is None:
                    continue
                key = str(instruction.path.resolve())
                if key not in seen:
                    ancestor_instructions.insert(0, instruction)
                    seen.add(key)
                break
            if str(current) == root:
                break
            parent = current.parent
            if parent == current:
                break
            current = parent

        results.extend(ancestor_instructions)
        return results

    def _discover_skills(self) -> list[SkillInfo]:
        skill_map: dict[str, SkillInfo] = {}
        diagnostics_order: list[SkillInfo] = []
        search_roots = [
            self.workspace_root / relative_path
            for relative_path in DEFAULT_SKILL_DIRS
        ] + [
            self.global_agent_dir / "skills",
            Path.home() / ".agents" / "skills",
        ]

        for root in search_roots:
            for skill in _load_skills_from_root(root):
                if skill.name in skill_map:
                    continue
                skill_map[skill.name] = skill
                diagnostics_order.append(skill)

        diagnostics_order.sort(key=lambda item: item.name)
        return diagnostics_order

    def _format_instruction_section(
        self,
        instructions: Iterable[InstructionFile],
    ) -> str:
        items = list(instructions)
        if not items:
            return ""
        blocks = [
            "# Project Context",
            "Project-specific instructions and guidelines:",
            "",
            "IMPORTANT: These files are direct operating instructions for this session.",
            (
                "Follow them for every reply and action, including greetings, tone, "
                "workflow, commands, coding style, and safety behavior, unless the "
                "user explicitly overrides them in the current turn."
            ),
        ]
        for item in items:
            blocks.append(f"## {item.path}")
            blocks.append(item.content.strip())
        return "\n\n".join(block for block in blocks if block.strip())

def build_instruction_bundle(files: Iterable[InstructionFile]) -> str:
    items = list(files)
    if not items:
        return ""
    chunks: list[str] = []
    for item in items:
        chunks.append(f"Instructions from: {item.path}")
        chunks.append(item.content.strip())
    return "\n\n".join(chunk for chunk in chunks if chunk.strip())


def build_skill_bundle(skill: SkillInfo) -> str:
    sample = _sample_skill_files(skill.base_dir)
    parts = [
        f'<skill_content name="{skill.name}">',
        skill.content.strip(),
        "",
        f"Base directory for this skill: {skill.base_dir}",
        "Resolve relative references against this directory.",
    ]
    if sample:
        parts.extend(["", "<skill_files>", *sample, "</skill_files>"])
    parts.append("</skill_content>")
    return "\n".join(parts)


def _sample_skill_files(base_dir: Path, limit: int = 12) -> list[str]:
    files: list[str] = []
    for path in sorted(base_dir.rglob("*")):
        if len(files) >= limit:
            break
        if not path.is_file():
            continue
        if path.name in SKILL_ROOT_FILE_NAMES:
            continue
        files.append(str(path))
    return files


def _load_skills_from_root(root: Path) -> list[SkillInfo]:
    if not root.exists() or not root.is_dir():
        return []

    discovered: list[SkillInfo] = []
    seen_dirs: set[str] = set()

    for child in sorted(root.iterdir(), key=lambda item: item.name):
        if child.name.startswith(".") and child.name not in SKILL_ROOT_FILE_NAMES:
            continue
        if child.is_dir():
            skill = _load_skill_from_dir(child)
            if skill is not None:
                key = str(skill.base_dir.resolve())
                if key not in seen_dirs:
                    discovered.append(skill)
                    seen_dirs.add(key)
                continue
            discovered.extend(_load_skills_from_root(child))
            continue
        if child.is_file() and child.suffix.lower() == ".md":
            skill = _load_skill_from_file(child)
            if skill is not None:
                key = str(skill.base_dir.resolve())
                if key not in seen_dirs:
                    discovered.append(skill)
                    seen_dirs.add(key)

    return discovered


def _load_skill_from_dir(directory: Path) -> SkillInfo | None:
    candidate = directory / "SKILL.md"
    if not candidate.exists() or not candidate.is_file():
        return None
    return _load_skill_from_file(candidate)


def _load_skill_from_file(file_path: Path) -> SkillInfo | None:
    raw = file_path.read_text(encoding="utf-8")
    frontmatter, body = _split_frontmatter(raw)
    description = _frontmatter_value(frontmatter, "description")
    if not description:
        return None
    base_dir = file_path.parent
    fallback_name = base_dir.name if file_path.name == "SKILL.md" else file_path.stem
    name = _frontmatter_value(frontmatter, "name") or fallback_name
    if not _is_valid_skill_name(name):
        return None
    disable_model_invocation = (
        (_frontmatter_value(frontmatter, "disable-model-invocation") or "").lower()
        == "true"
    )
    return SkillInfo(
        name=name,
        description=" ".join(description.split()),
        file_path=file_path.resolve(),
        base_dir=base_dir.resolve(),
        content=body.strip(),
        disable_model_invocation=disable_model_invocation,
    )


def _split_frontmatter(raw: str) -> tuple[str, str]:
    match = FRONTMATTER_RE.match(raw)
    if not match:
        return "", raw
    return match.group(1), raw[match.end() :]


def _frontmatter_value(frontmatter: str, key: str) -> str | None:
    lines = frontmatter.splitlines()
    prefix = f"{key}:"
    for index, line in enumerate(lines):
        if not line.startswith(prefix):
            continue
        value = line[len(prefix) :].strip()
        if value in {"|", ">"}:
            block_lines: list[str] = []
            for next_line in lines[index + 1 :]:
                if next_line.startswith(" ") or next_line.startswith("\t"):
                    block_lines.append(next_line.strip())
                    continue
                break
            value = "\n".join(block_lines).strip()
        value = value.strip().strip('"').strip("'")
        return value or None
    return None


def _is_valid_skill_name(name: str) -> bool:
    if not name or len(name) > 64:
        return False
    if name.startswith("-") or name.endswith("-") or "--" in name:
        return False
    return bool(re.fullmatch(r"[a-z0-9-]+", name))


def _read_instruction(path: Path) -> InstructionFile | None:
    if not path.exists() or not path.is_file():
        return None
    content = path.read_text(encoding="utf-8").strip()
    if not content:
        return None
    return InstructionFile(path=path.resolve(), content=content)
def _global_agent_dir() -> Path:
    configured = os.environ.get("CHUMP_AGENT_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    if xdg_config_home := os.environ.get("XDG_CONFIG_HOME"):
        return (Path(xdg_config_home).expanduser() / "chump").resolve()
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return (base / "chump").resolve()
    if os.uname().sysname == "Darwin":
        return (Path.home() / "Library" / "Application Support" / "chump").resolve()
    return (Path.home() / ".chump").resolve()
