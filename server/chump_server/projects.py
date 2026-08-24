from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import global_state_dir

PROJECT_REGISTRY_VERSION = 1


@dataclass(frozen=True)
class Project:
    id: str
    name: str
    workspace_path: Path
    created_at: int
    last_opened_at: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "workspacePath": str(self.workspace_path),
            "createdAt": self.created_at,
            "lastOpenedAt": self.last_opened_at,
        }


class ProjectRegistry:
    """Persistent project registry owned by chump-server."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or global_state_dir() / "projects.json"
        self._lock = asyncio.Lock()

    async def list(self) -> list[Project]:
        async with self._lock:
            projects = await asyncio.to_thread(self._read)
        return sorted(projects, key=lambda project: project.last_opened_at, reverse=True)

    async def get(self, project_id: str) -> Project | None:
        return next(
            (project for project in await self.list() if project.id == project_id),
            None,
        )

    async def register(
        self,
        workspace_path: str | Path,
        name: str | None = None,
        *,
        now: int | None = None,
    ) -> Project:
        canonical = Path(workspace_path).expanduser().resolve(strict=True)
        timestamp = now if now is not None else int(time.time() * 1000)
        async with self._lock:
            projects = await asyncio.to_thread(self._read)
            existing = next(
                (project for project in projects if project.workspace_path == canonical),
                None,
            )
            if existing is not None:
                project = Project(
                    id=existing.id,
                    name=name.strip() if name and name.strip() else existing.name,
                    workspace_path=canonical,
                    created_at=existing.created_at,
                    last_opened_at=timestamp,
                )
                projects = [project if item.id == project.id else item for item in projects]
            else:
                project = Project(
                    id=project_id_for_path(canonical),
                    name=name.strip() if name and name.strip() else canonical.name or str(canonical),
                    workspace_path=canonical,
                    created_at=timestamp,
                    last_opened_at=timestamp,
                )
                projects.append(project)
            await asyncio.to_thread(self._write, projects)
        return project

    async def remove(self, project_id: str) -> bool:
        async with self._lock:
            projects = await asyncio.to_thread(self._read)
            remaining = [project for project in projects if project.id != project_id]
            if len(remaining) == len(projects):
                return False
            await asyncio.to_thread(self._write, remaining)
        return True

    async def rename(self, project_id: str, name: str) -> Project | None:
        normalized = name.strip()
        if not normalized:
            raise ValueError("project name cannot be empty")
        async with self._lock:
            projects = await asyncio.to_thread(self._read)
            existing = next(
                (project for project in projects if project.id == project_id),
                None,
            )
            if existing is None:
                return None
            project = Project(
                id=existing.id,
                name=normalized,
                workspace_path=existing.workspace_path,
                created_at=existing.created_at,
                last_opened_at=existing.last_opened_at,
            )
            await asyncio.to_thread(
                self._write,
                [project if item.id == project_id else item for item in projects],
            )
        return project

    def _read(self) -> list[Project]:
        if not self.path.exists():
            return []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid Chump project registry: {self.path}") from error
        if not isinstance(payload, dict) or payload.get("version") != PROJECT_REGISTRY_VERSION:
            raise ValueError(f"invalid Chump project registry: {self.path}")
        values = payload.get("projects")
        if not isinstance(values, list):
            raise ValueError(f"invalid Chump project registry: {self.path}")
        return [parse_project(value, self.path) for value in values]

    def _write(self, projects: list[Project]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f"{self.path.name}.{os.getpid()}.tmp")
        payload = {
            "version": PROJECT_REGISTRY_VERSION,
            "projects": [project.to_dict() for project in projects],
        }
        temporary.write_text(
            f"{json.dumps(payload, indent=2)}\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        temporary.replace(self.path)


def project_id_for_path(workspace_path: Path) -> str:
    digest = hashlib.sha256(str(workspace_path.resolve()).encode("utf-8")).hexdigest()[:16]
    return f"project-{digest}"


def parse_project(value: Any, registry_path: Path) -> Project:
    if not isinstance(value, dict):
        raise ValueError(f"invalid Chump project registry: {registry_path}")
    project_id = value.get("id")
    name = value.get("name")
    workspace_path = value.get("workspacePath")
    created_at = value.get("createdAt")
    last_opened_at = value.get("lastOpenedAt")
    if (
        not isinstance(project_id, str)
        or not isinstance(name, str)
        or not isinstance(workspace_path, str)
        or isinstance(created_at, bool)
        or not isinstance(created_at, (int, float))
        or isinstance(last_opened_at, bool)
        or not isinstance(last_opened_at, (int, float))
    ):
        raise ValueError(f"invalid Chump project registry: {registry_path}")
    return Project(
        id=project_id,
        name=name,
        workspace_path=Path(workspace_path).expanduser().resolve(),
        created_at=int(created_at),
        last_opened_at=int(last_opened_at),
    )
