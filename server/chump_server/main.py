from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from ai_query.agents import AgentServer
from ai_query.agents.server.types import AgentServerConfig
from aiohttp import web

from .git_utils import get_git_branch
from .agent import ChumpAgent
from .config import ChumpConfig, load_config
from .managed_idle import is_resume_gap
from .resources import ResourceCatalog


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
        if not db_path.exists():
            return []

        session_ids: set[str] = set()
        values: dict[str, Any] = {}
        with sqlite3.connect(str(db_path)) as conn:
            cursor = conn.execute("SELECT key, value FROM kv_store")
            for key, raw_value in cursor.fetchall():
                if ":" not in key:
                    continue
                session_id, suffix = key.rsplit(":", 1)
                if suffix not in {"state", "messages", "event_log"}:
                    continue
                session_ids.add(session_id)
                values[key] = _decode_json(raw_value)

        sessions = []
        active_ids = set(self._agents.keys())
        for session_id in sorted(session_ids):
            state = values.get(f"{session_id}:state") or {}
            messages = values.get(f"{session_id}:messages") or []
            event_log = values.get(f"{session_id}:event_log") or []
            active_meta = self._agents.get(session_id)
            created_at = state.get("created_at") if isinstance(state, dict) else None
            updated_at = state.get("updated_at") if isinstance(state, dict) else None
            sessions.append(
                {
                    "id": session_id,
                    "active": session_id in active_ids,
                    "message_count": len(messages) if isinstance(messages, list) else 0,
                    "event_count": len(event_log) if isinstance(event_log, list) else 0,
                    "title": (state.get("title") if isinstance(state, dict) else None),
                    "created_at": created_at
                    if isinstance(created_at, (int, float))
                    else None,
                    "updated_at": updated_at
                    if isinstance(updated_at, (int, float))
                    else None,
                    "last_user_goal": (
                        state.get("last_user_goal") if isinstance(state, dict) else None
                    ),
                    "last_activity": active_meta.last_activity if active_meta else None,
                    "connections": active_meta.connection_count if active_meta else 0,
                }
            )
        sessions.sort(
            key=lambda session: (
                session.get("updated_at")
                or session.get("created_at")
                or session.get("last_activity")
                or 0,
                session["id"],
            ),
            reverse=True,
        )
        return sessions

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
        count = 0
        for meta in self._agents.values():
            agent = meta.agent
            count += len(agent._connections)
            stale_sse = []
            for response in list(agent._sse_connections):
                task = getattr(response, "task", None)
                if task is not None and task.done():
                    stale_sse.append(response)
                    continue
                count += 1
            for response in stale_sse:
                agent._sse_connections.discard(response)
        return count


def main() -> None:
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


def _decode_json(value: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


if __name__ == "__main__":
    main()
