from __future__ import annotations

import json
import sqlite3
import time
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from aiohttp import web
from ai_query.agents import AgentServer

from .agent import ChumpAgent
from .config import ChumpConfig, load_config


class ChumpServer(AgentServer):
    def __init__(self, config: ChumpConfig):
        super().__init__(ChumpAgent)
        self.chump_config = config
        self.started_at = time.time()

    def on_app_setup(self, app: web.Application) -> None:
        app.router.add_get("/health", self.health)
        app.router.add_get("/version", self.version)
        app.router.add_get("/sessions", self.sessions)

    async def health(self, request: web.Request) -> web.Response:
        return web.json_response({
            "status": "ok",
            "version": _package_version("chump-server"),
            "ai_query_version": _package_version("ai-query"),
            "workspace_root": str(self.chump_config.workspace_root),
            "data_dir": str(self.chump_config.data_dir),
            "provider": self.chump_config.provider,
            "model": self.chump_config.model,
            "max_steps": self.chump_config.max_steps,
            "command_timeout": self.chump_config.command_timeout,
            "reasoning": self.chump_config.reasoning,
            "verbose": self.chump_config.verbose,
            "active_sessions": len(self._agents),
            "uptime_seconds": round(time.time() - self.started_at, 3),
        })

    async def version(self, request: web.Request) -> web.Response:
        return web.json_response({
            "chump_server": _package_version("chump-server"),
            "ai_query": _package_version("ai-query"),
        })

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
            created_at = (
                state.get("created_at")
                if isinstance(state, dict)
                else None
            )
            updated_at = (
                state.get("updated_at")
                if isinstance(state, dict)
                else None
            )
            sessions.append({
                "id": session_id,
                "active": session_id in active_ids,
                "message_count": len(messages) if isinstance(messages, list) else 0,
                "event_count": len(event_log) if isinstance(event_log, list) else 0,
                "title": (
                    state.get("title")
                    if isinstance(state, dict)
                    else None
                ),
                "created_at": created_at if isinstance(created_at, (int, float)) else None,
                "updated_at": updated_at if isinstance(updated_at, (int, float)) else None,
                "last_user_goal": (
                    state.get("last_user_goal")
                    if isinstance(state, dict)
                    else None
                ),
                "last_activity": active_meta.last_activity if active_meta else None,
                "connections": active_meta.connection_count if active_meta else 0,
            })
        sessions.sort(
            key=lambda session: (
                session.get("updated_at") or session.get("created_at") or session.get("last_activity") or 0,
                session["id"],
            ),
            reverse=True,
        )
        return sessions


def main() -> None:
    config = load_config()
    if config.verbose:
        print(
            "[chump] "
            f"provider={config.provider} "
            f"model={config.model} "
            f"max_steps={config.max_steps} "
            f"command_timeout={config.command_timeout} "
            f"reasoning={config.reasoning} "
            f"workspace={config.workspace_root}",
            flush=True,
        )
    server = ChumpServer(config)
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
