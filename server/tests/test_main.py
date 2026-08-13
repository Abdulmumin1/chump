from __future__ import annotations

import json
import sqlite3
import unittest
from unittest.mock import AsyncMock, patch
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.managed_idle import is_resume_gap
from chump_server.main import ChumpServer, parse_positive_int
from aiohttp import web


class ManagedIdleShutdownTests(unittest.TestCase):
    def test_short_loop_gap_is_not_treated_as_resume(self) -> None:
        self.assertFalse(is_resume_gap(loop_gap=2, interval=1, timeout=30))

    def test_large_loop_gap_is_treated_as_resume(self) -> None:
        self.assertTrue(is_resume_gap(loop_gap=31, interval=1, timeout=30))

    def test_gap_threshold_respects_small_timeout(self) -> None:
        self.assertTrue(is_resume_gap(loop_gap=6, interval=1, timeout=5))

    def test_active_agent_turn_prevents_managed_idle_shutdown(self) -> None:
        server = object.__new__(ChumpServer)
        server._agents = {
            "parent": SimpleNamespace(
                agent=SimpleNamespace(_current_turn=SimpleNamespace(done=True))
            ),
            "delegated-child": SimpleNamespace(
                agent=SimpleNamespace(_current_turn=SimpleNamespace(done=False))
            ),
        }

        self.assertTrue(server._has_active_turn())

    def test_completed_agent_turn_allows_managed_idle_shutdown(self) -> None:
        server = object.__new__(ChumpServer)
        server._agents = {
            "parent": SimpleNamespace(
                agent=SimpleNamespace(_current_turn=SimpleNamespace(done=True))
            )
        }

        self.assertFalse(server._has_active_turn())


class ActiveRequestTrackingTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_stays_active_through_handler(self) -> None:
        server = object.__new__(ChumpServer)
        server._active_requests = 0
        request = type("Request", (), {})()

        async def handler(_request):
            self.assertEqual(server._active_requests, 1)
            return web.Response(status=200)

        response = await server._track_active_requests(request, handler)

        self.assertEqual(response.status, 200)
        self.assertEqual(server._active_requests, 0)

    async def test_agent_request_is_released_after_failure(self) -> None:
        server = object.__new__(ChumpServer)
        server._active_requests = 0
        request = type("Request", (), {})()

        async def handler(_request):
            raise RuntimeError("boom")

        with self.assertRaisesRegex(RuntimeError, "boom"):
            await server._track_active_requests(request, handler)
        self.assertEqual(server._active_requests, 0)


class McpConfigSyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_refreshes_the_agent_owned_by_each_server_entry(self) -> None:
        server = object.__new__(ChumpServer)
        refreshed: list[str] = []
        server.chump_config = SimpleNamespace(workspace_root=Path("/workspace"))
        sync_configs = AsyncMock()
        server.mcp = SimpleNamespace(sync_configs=sync_configs)
        server._agents = {
            "session-one": SimpleNamespace(
                agent=SimpleNamespace(
                    refresh_mcp_tools=lambda: refreshed.append("session-one")
                )
            )
        }

        with (
            patch("chump_server.main.load_mcp_server_configs", return_value={}),
            patch("chump_server.main.load_repo_config", return_value={}),
            patch("chump_server.main.load_global_config", return_value={}),
        ):
            await server._sync_mcp_config()

        sync_configs.assert_awaited_once_with({})
        self.assertEqual(refreshed, ["session-one"])


class SessionPaginationParsingTests(unittest.TestCase):
    def test_accepts_positive_integers(self) -> None:
        self.assertEqual(parse_positive_int("30", "limit"), 30)

    def test_rejects_invalid_values(self) -> None:
        with self.assertRaises(web.HTTPBadRequest):
            parse_positive_int("zero", "page")
        with self.assertRaises(web.HTTPBadRequest):
            parse_positive_int("0", "page")


class SessionEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_limits_interactive_session_pages_to_six(self) -> None:
        server = object.__new__(ChumpServer)
        server._agents = {}
        captured: dict[str, object] = {}

        def stored_sessions(**kwargs):
            captured.update(kwargs)
            return [], 10

        server._stored_sessions = stored_sessions
        request = type(
            "Request",
            (),
            {"query": {"page": "2", "limit": "100"}},
        )()

        response = await server.sessions(request)
        payload = json.loads(response.text)

        self.assertEqual(captured["page"], 2)
        self.assertEqual(captured["page_size"], 6)
        self.assertEqual(payload["page_size"], 6)
        self.assertEqual(payload["total_pages"], 2)

    async def test_session_snapshot_bypasses_the_active_agent_mailbox(self) -> None:
        server = object.__new__(ChumpServer)
        server.chump_config = SimpleNamespace(data_dir=Path("/missing"))
        snapshot = {
            "status": {"turn_running": True},
            "messages": [],
            "events": [{"id": 4, "type": "turn_status", "data": {}}],
        }
        agent = SimpleNamespace(
            _state={},
            capture_session_snapshot=lambda: snapshot,
        )
        server.get_or_create = lambda _agent_id: agent
        server._agents = {
            "running-child": SimpleNamespace(last_activity=0.0),
        }
        request = SimpleNamespace(match_info={"agent_id": "running-child"})

        response = await server.session_snapshot(request)

        self.assertEqual(json.loads(response.text), snapshot)
        self.assertGreater(server._agents["running-child"].last_activity, 0)

    async def test_session_snapshot_reconciles_terminal_delegated_children(
        self,
    ) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temporary_dir:
            data_dir = Path(temporary_dir)
            with sqlite3.connect(data_dir / "chump.sqlite3") as conn:
                conn.execute(
                    "CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT)"
                )
                conn.execute(
                    "INSERT INTO kv_store (key, value) VALUES (?, ?)",
                    (
                        "issue-227:state",
                        json.dumps(
                            {
                                "delegated_task_status": "completed",
                                "delegated_task_error": None,
                            }
                        ),
                    ),
                )

            server = object.__new__(ChumpServer)
            server.chump_config = SimpleNamespace(data_dir=data_dir)
            agent = SimpleNamespace(
                _state={},
                capture_session_snapshot=lambda: {
                    "status": {"turn_running": False, "steering_queue": []},
                    "messages": [],
                    "events": [
                        {
                            "id": 1,
                            "type": "turn_status",
                            "data": {"running": True, "steering_queue": []},
                        },
                        {
                            "id": 606,
                            "type": "tool_call",
                            "data": {
                                "name": "start_session",
                                "call_id": "start-227",
                                "args": {"session_id": "issue-227"},
                                "step": 5,
                                "index": 0,
                            },
                        },
                    ],
                },
            )
            server.get_or_create = lambda _agent_id: agent
            server._agents = {"parent": SimpleNamespace(last_activity=0.0)}
            request = SimpleNamespace(match_info={"agent_id": "parent"})

            response = await server.session_snapshot(request)
            payload = json.loads(response.text)

            self.assertEqual(payload["events"][-1]["type"], "turn_status")
            self.assertFalse(payload["events"][-1]["data"]["running"])
            self.assertEqual(
                payload["messages"][-1]["content"][0]["tool_result"]["status"],
                "completed",
            )


if __name__ == "__main__":
    unittest.main()
