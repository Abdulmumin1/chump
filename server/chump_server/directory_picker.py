from __future__ import annotations

import asyncio
import re
import subprocess
import sys
from collections.abc import Sequence

PICKER_TIMEOUT_SECONDS = 5 * 60


async def pick_directory(platform: str | None = None) -> str | None:
    command = directory_picker_command(platform or sys.platform)
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=PICKER_TIMEOUT_SECONDS,
        )
    except subprocess.CalledProcessError as error:
        if picker_was_cancelled(error.returncode, error.stderr):
            return None
        raise
    return normalize_selection(completed.stdout)


def directory_picker_command(platform: str) -> Sequence[str]:
    if platform == "darwin":
        return (
            "osascript",
            "-e",
            'POSIX path of (choose folder with prompt "Choose a Chump project")',
        )
    if platform == "win32":
        script = " ".join(
            (
                "Add-Type -AssemblyName System.Windows.Forms;",
                "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
                "$dialog.Description = 'Choose a Chump project';",
                "if ($dialog.ShowDialog() -eq 'OK') { $dialog.SelectedPath }",
            )
        )
        return (
            "powershell.exe",
            "-NonInteractive",
            "-NoProfile",
            "-Command",
            script,
        )
    if platform.startswith("linux"):
        return (
            "zenity",
            "--file-selection",
            "--directory",
            "--title=Choose a Chump project",
        )
    raise RuntimeError(f"directory picker is unsupported on {platform}")


def normalize_selection(value: str) -> str | None:
    selected = value.strip().rstrip("/")
    return selected or None


def picker_was_cancelled(returncode: int, stderr: str | None) -> bool:
    return returncode == 1 or bool(
        stderr and re.search(r"cancel|user canceled", stderr, re.IGNORECASE)
    )
