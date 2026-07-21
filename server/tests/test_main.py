from __future__ import annotations

import unittest
from pathlib import Path
import sys

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


class SessionPaginationParsingTests(unittest.TestCase):
    def test_accepts_positive_integers(self) -> None:
        self.assertEqual(parse_positive_int("30", "limit"), 30)

    def test_rejects_invalid_values(self) -> None:
        with self.assertRaises(web.HTTPBadRequest):
            parse_positive_int("zero", "page")
        with self.assertRaises(web.HTTPBadRequest):
            parse_positive_int("0", "page")


if __name__ == "__main__":
    unittest.main()
