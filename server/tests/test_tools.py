from __future__ import annotations

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.patch_tool import AddFilePatch, UpdateFilePatch, parse_patch
from chump_server.tools._utils import DEFAULT_DIFF_CHANGE_LIMIT, _diff_metadata


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


class PatchParserTests(unittest.TestCase):
    def test_accepts_patch_without_begin_end_envelope(self) -> None:
        operations = parse_patch(
            """*** Update File: README.md
@@
-old
+new"""
        )

        self.assertEqual(len(operations), 1)
        self.assertIsInstance(operations[0], UpdateFilePatch)

    def test_accepts_colonless_file_header(self) -> None:
        operations = parse_patch(
            """*** Begin Patch
*** Update File README.md
@@
-old
+new
*** End Patch"""
        )

        self.assertEqual(len(operations), 1)
        self.assertIsInstance(operations[0], UpdateFilePatch)

    def test_accepts_unprefixed_blank_context_lines(self) -> None:
        operations = parse_patch(
            """*** Update File: README.md
@@
 line before

 line after
-old
+new"""
        )

        self.assertEqual(len(operations), 1)
        operation = operations[0]
        self.assertIsInstance(operation, UpdateFilePatch)
        self.assertIn("", operation.hunks[0].old_lines)

    def test_accepts_unprefixed_context_lines(self) -> None:
        operations = parse_patch(
            """*** Update File: README.md
@@
unchanged line
-old
+new"""
        )

        self.assertEqual(len(operations), 1)
        operation = operations[0]
        self.assertIsInstance(operation, UpdateFilePatch)
        self.assertIn("unchanged line", operation.hunks[0].old_lines)
        self.assertIn("unchanged line", operation.hunks[0].new_lines)

    def test_accepts_fenced_patch_text(self) -> None:
        operations = parse_patch(
            """```patch
*** Add File: notes.txt
+hello
```
"""
        )

        self.assertEqual(len(operations), 1)
        self.assertIsInstance(operations[0], AddFilePatch)


if __name__ == "__main__":
    unittest.main()
