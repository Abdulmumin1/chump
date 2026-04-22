from __future__ import annotations

from pathlib import Path
import shlex


BANNED_COMMAND_TOKENS = {
    "rm",
    "sudo",
    "kill",
    "pkill",
    "reboot",
    "shutdown",
}

BANNED_COMMAND_PATTERNS = (
    "rm -rf",
    "git reset --hard",
    "git checkout --",
)


class SafetyError(ValueError):
    """Raised when a path or command fails safety checks."""


class WorkspaceGuard:
    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root.resolve()

    def resolve_path(self, raw_path: str) -> Path:
        candidate = (self.workspace_root / raw_path).resolve()
        if candidate != self.workspace_root and self.workspace_root not in candidate.parents:
            raise SafetyError(f"path escapes workspace root: {raw_path}")
        return candidate

    def ensure_text_file(self, raw_path: str) -> Path:
        path = self.resolve_path(raw_path)
        if path.exists() and not path.is_file():
            raise SafetyError(f"not a file: {raw_path}")
        return path

    def ensure_directory(self, raw_path: str) -> Path:
        path = self.resolve_path(raw_path)
        if path.exists() and not path.is_dir():
            raise SafetyError(f"not a directory: {raw_path}")
        return path


def validate_command(command: str) -> None:
    normalized = command.strip()
    for pattern in BANNED_COMMAND_PATTERNS:
        if pattern in normalized:
            raise SafetyError(f"command is blocked: {pattern}")

    parts = shlex.split(normalized)
    if parts and parts[0] in BANNED_COMMAND_TOKENS:
        raise SafetyError(f"command is blocked: {parts[0]}")

