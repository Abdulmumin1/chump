"""Resolve the user's login-shell environment for command execution.

The agent's ``bash`` tool must behave like the user's own shell. A background
Chump server snapshots its environment when it starts, so anything the user's
login shell sets afterwards (credentials, tool paths) is invisible. We probe the
user's shell once, cache the result, and run commands through that shell instead
of the platform default ``/bin/sh``.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path

SHELL_PROBE_TIMEOUT_SECONDS = 5.0
_ENVIRONMENT_SENTINEL = "\x1e"
_LOGIN_SHELL_NAMES = {"zsh", "bash", "sh", "dash", "ksh"}

_login_environment: dict[str, str] | None = None
_probe_lock: asyncio.Lock | None = None
_probed = False


def resolve_shell() -> str | None:
    """Return the user's interactive shell, or ``None`` on unsupported hosts."""
    if os.name == "nt":
        return None
    configured = os.environ.get("CHUMP_SHELL")
    for candidate in (configured, os.environ.get("SHELL")):
        if candidate:
            resolved = shutil.which(candidate)
            if resolved:
                return resolved
    for fallback in ("zsh", "bash", "sh"):
        resolved = shutil.which(fallback)
        if resolved:
            return resolved
    return None


def reset_login_environment() -> None:
    """Clear the cached probe so the next call re-reads the shell."""
    global _login_environment, _probe_lock, _probed
    _login_environment = None
    _probe_lock = None
    _probed = False


async def login_shell_environment() -> dict[str, str] | None:
    """Probe and cache the user's login/interactive shell environment."""
    global _login_environment, _probe_lock, _probed
    if _probed:
        return _login_environment
    if _probe_lock is None:
        _probe_lock = asyncio.Lock()
    async with _probe_lock:
        if not _probed:
            shell = resolve_shell()
            _login_environment = (
                await probe_shell_environment(shell) if shell is not None else None
            )
            _probed = True
    return _login_environment


async def tool_environment() -> dict[str, str]:
    """Environment for tool subprocesses.

    Starts from the server environment, lets the user's login shell override it,
    and removes provider credentials Chump injected for its own model calls so
    they cannot shadow the user's tooling (for example Wrangler's OAuth session).
    """
    from .config import injected_auth_env_keys

    environment = dict(os.environ)
    probed = await login_shell_environment()
    if probed:
        environment.update(probed)
    for key in injected_auth_env_keys():
        environment.pop(key, None)
    return environment


async def probe_shell_environment(shell: str) -> dict[str, str] | None:
    for mode in ("-il", "-l"):
        environment = await _probe_shell(shell, mode)
        if environment:
            return environment
    return None


async def _probe_shell(shell: str, mode: str) -> dict[str, str] | None:
    try:
        process = await asyncio.create_subprocess_exec(
            shell,
            mode,
            "-c",
            "printf '\\036'; env -0",
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError:
        return None
    try:
        stdout, _ = await asyncio.wait_for(
            process.communicate(),
            SHELL_PROBE_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        await _kill(process)
        return None
    if process.returncode != 0:
        return None
    parsed = parse_environment(stdout)
    return parsed or None


def parse_environment(raw: bytes) -> dict[str, str]:
    text = raw.decode(errors="replace")
    if _ENVIRONMENT_SENTINEL in text:
        text = text.split(_ENVIRONMENT_SENTINEL, 1)[1]
    environment: dict[str, str] = {}
    for entry in text.split("\0"):
        if not entry or "=" not in entry:
            continue
        key, value = entry.split("=", 1)
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            environment[key] = value
    return environment


def shell_command(shell: str, command: str, directory: Path) -> list[str]:
    """Build an argv that runs ``command`` in ``directory`` via ``shell``."""
    name = Path(shell).name.lower()
    if name in _LOGIN_SHELL_NAMES:
        return [shell, "-l", "-c", command]
    return [shell, "-c", command]


async def _kill(process: asyncio.subprocess.Process) -> None:
    try:
        process.kill()
    except ProcessLookupError:
        return
    await process.wait()
