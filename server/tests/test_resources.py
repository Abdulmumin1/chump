from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chump_server.resources import ResourceCatalog, build_instruction_bundle


class ResourceCatalogTests(unittest.TestCase):
    def test_build_prompt_sections_includes_project_agents_only(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            workspace = root / "workspace"
            agent_dir = root / "agent-home"
            workspace.mkdir()
            agent_dir.mkdir()

            (workspace / "AGENTS.md").write_text("Use pnpm.\n", encoding="utf-8")
            skill_dir = workspace / ".agents" / "skills" / "demo-skill"
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

            prompt = catalog.build_prompt_sections()
            self.assertIn("# Project Context", prompt)
            self.assertIn("Follow them for every reply and action", prompt)
            self.assertIn(f"## {(workspace / 'AGENTS.md').resolve()}", prompt)
            self.assertIn("Use pnpm.", prompt)
            self.assertIn("# Available Skills", prompt)
            self.assertIn("<available_skills>", prompt)
            self.assertIn("<name>demo-skill</name>", prompt)
            self.assertIn(str((skill_dir / "SKILL.md").resolve()), prompt)

    def test_discovers_skills_from_chump_singular_and_plural_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            workspace = root / "workspace"
            agent_dir = root / "agent-home"
            workspace.mkdir()
            agent_dir.mkdir()

            singular_dir = workspace / ".chump" / "skill" / "singular-skill"
            singular_dir.mkdir(parents=True)
            (singular_dir / "SKILL.md").write_text(
                "---\n"
                "name: singular-skill\n"
                "description: Loaded from .chump/skill.\n"
                "---\n\n"
                "# Singular Skill\n",
                encoding="utf-8",
            )

            plural_dir = agent_dir / "skills" / "plural-skill"
            plural_dir.mkdir(parents=True)
            (plural_dir / "SKILL.md").write_text(
                "---\n"
                "name: plural-skill\n"
                "description: Loaded from global skills.\n"
                "---\n\n"
                "# Plural Skill\n",
                encoding="utf-8",
            )

            singular_global_dir = agent_dir / "skill" / "singular-global-skill"
            singular_global_dir.mkdir(parents=True)
            (singular_global_dir / "SKILL.md").write_text(
                "---\n"
                "name: singular-global-skill\n"
                "description: Loaded from global skill.\n"
                "---\n\n"
                "# Singular Global Skill\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"CHUMP_AGENT_DIR": str(agent_dir)}):
                catalog = ResourceCatalog(workspace)

            names = catalog.skill_names()
            self.assertIn("plural-skill", names)
            self.assertIn("singular-global-skill", names)
            self.assertIn("singular-skill", names)

    def test_instruction_files_for_path_finds_nearest_nested_instruction(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            workspace = root / "workspace"
            nested = workspace / "pkg" / "src"
            agent_dir = root / "agent-home"
            nested.mkdir(parents=True)
            agent_dir.mkdir()

            (workspace / "AGENTS.md").write_text("Root rules.\n", encoding="utf-8")
            (workspace / "pkg" / "AGENTS.md").write_text("Package rules.\n", encoding="utf-8")
            file_path = nested / "index.ts"
            file_path.write_text("export const x = 1;\n", encoding="utf-8")

            with patch.dict(os.environ, {"CHUMP_AGENT_DIR": str(agent_dir)}):
                catalog = ResourceCatalog(workspace)

            files = catalog.instruction_files_for_path(file_path)
            self.assertEqual([item.path.name for item in files], ["AGENTS.md"])
            self.assertIn("Package rules.", build_instruction_bundle(files))
            self.assertNotIn("Root rules.", build_instruction_bundle(files))

    def test_system_instructions_include_ancestor_files_like_pi(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ancestor = root / "parent"
            workspace = ancestor / "workspace"
            agent_dir = root / "agent-home"
            workspace.mkdir(parents=True)
            agent_dir.mkdir()

            (ancestor / "AGENTS.md").write_text("Ancestor rules.\n", encoding="utf-8")
            (workspace / "AGENTS.md").write_text("Workspace rules.\n", encoding="utf-8")

            with patch.dict(os.environ, {"CHUMP_AGENT_DIR": str(agent_dir)}):
                catalog = ResourceCatalog(workspace)

            prompt = catalog.build_instruction_prompt()
            self.assertIn("Ancestor rules.", prompt)
            self.assertIn("Workspace rules.", prompt)
            self.assertLess(
                prompt.index("Ancestor rules."),
                prompt.index("Workspace rules."),
            )


if __name__ == "__main__":
    unittest.main()
