from __future__ import annotations

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.managed_idle import is_resume_gap


class ManagedIdleShutdownTests(unittest.TestCase):
    def test_short_loop_gap_is_not_treated_as_resume(self) -> None:
        self.assertFalse(is_resume_gap(loop_gap=2, interval=1, timeout=30))

    def test_large_loop_gap_is_treated_as_resume(self) -> None:
        self.assertTrue(is_resume_gap(loop_gap=31, interval=1, timeout=30))

    def test_gap_threshold_respects_small_timeout(self) -> None:
        self.assertTrue(is_resume_gap(loop_gap=6, interval=1, timeout=5))


if __name__ == "__main__":
    unittest.main()
