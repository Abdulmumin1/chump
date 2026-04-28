from __future__ import annotations

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.tools import DEFAULT_DIFF_CHANGE_LIMIT, _diff_metadata


class DiffMetadataTests(unittest.TestCase):
    def test_medium_rewrite_is_not_truncated(self) -> None:
        before = "\n".join(f"before {index}" for index in range(120))
        after = "\n".join(f"after {index}" for index in range(120))

        diff = _diff_metadata("demo.txt", before, after)

        self.assertFalse(diff["truncated"])
        self.assertEqual(diff["shown_changes"], diff["total_changes"])
        self.assertEqual(diff["added"], 120)
        self.assertEqual(diff["removed"], 120)
        self.assertEqual(len(diff["changes"]), 240)

    def test_huge_rewrite_reports_hidden_change_count(self) -> None:
        line_count = DEFAULT_DIFF_CHANGE_LIMIT + 50
        before = "\n".join(f"before {index}" for index in range(line_count))
        after = "\n".join(f"after {index}" for index in range(line_count))

        diff = _diff_metadata("demo.txt", before, after)

        self.assertTrue(diff["truncated"])
        self.assertEqual(diff["shown_changes"], DEFAULT_DIFF_CHANGE_LIMIT)
        self.assertEqual(diff["total_changes"], line_count * 2)
        self.assertEqual(len(diff["changes"]), DEFAULT_DIFF_CHANGE_LIMIT)


if __name__ == "__main__":
    unittest.main()
