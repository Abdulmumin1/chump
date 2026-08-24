from __future__ import annotations

import asyncio
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

GitAction = Literal["commit-push", "commit", "push", "create-pr"]
COMMAND_TIMEOUT_SECONDS = 120


@dataclass(frozen=True)
class GitActionOptions:
    message: str | None = None
    files: tuple[str, ...] = ()
    pr_title: str | None = None
    pr_body: str | None = None
    draft: bool = False


@dataclass(frozen=True)
class GitActionResult:
    ok: bool
    stdout: str
    stderr: str
    message: str
    url: str | None = None

    def to_dict(self) -> dict[str, bool | str]:
        payload: dict[str, bool | str] = {
            "ok": self.ok,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "message": self.message,
        }
        if self.url is not None:
            payload["url"] = self.url
        return payload


async def run_project_git_action(
    workspace_path: Path,
    action: GitAction,
    options: GitActionOptions = GitActionOptions(),
) -> GitActionResult:
    return await asyncio.to_thread(
        _run_project_git_action,
        workspace_path,
        action,
        options,
    )


def read_git_action_files(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    files: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        path = item.strip()
        if (
            not path
            or Path(path).is_absolute()
            or "\0" in path
            or ".." in re.split(r"[\\/]", path)
        ):
            continue
        if path not in files:
            files.append(path)
    return tuple(files)


def _run_project_git_action(
    workspace_path: Path,
    action: GitAction,
    options: GitActionOptions,
) -> GitActionResult:
    commands = _git_action_commands(action, options)
    completed: list[subprocess.CompletedProcess[str]] = []
    try:
        for command in commands:
            completed.append(
                subprocess.run(
                    command,
                    cwd=workspace_path,
                    check=True,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=COMMAND_TIMEOUT_SECONDS,
                )
            )
    except (OSError, subprocess.SubprocessError) as error:
        stdout = _error_output(error, "stdout")
        stderr = _error_output(error, "stderr")
        return GitActionResult(
            ok=False,
            stdout=stdout,
            stderr=stderr,
            message=compact_git_output(stdout, stderr)
            or str(error)
            or "git push failed",
        )

    stdout = "\n".join(result.stdout for result in completed)
    stderr = "\n".join(result.stderr for result in completed)
    url = extract_pull_request_url(stdout, stderr) if action == "create-pr" else None
    return GitActionResult(
        ok=True,
        stdout=stdout,
        stderr=stderr,
        message=url or compact_git_output(stdout, stderr) or git_action_success_message(action),
        url=url,
    )


def _git_action_commands(
    action: GitAction,
    options: GitActionOptions,
) -> tuple[tuple[str, ...], ...]:
    if action in {"commit", "commit-push"}:
        commands = [
            ("git", "add", "-A", "--", *options.files),
            ("git", "commit", "-m", options.message or "Update workspace"),
        ]
        if action == "commit-push":
            commands.append(("git", "push", "-u", "origin", "HEAD"))
        return tuple(commands)
    if action == "push":
        return (("git", "push", "-u", "origin", "HEAD"),)
    return (("gh", *_build_create_pr_args(options)),)


def _build_create_pr_args(options: GitActionOptions) -> tuple[str, ...]:
    title = options.pr_title.strip() if options.pr_title else ""
    body = options.pr_body.strip() if options.pr_body else ""
    args = ["pr", "create", "--fill"]
    if title:
        args.extend(("--title", title))
    if body:
        args.extend(("--body", body))
    if options.draft:
        args.append("--draft")
    return tuple(args)


def extract_pull_request_url(stdout: str, stderr: str) -> str | None:
    match = re.search(r"https://github\.com/[^\s]+/pull/\d+", f"{stdout}\n{stderr}")
    return match.group(0) if match else None


def compact_git_output(stdout: str, stderr: str) -> str:
    lines = [
        line.strip()
        for line in f"{stdout}\n{stderr}".splitlines()
        if line.strip()
    ]
    return "\n".join(lines[-4:])


def git_action_success_message(action: GitAction) -> str:
    return {
        "commit-push": "Committed and pushed changes",
        "commit": "Committed changes",
        "push": "Pushed changes",
        "create-pr": "Created pull request",
    }[action]


def _error_output(error: BaseException, name: str) -> str:
    value = getattr(error, name, "")
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value if isinstance(value, str) else ""
