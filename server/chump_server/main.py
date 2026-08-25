from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, cast

from ai_query.agents import AgentServer, SQLiteStorage
from ai_query.agents.server.types import AgentServerConfig
from aiohttp import web

from .git_utils import get_git_branch
from .agent import bind_chump_agent
from .config import (
    ChumpConfig,
    PROVIDER_MODELS,
    chump_temp_dir,
    load_config,
    load_global_config,
    load_repo_config,
)
from .directory_picker import pick_directory
from .git_actions import (
    GitAction,
    GitActionOptions,
    read_git_action_files,
    run_project_git_action,
)
from .managed_idle import is_resume_gap
from .mcp_runtime import MCPManager
from .mcp_config import load_mcp_server_configs
from .process_title import set_process_title
from .projects import ProjectRegistry
from .resources import ResourceCatalog
from .search import WorkspaceSearch
from .server.connections import active_connection_count
from .server.sessions import stored_sessions
from .service import (
    DEFAULT_SERVICE_PORT,
    ServiceRegistration,
    ServiceRegistrationStore,
    service_auth_middleware,
    service_registration_key,
    service_scope_middleware,
)
from .terminal import terminal_websocket
from .workspaces import WorkspaceRuntime, WorkspaceRuntimeMap

MAX_JSON_BODY_BYTES = 64 * 1024
EVENT_DELIVERY_TIMEOUT_SECONDS = 1.0


class ChumpServer(AgentServer):
    def __init__(
        self,
        config: ChumpConfig,
        resources: ResourceCatalog | None = None,
        projects: ProjectRegistry | None = None,
        workspace_runtimes: WorkspaceRuntimeMap | None = None,
        service_registration: ServiceRegistration | None = None,
        service_registration_store: ServiceRegistrationStore | None = None,
    ):
        resources = resources or ResourceCatalog(config.workspace_root)
        self.search = WorkspaceSearch(config.workspace_root)
        self.mcp = MCPManager(config.workspace_root, config.mcp_servers)
        self.storage = SQLiteStorage(str(config.data_dir / "chump.sqlite3"))
        agent_class = bind_chump_agent(
            config,
            resources,
            search=self.search,
            mcp=self.mcp,
            storage=self.storage,
        )
        # `allowed_origins=None` makes ai-query's CORS middleware reply with `*`
        # for any origin, which is fine when the server is only reachable on
        # loopback. As soon as it's exposed via an onlocal share the wildcard
        # gets unreliable in practice — pin to a known list so the web client
        # at the current and legacy hosted domains gets a precise Allow-Origin
        # echo back.
        agent_config = (
            AgentServerConfig(allowed_origins=list(config.allowed_origins))
            if config.allowed_origins
            else None
        )
        super().__init__(
            agent_class,
            config=agent_config,
            session_storage=self.storage,
        )
        self.chump_config = config
        self.resources = resources
        self.projects = projects or ProjectRegistry()
        self.workspace_runtimes = workspace_runtimes or WorkspaceRuntimeMap(
            self.projects
        )
        self.started_at = time.time()
        self.service_registration = service_registration
        self.service_registration_store = (
            service_registration_store or ServiceRegistrationStore()
        )
        self._managed_idle_task: asyncio.Task[None] | None = None
        self._managed_idle_resume_grace_until: float | None = None
        self._active_requests = 0

    def _create_emit_handler(self, agent: Any):
        """Broadcast live events without letting one stale client block all streams."""

        async def deliver(event: str, data: dict[str, Any], event_id: int) -> None:
            ws_msg = json.dumps({"type": event, "id": event_id, **data})
            for conn in list(agent._connections):
                try:
                    await asyncio.wait_for(
                        conn.send(ws_msg),
                        timeout=EVENT_DELIVERY_TIMEOUT_SECONDS,
                    )
                except TimeoutError:
                    agent._connections.discard(conn)
                except Exception:
                    agent._connections.discard(conn)

            sse_msg = f"id: {event_id}\nevent: {event}\ndata: {json.dumps(data)}\n\n"
            for sse in list(agent._sse_connections):
                try:
                    await asyncio.wait_for(
                        sse.write(sse_msg.encode()),
                        timeout=EVENT_DELIVERY_TIMEOUT_SECONDS,
                    )
                except asyncio.CancelledError:
                    task = asyncio.current_task()
                    if task is not None and task.cancelling():
                        raise
                    agent._sse_connections.discard(sse)
                except TimeoutError:
                    agent._sse_connections.discard(sse)
                except Exception:
                    agent._sse_connections.discard(sse)

        return deliver

    def on_app_setup(self, app: web.Application) -> None:
        app._client_max_size = 64 * 1024 * 1024
        if self.service_registration is not None:
            app[service_registration_key] = self.service_registration
            app.middlewares.append(service_auth_middleware)
            app.middlewares.append(service_scope_middleware)
        app.middlewares.append(self._track_active_requests)
        app.router.add_get("/health", self.health)
        app.router.add_get("/version", self.version)
        app.router.add_get("/sessions", self.sessions)
        app.router.add_get("/files", self.files)
        app.router.add_post("/attachments", self.upload_attachment)
        app.router.add_get("/attachments/{attachment_id}", self.get_attachment)
        app.router.add_get("/terminal", self.terminal)
        app.router.add_post("/directory-picker", self.directory_picker)
        if self.service_registration is not None:
            app.router.add_post("/service/shutdown", self.shutdown_service)
        app.router.add_get("/projects", self.list_projects)
        app.router.add_post("/projects", self.register_project)
        app.router.add_get("/projects/{project_id}", self.get_project)
        app.router.add_patch("/projects/{project_id}", self.rename_project)
        app.router.add_delete("/projects/{project_id}", self.remove_project)
        app.router.add_get("/projects/{project_id}/health", self.project_health)
        app.router.add_get("/projects/{project_id}/sessions", self.project_sessions)
        app.router.add_post("/projects/{project_id}/sessions", self.create_project_session)
        app.router.add_get("/projects/{project_id}/files", self.project_files)
        app.router.add_post(
            "/projects/{project_id}/attachments", self.upload_attachment
        )
        app.router.add_get(
            "/projects/{project_id}/attachments/{attachment_id}",
            self.get_attachment,
        )
        app.router.add_post(
            "/projects/{project_id}/git/{action:commit-push|commit|push|create-pr}",
            self.project_git_action,
        )
        app.router.add_get("/projects/{project_id}/terminal", self.project_terminal)
        app.router.add_get(
            "/projects/{project_id}/sessions/{agent_id}/state",
            self.project_session_state,
        )
        app.router.add_get(
            "/projects/{project_id}/sessions/{agent_id}/messages",
            self.project_session_messages,
        )
        app.router.add_get(
            "/projects/{project_id}/sessions/{agent_id}/events",
            self.project_session_events,
        )
        app.router.add_get(
            "/projects/{project_id}/sessions/{agent_id}/ws",
            self.project_session_websocket,
        )
        app.router.add_post(
            "/projects/{project_id}/sessions/{agent_id}/chat",
            self.project_session_chat,
        )
        app.router.add_post(
            "/projects/{project_id}/sessions/{agent_id}/action/{action_name}",
            self.project_session_action,
        )
        if self.service_registration is not None:
            app.on_startup.append(self._publish_service_registration)
        app.on_startup.append(self._start_managed_idle_shutdown)
        app.on_cleanup.append(self._stop_managed_idle_shutdown)
        app.on_cleanup.append(self._close_search)
        app.on_cleanup.append(self._close_mcp)
        app.on_cleanup.append(self._close_workspaces)
        app.on_cleanup.append(self._close_storage)
        if self.service_registration is not None:
            app.on_cleanup.append(self._clear_service_registration)

    @web.middleware
    async def _track_active_requests(
        self,
        request: web.Request,
        handler,
    ) -> web.StreamResponse:
        self._active_requests += 1
        try:
            return await handler(request)
        finally:
            self._active_requests = max(0, self._active_requests - 1)

    async def _close_search(self, app: web.Application) -> None:
        await self.search.close()

    async def _close_mcp(self, app: web.Application) -> None:
        await self.mcp.close()

    async def _close_workspaces(self, app: web.Application) -> None:
        await self.workspace_runtimes.close()

    async def _close_storage(self, app: web.Application) -> None:
        self.storage.close()

    async def _publish_service_registration(self, app: web.Application) -> None:
        if self.service_registration is not None:
            self.service_registration_store.write(self.service_registration)

    async def _clear_service_registration(self, app: web.Application) -> None:
        if self.service_registration is not None:
            self.service_registration_store.clear(self.service_registration.instance_id)

    async def health(self, request: web.Request) -> web.Response:
        if self.service_registration is not None:
            return web.json_response(
                {
                    "status": "ok",
                    "service": "chump-server",
                    "version": _package_version("chump-server"),
                    "instance_id": self.service_registration.instance_id,
                    "process_id": os.getpid(),
                }
            )
        await self._sync_mcp_config()
        return web.json_response(
            {
                "status": "ok",
                "service": "chump-server",
                "version": _package_version("chump-server"),
                "instance_id": (
                    self.service_registration.instance_id
                    if self.service_registration is not None
                    else None
                ),
                "ai_query_version": _package_version("ai-query"),
                "process_id": os.getpid(),
                "workspace_root": str(self.chump_config.workspace_root),
                "git_branch": get_git_branch(self.chump_config.workspace_root),
                "data_dir": str(self.chump_config.data_dir),
                "provider": self.chump_config.provider,
                "model": self.chump_config.model,
                "max_steps": self.chump_config.max_steps,
                "command_timeout": self.chump_config.command_timeout,
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
                "available_models": {
                    provider: sorted(PROVIDER_MODELS.get(provider, ()))
                    for provider in self.chump_config.available_providers
                },
                "mcp": self.mcp.status(),
            }
        )

    async def _sync_mcp_config(self) -> None:
        configs = load_mcp_server_configs(
            self.chump_config.workspace_root,
            load_repo_config(self.chump_config.workspace_root),
            load_global_config(),
        )
        await self.mcp.sync_configs(configs)
        for meta in self._agents.values():
            meta.agent.refresh_mcp_tools()

    async def version(self, request: web.Request) -> web.Response:
        return web.json_response(
            {
                "chump_server": _package_version("chump-server"),
                "ai_query": _package_version("ai-query"),
            }
        )

    async def sessions(self, request: web.Request) -> web.Response:
        page = parse_positive_int(request.query.get("page", "1"), "page")
        page_size = min(
            parse_positive_int(request.query.get("limit", "10"), "limit"),
            10,
        )
        active_agents = dict(self._agents)
        sessions, total = await asyncio.to_thread(
            self._stored_sessions,
            page=page,
            page_size=page_size,
            active_agents=active_agents,
        )
        return web.json_response(
            {
                "sessions": sessions,
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": max(1, (total + page_size - 1) // page_size),
            }
        )

    async def files(self, request: web.Request) -> web.Response:
        query = request.query.get("query", "")
        try:
            limit = int(request.query.get("limit", "20"))
        except ValueError:
            raise web.HTTPBadRequest(text="limit must be an integer")
        return web.json_response(
            {"files": await self.search.files(query, max(1, min(limit, 100)))}
        )

    async def upload_attachment(self, request: web.Request) -> web.Response:
        reader = await request.multipart()
        part = await reader.next()
        if part is None or part.name != "file" or not part.filename:
            raise web.HTTPBadRequest(text="file is required")

        filename = Path(part.filename).name
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip(".-") or "file"
        safe_name = safe_name[-180:]
        directory = chump_temp_dir() / "attachments"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
        file_path = directory / f"{uuid.uuid4()}-{safe_name}"
        size = 0
        with file_path.open("xb") as output:
            while chunk := await part.read_chunk():
                size += len(chunk)
                output.write(chunk)
        file_path.chmod(0o600)
        if size == 0:
            file_path.unlink(missing_ok=True)
            raise web.HTTPBadRequest(text="file is empty")

        mime = part.headers.get("Content-Type", "application/octet-stream")
        return web.json_response(
            {
                "attachment": {
                    "type": "file",
                    "label": f"[File: {filename}]",
                    "filename": filename,
                    "mime": mime,
                    "path": str(file_path),
                }
            },
            status=201,
        )

    async def get_attachment(self, request: web.Request) -> web.FileResponse:
        attachment_id = Path(request.match_info["attachment_id"]).name
        if attachment_id != request.match_info["attachment_id"]:
            raise web.HTTPNotFound(text="attachment not found")
        file_path = chump_temp_dir() / "attachments" / attachment_id
        if not file_path.is_file():
            raise web.HTTPNotFound(text="attachment not found")
        return web.FileResponse(file_path)

    async def directory_picker(self, request: web.Request) -> web.Response:
        return web.json_response({"workspacePath": await pick_directory()})

    async def shutdown_service(self, request: web.Request) -> web.Response:
        await self.shutdown()
        return web.json_response({"status": "shutting_down"})

    async def list_projects(self, request: web.Request) -> web.Response:
        projects = await self.projects.list()
        return web.json_response(
            {"projects": [project.to_dict() for project in projects]}
        )

    async def register_project(self, request: web.Request) -> web.Response:
        body = await request.json()
        if (
            not isinstance(body, dict)
            or not isinstance(body.get("workspacePath"), str)
            or body.get("approved") is not True
            or (
                body.get("name") is not None
                and not isinstance(body.get("name"), str)
            )
        ):
            raise web.HTTPBadRequest(
                text="workspacePath and approved: true are required"
            )
        try:
            project = await self.projects.register(
                body["workspacePath"],
                body.get("name"),
            )
        except FileNotFoundError as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        return web.json_response({"project": project.to_dict()}, status=201)

    async def get_project(self, request: web.Request) -> web.Response:
        project = await self.projects.get(request.match_info["project_id"])
        if project is None:
            raise web.HTTPNotFound(text="project not found")
        return web.json_response({"project": project.to_dict()})

    async def rename_project(self, request: web.Request) -> web.Response:
        body = await request.json()
        if not isinstance(body, dict) or not isinstance(body.get("name"), str):
            raise web.HTTPBadRequest(text="name is required")
        try:
            project = await self.projects.rename(
                request.match_info["project_id"],
                body["name"],
            )
        except ValueError as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        if project is None:
            raise web.HTTPNotFound(text="project not found")
        return web.json_response({"project": project.to_dict()})

    async def remove_project(self, request: web.Request) -> web.Response:
        project_id = request.match_info["project_id"]
        if await self.projects.get(project_id) is None:
            raise web.HTTPNotFound(text="project not found")
        await self.workspace_runtimes.evict(project_id)
        await self.projects.remove(project_id)
        return web.Response(status=204)

    async def project_health(self, request: web.Request) -> web.Response:
        runtime = await self._project_runtime(request)
        await runtime.sync_mcp_config()
        return web.json_response(self._workspace_health(runtime))

    async def project_sessions(self, request: web.Request) -> web.Response:
        runtime = await self._project_runtime(request)
        page = parse_positive_int(request.query.get("page", "1"), "page")
        page_size = min(
            parse_positive_int(request.query.get("limit", "10"), "limit"),
            10,
        )
        return web.json_response(
            await runtime.session_page(page=page, page_size=page_size)
        )

    async def create_project_session(self, request: web.Request) -> web.Response:
        runtime = await self._project_runtime(request)
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            raise web.HTTPBadRequest(text="request body must be an object")
        session_id = body.get("sessionId")
        if session_id is None:
            session_id = self._generated_session_id(runtime.project.id)
        if not isinstance(session_id, str) or not re.fullmatch(
            r"[A-Za-z0-9._-]{1,128}",
            session_id,
        ):
            raise web.HTTPBadRequest(
                text=(
                    "sessionId must contain only letters, numbers, dots, "
                    "underscores, and hyphens"
                )
            )
        if await runtime.server.sessions.get(session_id) is not None:
            raise web.HTTPConflict(text=f"session already exists: {session_id}")
        return web.json_response(
            {"projectId": runtime.project.id, "sessionId": session_id},
            status=201,
        )

    async def project_files(self, request: web.Request) -> web.Response:
        runtime = await self._project_runtime(request)
        query = request.query.get("query", "")
        try:
            limit = int(request.query.get("limit", "20"))
        except ValueError:
            raise web.HTTPBadRequest(text="limit must be an integer")
        return web.json_response(
            {
                "files": await runtime.search.files(
                    query,
                    max(1, min(limit, 100)),
                )
            }
        )

    async def project_git_action(self, request: web.Request) -> web.Response:
        project = await self.projects.get(request.match_info["project_id"])
        if project is None:
            raise web.HTTPNotFound(text="project not found")
        body = await read_optional_json_object(request)
        action = cast(GitAction, request.match_info["action"])
        message = body.get("message")
        files = read_git_action_files(body.get("files"))
        if action in {"commit", "commit-push"}:
            if not isinstance(message, str):
                raise web.HTTPBadRequest(text="message is required")
            if not files:
                raise web.HTTPBadRequest(text="select at least one file to commit")
        result = await run_project_git_action(
            project.workspace_path,
            action,
            GitActionOptions(
                message=message if isinstance(message, str) else None,
                files=files,
                pr_title=(
                    body["title"] if isinstance(body.get("title"), str) else None
                ),
                pr_body=body["body"] if isinstance(body.get("body"), str) else None,
                draft=body.get("draft") is True,
            ),
        )
        return web.json_response(result.to_dict(), status=200 if result.ok else 409)

    async def project_session_state(self, request: web.Request) -> web.Response:
        runtime = await self._project_runtime(request)
        return await runtime.handlers.handle_get_state(request)

    async def project_session_messages(self, request: web.Request) -> web.Response:
        runtime = await self._project_runtime(request)
        return await runtime.handlers.handle_get_messages(request)

    async def project_session_events(self, request: web.Request) -> web.StreamResponse:
        runtime = await self._project_runtime(request)
        return await runtime.handlers.handle_sse(request)

    async def project_session_websocket(
        self,
        request: web.Request,
    ) -> web.WebSocketResponse:
        runtime = await self._project_runtime(request)
        return await runtime.handlers.handle_websocket(request)

    async def project_session_chat(self, request: web.Request) -> web.StreamResponse:
        runtime = await self._project_runtime(request)
        return await runtime.handlers.handle_chat(request)

    async def project_session_action(self, request: web.Request) -> web.Response:
        runtime = await self._project_runtime(request)
        return await runtime.handlers.handle_action(request)

    async def project_terminal(self, request: web.Request) -> web.WebSocketResponse:
        runtime = await self._project_runtime(request)
        return await terminal_websocket(
            request,
            workspace_root=runtime.config.workspace_root,
            allowed_origins=runtime.config.allowed_origins,
        )

    async def _project_runtime(self, request: web.Request) -> WorkspaceRuntime:
        runtime = await self.workspace_runtimes.get(request.match_info["project_id"])
        if runtime is None:
            raise web.HTTPNotFound(text="project not found")
        return runtime

    @staticmethod
    def _workspace_health(runtime: WorkspaceRuntime) -> dict[str, Any]:
        config = runtime.config
        return {
            "status": "ok",
            "version": _package_version("chump-server"),
            "ai_query_version": _package_version("ai-query"),
            "process_id": os.getpid(),
            "project_id": runtime.project.id,
            "workspace_root": str(config.workspace_root),
            "git_branch": get_git_branch(config.workspace_root),
            "data_dir": str(config.data_dir),
            "provider": config.provider,
            "model": config.model,
            "max_steps": config.max_steps,
            "command_timeout": config.command_timeout,
            "reasoning": config.reasoning,
            "verbose": config.verbose,
            "active_sessions": len(runtime.server._agents),
            "active_connections": runtime.active_connection_count(),
            "uptime_seconds": round(time.time() - runtime.started_at, 3),
            "instruction_files": [
                str(item.path) for item in runtime.resources.system_instructions
            ],
            "skills": [
                {"name": item.name, "description": item.description}
                for item in runtime.resources.skills
            ],
            "available_providers": list(config.available_providers),
            "available_models": {
                provider: sorted(PROVIDER_MODELS.get(provider, ()))
                for provider in config.available_providers
            },
            "mcp": runtime.mcp.status(),
        }

    @staticmethod
    def _generated_session_id(project_id: str) -> str:
        project_segment = project_id.removeprefix("project-")[:8]
        timestamp = base36(int(time.time() * 1000))
        return f"session-{project_segment}-{timestamp}-{str(uuid.uuid4())[:8]}"

    async def terminal(self, request: web.Request) -> web.WebSocketResponse:
        return await terminal_websocket(
            request,
            workspace_root=self.chump_config.workspace_root,
            allowed_origins=self.chump_config.allowed_origins,
        )

    def _stored_sessions(
        self,
        *,
        page: int = 1,
        page_size: int = 15,
        active_agents: dict[str, Any] | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        db_path = self.chump_config.data_dir / "chump.sqlite3"
        return stored_sessions(
            db_path,
            active_agents if active_agents is not None else self._agents,
            page=page,
            page_size=page_size,
        )

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
            if (
                self._active_connection_count() > 0
                or self._active_requests > 0
                or self._has_active_turn()
            ):
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
                if self.chump_config.verbose:
                    print(
                        f"[chump] no active clients for {timeout}s; shutting down managed server",
                        flush=True,
                    )
                await self.shutdown()
                return

    def _active_connection_count(self) -> int:
        return active_connection_count(list(self._agents.values())) + sum(
            runtime.active_connection_count()
            for runtime in self.workspace_runtimes.values()
        )

    def _has_active_turn(self) -> bool:
        return (
            any(self.is_agent_busy(agent_id) for agent_id in self._agents)
            or any(
                runtime.has_active_turn()
                for runtime in self.workspace_runtimes.values()
            )
        )

def main() -> None:
    arguments = sys.argv[1:]
    register_service = arguments == ["--register"]
    if arguments and not register_service:
        raise SystemExit(f"unknown chump-server argument: {arguments[0]}")
    set_process_title("Chump Agent (Server)")
    config = load_config()
    if register_service:
        config = replace(
            config,
            host="127.0.0.1",
            port=service_port(),
            managed_idle_timeout=None,
        )
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
    registration = (
        ServiceRegistration.create(
            host=config.host,
            port=config.port,
            server_version=_package_version("chump-server"),
            started_at=datetime.now(UTC).isoformat(),
        )
        if register_service
        else None
    )
    registration_store = ServiceRegistrationStore()
    server = ChumpServer(
        config,
        resources=resources,
        service_registration=registration,
        service_registration_store=registration_store,
    )
    try:
        server.serve(host=config.host, port=config.port)
    finally:
        if registration is not None:
            registration_store.clear(registration.instance_id)


def _package_version(package: str) -> str:
    try:
        return version(package)
    except PackageNotFoundError:
        return "0.0.0"


def service_port() -> int:
    raw = os.environ.get("CHUMP_SERVICE_PORT")
    if raw is None:
        return DEFAULT_SERVICE_PORT
    try:
        port = int(raw)
    except ValueError as error:
        raise ValueError(f"invalid CHUMP_SERVICE_PORT: {raw}") from error
    if port < 1 or port > 65_535:
        raise ValueError(f"invalid CHUMP_SERVICE_PORT: {raw}")
    return port


def parse_positive_int(value: str, name: str) -> int:
    try:
        parsed = int(value)
    except ValueError:
        raise web.HTTPBadRequest(text=f"{name} must be an integer")
    if parsed < 1:
        raise web.HTTPBadRequest(text=f"{name} must be at least 1")
    return parsed


async def read_optional_json_object(request: web.Request) -> dict[str, Any]:
    body = await request.content.read(MAX_JSON_BODY_BYTES + 1)
    if len(body) > MAX_JSON_BODY_BYTES:
        raise web.HTTPRequestEntityTooLarge(
            max_size=MAX_JSON_BODY_BYTES,
            actual_size=len(body),
        )
    if not body:
        return {}
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise web.HTTPBadRequest(text="request body must be valid JSON") from error
    if not isinstance(value, dict):
        raise web.HTTPBadRequest(text="request body must be a JSON object")
    return value


def base36(value: int) -> str:
    if value < 0:
        raise ValueError("base36 value must be non-negative")
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    encoded = ""
    while value:
        value, remainder = divmod(value, 36)
        encoded = alphabet[remainder] + encoded
    return encoded


if __name__ == "__main__":
    main()
