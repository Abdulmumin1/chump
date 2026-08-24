from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ai_query.agents import AgentServer, SQLiteStorage
from ai_query.agents.server.handlers import ServerHandlers
from ai_query.agents.server.types import AgentServerConfig

from .agent import bind_chump_agent
from .config import (
    ChumpConfig,
    load_config,
    load_global_config,
    load_repo_config,
)
from .mcp_config import load_mcp_server_configs
from .mcp_runtime import MCPManager
from .projects import Project, ProjectRegistry
from .resources import ResourceCatalog
from .search import WorkspaceSearch
from .server.connections import active_connection_count
from .server.sessions import stored_sessions


class WorkspaceRuntime:
    """One workspace's in-process resources and agent sessions."""

    def __init__(self, project: Project, config: ChumpConfig) -> None:
        if project.workspace_path != config.workspace_root:
            raise ValueError(
                f"workspace config {config.workspace_root} does not match project "
                f"{project.workspace_path}"
            )
        self.project = project
        self.config = config
        self.resources = ResourceCatalog(config.workspace_root)
        self.search = WorkspaceSearch(config.workspace_root)
        self.mcp = MCPManager(config.workspace_root, config.mcp_servers)
        self.storage = SQLiteStorage(str(config.data_dir / "chump.sqlite3"))
        agent_class = bind_chump_agent(
            config,
            self.resources,
            search=self.search,
            mcp=self.mcp,
            storage=self.storage,
        )
        agent_config = AgentServerConfig(
            allowed_origins=(
                list(config.allowed_origins) if config.allowed_origins else None
            )
        )
        self.server = AgentServer(
            agent_class,
            config=agent_config,
            session_storage=self.storage,
        )
        self.handlers = ServerHandlers(self.server)
        self.started_at = time.time()

    async def sync_mcp_config(self) -> None:
        configs = load_mcp_server_configs(
            self.config.workspace_root,
            load_repo_config(self.config.workspace_root),
            load_global_config(),
        )
        await self.mcp.sync_configs(configs)
        for meta in self.server._agents.values():
            meta.agent.refresh_mcp_tools()

    async def session_page(self, *, page: int, page_size: int) -> dict[str, Any]:
        sessions, total = await asyncio.to_thread(
            stored_sessions,
            self.config.data_dir / "chump.sqlite3",
            dict(self.server._agents),
            page=page,
            page_size=page_size,
        )
        return {
            "sessions": sessions,
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    def active_connection_count(self) -> int:
        return active_connection_count(list(self.server._agents.values()))

    def has_active_turn(self) -> bool:
        return any(
            self.server.is_agent_busy(agent_id)
            for agent_id in self.server._agents
        )

    async def close(self) -> None:
        for agent_id in list(self.server._agents):
            await self.server.evict(agent_id)
        await self.search.close()
        await self.mcp.close()
        self.storage.close()


class WorkspaceRuntimeMap:
    """Lazily creates one in-process runtime per registered project."""

    def __init__(
        self,
        projects: ProjectRegistry,
        *,
        config_loader: Callable[[Path], ChumpConfig] = load_config,
    ) -> None:
        self.projects = projects
        self._config_loader = config_loader
        self._runtimes: dict[str, WorkspaceRuntime] = {}
        self._starts: dict[str, asyncio.Task[WorkspaceRuntime | None]] = {}
        self._lock = asyncio.Lock()

    async def get(self, project_id: str) -> WorkspaceRuntime | None:
        runtime = self._runtimes.get(project_id)
        if runtime is not None:
            return runtime
        async with self._lock:
            runtime = self._runtimes.get(project_id)
            if runtime is not None:
                return runtime
            task = self._starts.get(project_id)
            if task is None:
                task = asyncio.create_task(self._create(project_id))
                self._starts[project_id] = task
        try:
            return await task
        finally:
            async with self._lock:
                if self._starts.get(project_id) is task:
                    self._starts.pop(project_id, None)

    async def _create(self, project_id: str) -> WorkspaceRuntime | None:
        project = await self.projects.get(project_id)
        if project is None:
            return None
        runtime = WorkspaceRuntime(
            project,
            self._config_loader(project.workspace_path),
        )
        async with self._lock:
            existing = self._runtimes.get(project_id)
            if existing is not None:
                await runtime.close()
                return existing
            self._runtimes[project_id] = runtime
        return runtime

    def values(self) -> tuple[WorkspaceRuntime, ...]:
        return tuple(self._runtimes.values())

    async def evict(self, project_id: str) -> bool:
        async with self._lock:
            runtime = self._runtimes.pop(project_id, None)
        if runtime is None:
            return False
        await runtime.close()
        return True

    async def close(self) -> None:
        async with self._lock:
            runtimes = list(self._runtimes.values())
            self._runtimes.clear()
        for runtime in runtimes:
            await runtime.close()
