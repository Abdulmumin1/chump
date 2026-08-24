from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from chump_server.git_actions import (
    GitActionOptions,
    extract_pull_request_url,
    read_git_action_files,
    run_project_git_action,
)


def test_filters_unsafe_and_duplicate_file_paths() -> None:
    assert read_git_action_files(
        ["src/app.py", " src/app.py ", "../secret", "/tmp/file", "a\\..\\b", 4]
    ) == ("src/app.py",)


def test_extracts_a_pull_request_url() -> None:
    assert (
        extract_pull_request_url(
            "https://github.com/chump-dev/chump/pull/123\n",
            "",
        )
        == "https://github.com/chump-dev/chump/pull/123"
    )


@pytest.mark.asyncio
async def test_commits_only_selected_workspace_files(tmp_path: Path) -> None:
    run_git(tmp_path, "init")
    run_git(tmp_path, "config", "user.name", "Chump Test")
    run_git(tmp_path, "config", "user.email", "chump@example.com")
    selected = tmp_path / "selected.txt"
    unselected = tmp_path / "unselected.txt"
    selected.write_text("selected\n", encoding="utf-8")
    unselected.write_text("unselected\n", encoding="utf-8")

    result = await run_project_git_action(
        tmp_path,
        "commit",
        GitActionOptions(message="Selected change", files=("selected.txt",)),
    )

    assert result.ok is True
    assert run_git(tmp_path, "show", "--format=", "--name-only").stdout.strip() == "selected.txt"
    assert "unselected.txt" in run_git(tmp_path, "status", "--short").stdout


def run_git(workspace: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ("git", *args),
        cwd=workspace,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
