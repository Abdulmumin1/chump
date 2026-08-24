from __future__ import annotations

import subprocess
from types import SimpleNamespace

import pytest

from chump_server.directory_picker import (
    directory_picker_command,
    normalize_selection,
    pick_directory,
)


def test_builds_native_picker_commands() -> None:
    assert directory_picker_command("darwin")[0] == "osascript"
    assert directory_picker_command("win32")[0] == "powershell.exe"
    assert directory_picker_command("linux")[0] == "zenity"


def test_rejects_an_unsupported_platform() -> None:
    with pytest.raises(RuntimeError, match="unsupported"):
        directory_picker_command("plan9")


def test_normalizes_picker_output() -> None:
    assert normalize_selection(" /tmp/example/\n") == "/tmp/example"
    assert normalize_selection("\n") is None


@pytest.mark.asyncio
async def test_returns_the_selected_directory(monkeypatch) -> None:
    monkeypatch.setattr(
        "chump_server.directory_picker.subprocess.run",
        lambda *args, **kwargs: SimpleNamespace(stdout="/tmp/example/\n"),
    )

    assert await pick_directory("darwin") == "/tmp/example"


@pytest.mark.asyncio
async def test_returns_none_when_the_picker_is_cancelled(monkeypatch) -> None:
    def cancelled(*args, **kwargs):
        raise subprocess.CalledProcessError(1, args[0], stderr="User canceled")

    monkeypatch.setattr("chump_server.directory_picker.subprocess.run", cancelled)

    assert await pick_directory("darwin") is None
