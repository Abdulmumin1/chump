from __future__ import annotations

import unittest
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.patch_tool import AddFilePatch, UpdateFilePatch, parse_patch
from chump_server.safety import SafetyError, WorkspaceGuard
from chump_server.tools.view_image import bind_view_image, detect_image_type
from chump_server.tools._utils import (
    BASH_OUTPUT_BYTE_LIMIT,
    BASH_OUTPUT_LINE_LIMIT,
    DEFAULT_DIFF_CHANGE_LIMIT,
    _diff_metadata,
    _preview,
    _result_metadata,
    _truncate_command_output,
)


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


class ViewImageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

        async def wrap_tool(_name, _payload, runner):
            return await runner()

        self.tool = bind_view_image(WorkspaceGuard(self.root), wrap_tool)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_returns_multimodal_output_for_png(self) -> None:
        data = b"\x89PNG\r\n\x1a\n" + b"image data"
        (self.root / "sample.png").write_bytes(data)

        result = await self.tool.run(path="sample.png")

        self.assertEqual(result.content[1].image, data)
        self.assertEqual(result.content[1].media_type, "image/png")
        self.assertIn("ToolOutput", _preview(result))
        self.assertGreater(_result_metadata(result)["chars"], 0)

    async def test_rejects_non_image_content(self) -> None:
        (self.root / "sample.png").write_text("not an image", encoding="utf-8")

        with self.assertRaisesRegex(SafetyError, "unsupported image type"):
            await self.tool.run(path="sample.png")

    def test_detects_webp_by_container_signature(self) -> None:
        self.assertEqual(
            detect_image_type(b"RIFF\x00\x00\x00\x00WEBPpayload"),
            "image/webp",
        )


class CommandOutputTruncationTests(unittest.TestCase):
    def test_small_command_output_is_not_truncated(self) -> None:
        output = "\n".join(f"line {index}" for index in range(10))
        self.assertEqual(_truncate_command_output(output), output)

    def test_command_output_keeps_last_lines(self) -> None:
        output = "\n".join(f"line {index}" for index in range(BASH_OUTPUT_LINE_LIMIT + 25))

        truncated = _truncate_command_output(output)

        self.assertIn("command output truncated", truncated)
        self.assertIn(
            f"showing last {BASH_OUTPUT_LINE_LIMIT} of {BASH_OUTPUT_LINE_LIMIT + 25} lines",
            truncated,
        )
        self.assertNotIn("line 0", truncated)
        self.assertIn(f"line {BASH_OUTPUT_LINE_LIMIT + 24}", truncated)

    def test_command_output_respects_byte_limit(self) -> None:
        line = "x" * (BASH_OUTPUT_BYTE_LIMIT // 2)
        output = "\n".join([line, line, line])

        truncated = _truncate_command_output(output)

        self.assertIn("command output truncated", truncated)
        self.assertIn(f"showing last {BASH_OUTPUT_BYTE_LIMIT}", truncated)
        self.assertLessEqual(len(truncated.encode("utf-8")), BASH_OUTPUT_BYTE_LIMIT + 256)


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
