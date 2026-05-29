from __future__ import annotations

import asyncio
import os
import time
from importlib.metadata import PackageNotFoundError, version

from ai_query.agents import AgentServer
from ai_query.agents.server.types import AgentServerConfig
from aiohttp import web

from .git_utils import get_git_branch
from .agent import ChumpAgent
from .config import ChumpConfig, load_config
from .managed_idle import is_resume_gap
from .process_title import set_process_title
from .resources import ResourceCatalog
from .server.connections import active_connection_count
from .server.sessions import stored_sessions


class ChumpServer(AgentServer):
    def __init__(self, config: ChumpConfig):
        resources = ResourceCatalog(config.workspace_root)
        ChumpAgent.configure(config, resources)
        # `allowed_origins=None` makes ai-query's CORS middleware reply with `*`
        # for any origin, which is fine when the server is only reachable on
        # loopback. As soon as it's exposed via an onlocal share the wildcard
        # gets unreliable in practice — pin to a known list so the web client
        # at chump.yaqeen.me always gets a precise Allow-Origin echo back.
        agent_config = (
            AgentServerConfig(allowed_origins=list(config.allowed_origins))
            if config.allowed_origins
            else None
        )
        super().__init__(ChumpAgent, config=agent_config)
        self.chump_config = config
        self.resources = resources
        self.started_at = time.time()
        self._managed_idle_task: asyncio.Task[None] | None = None
        self._managed_idle_resume_grace_until: float | None = None

    def on_app_setup(self, app: web.Application) -> None:
        app._client_max_size = 64 * 1024 * 1024
        app.router.add_get("/health", self.health)
        app.router.add_get("/version", self.version)
        app.router.add_get("/sessions", self.sessions)
        app.on_startup.append(self._start_managed_idle_shutdown)
        app.on_cleanup.append(self._stop_managed_idle_shutdown)

    async def health(self, request: web.Request) -> web.Response:
        return web.json_response(
            {
                "status": "ok",
                "version": _package_version("chump-server"),
                "ai_query_version": _package_version("ai-query"),
                "process_id": os.getpid(),
                "workspace_root": str(self.chump_config.workspace_root),
                "git_branch": get_git_branch(self.chump_config.workspace_root),
                "data_dir": str(self.chump_config.data_dir),
                "provider": self.chump_config.provider,
                "model": self.chump_config.model,
                "max_steps": self.chump_config.max_steps,
                "command_timeout": self.chump_config.command_timeout,
                "managed_idle_timeout": self.chump_config.managed_idle_timeout,
                "reasoning": self.chump_config.reasoning,
                "verbose": self.chump_config.verbose,
                "active_sessions": len(self._agents),
                "active_connections": self._active_connection_count(),
                "uptime_seconds": round(time.time() - self.started_at, 3),
                "instruction_files": [
                    str(item.path) for item in self.resources.system_instructions
                ],
                "skills": [
                    {"name": item.name, "description": item.description}
                    for item in self.resources.skills
                ],
                "available_providers": list(self.chump_config.available_providers),
            }
        )

    async def version(self, request: web.Request) -> web.Response:
        return web.json_response(
            {
                "chump_server": _package_version("chump-server"),
                "ai_query": _package_version("ai-query"),
            }
        )

    async def sessions(self, request: web.Request) -> web.Response:
        return web.json_response({"sessions": self._stored_sessions()})

    def _stored_sessions(self) -> list[dict[str, Any]]:
        db_path = self.chump_config.data_dir / "chump.sqlite3"
        return stored_sessions(db_path, self._agents)

    async def _start_managed_idle_shutdown(self, app: web.Application) -> None:
        if self.chump_config.managed_idle_timeout is None:
            return
        self._managed_idle_task = asyncio.create_task(
            self._managed_idle_shutdown_loop()
        )

    async def _stop_managed_idle_shutdown(self, app: web.Application) -> None:
        if self._managed_idle_task is None:
            return
        self._managed_idle_task.cancel()
        try:
            await self._managed_idle_task
        except asyncio.CancelledError:
            pass
        self._managed_idle_task = None

    async def _managed_idle_shutdown_loop(self) -> None:
        timeout = self.chump_config.managed_idle_timeout
        if timeout is None:
            return
        interval = max(0.25, min(1.0, timeout / 2))
        last_tick = time.monotonic()
        while True:
            await asyncio.sleep(interval)
            tick = time.monotonic()
            loop_gap = tick - last_tick
            last_tick = tick
            now = time.time()
            if is_resume_gap(loop_gap, interval, timeout):
                self._managed_idle_resume_grace_until = now + timeout
                continue
            if self._active_connection_count() > 0:
                self._managed_idle_resume_grace_until = None
                continue
            if (
                self._managed_idle_resume_grace_until is not None
                and now < self._managed_idle_resume_grace_until
            ):
                continue
            self._managed_idle_resume_grace_until = None
            last_activity = max(
                [
                    self.started_at,
                    *(meta.last_activity for meta in self._agents.values()),
                ]
            )
            if now - last_activity >= timeout:
                print(
                    f"[chump] no active clients for {timeout}s; shutting down managed server",
                    flush=True,
                )
                await self.shutdown()
                return

    def _active_connection_count(self) -> int:
        return active_connection_count(list(self._agents.values()))


def main() -> None:
    set_process_title("Chump Agent (Server)")
    config = load_config()
    resources = ResourceCatalog(config.workspace_root)
    if config.verbose:
        print(
            "[chump] "
            f"provider={config.provider} "
            f"model={config.model} "
            f"max_steps={config.max_steps} "
            f"command_timeout={config.command_timeout} "
            f"managed_idle_timeout={config.managed_idle_timeout} "
            f"reasoning={config.reasoning} "
            f"workspace={config.workspace_root}",
            flush=True,
        )
        instruction_paths = (
            ", ".join(str(item.path) for item in resources.system_instructions)
            or "none"
        )
        print(
            f"[chump] context_files={instruction_paths}",
            flush=True,
        )
    server = ChumpServer(config)
    server.resources = resources
    server.serve(host=config.host, port=config.port)


def _package_version(package: str) -> str:
    try:
        return version(package)
    except PackageNotFoundError:
        return "0.0.0"


if __name__ == "__main__":
    main()
