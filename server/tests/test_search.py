from pathlib import Path
import unittest

from chump_server.search import WorkspaceSearch


class FakeProcess:
    def __init__(self, *, returncode: int | None, missing_on_terminate: bool = False):
        self.returncode = returncode
        self.missing_on_terminate = missing_on_terminate
        self.terminate_calls = 0
        self.wait_calls = 0

    def terminate(self) -> None:
        self.terminate_calls += 1
        if self.missing_on_terminate:
            raise ProcessLookupError

    async def wait(self) -> int:
        self.wait_calls += 1
        return self.returncode or 0


class WorkspaceSearchShutdownTests(unittest.IsolatedAsyncioTestCase):
    async def test_close_does_not_signal_an_already_exited_process(self) -> None:
        search = WorkspaceSearch(Path("/workspace"))
        process = FakeProcess(returncode=0)
        search._process = process

        await search.close()

        self.assertIsNone(search._process)
        self.assertEqual(process.terminate_calls, 0)
        self.assertEqual(process.wait_calls, 1)

    async def test_close_tolerates_process_exit_racing_with_terminate(self) -> None:
        search = WorkspaceSearch(Path("/workspace"))
        process = FakeProcess(returncode=None, missing_on_terminate=True)
        search._process = process

        await search.close()

        self.assertIsNone(search._process)
        self.assertEqual(process.terminate_calls, 1)
        self.assertEqual(process.wait_calls, 1)
