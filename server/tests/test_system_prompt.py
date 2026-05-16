from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.resources import ResourceCatalog
from chump_server.system_prompt import SYSTEM_PROMPT, build_system_prompt


class SystemPromptTests(unittest.TestCase):
    def test_build_system_prompt_includes_runtime_context_and_skills(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            workspace = root / "workspace"
            agent_dir = root / "agent-home"
            workspace.mkdir()
            agent_dir.mkdir()

            (workspace / "AGENTS.md").write_text("Use pnpm.\n", encoding="utf-8")
            skill_dir = workspace / ".chump" / "skills" / "demo-skill"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\n"
                "name: demo-skill\n"
                "description: Demo workflow for testing.\n"
                "---\n\n"
                "# Demo Skill\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"CHUMP_AGENT_DIR": str(agent_dir)}):
                catalog = ResourceCatalog(workspace)

            prompt = build_system_prompt(SYSTEM_PROMPT, catalog)
            self.assertIn("You are Chump, an interactive CLI coding agent", prompt)
            self.assertIn(
                "give a short report of what you changed, what you verified",
                prompt,
            )
            self.assertIn("# Project Context", prompt)
            self.assertIn("# Available Skills", prompt)
            self.assertIn("<name>demo-skill</name>", prompt)
            self.assertIn("# Runtime Context", prompt)
            self.assertIn("Current date:", prompt)
            self.assertIn(f"Current working directory: {workspace.resolve()}", prompt)


if __name__ == "__main__":
    unittest.main()
