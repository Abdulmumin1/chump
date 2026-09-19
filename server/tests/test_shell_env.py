from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from chump_server import config as config_module
from chump_server import shell_env
from chump_server.shell_env import (
    parse_environment,
    probe_shell_environment,
    reset_login_environment,
    resolve_shell,
    shell_command,
    tool_environment,
)


class ParseEnvironmentTests(unittest.TestCase):
    def test_parses_nul_separated_entries(self) -> None:
        self.assertEqual(
            parse_environment(b"A=1\0B=two\0"),
            {"A": "1", "B": "two"},
        )

    def test_ignores_shell_noise_before_environment_dump(self) -> None:
        raw = b"welcome to your shell\n\x1eA=1\0not a key\0=value\0B=2\0"
        self.assertEqual(parse_environment(raw), {"A": "1", "B": "2"})


class ShellCommandTests(unittest.TestCase):
    def test_login_shells_run_as_login_shells(self) -> None:
        self.assertEqual(
            shell_command("/bin/zsh", "echo hi", Path("/tmp")),
            ["/bin/zsh", "-l", "-c", "echo hi"],
        )
        self.assertEqual(
            shell_command("/bin/bash", "echo hi", Path("/tmp")),
            ["/bin/bash", "-l", "-c", "echo hi"],
        )

    def test_other_shells_run_plain(self) -> None:
        self.assertEqual(
            shell_command("/usr/local/bin/fish", "echo hi", Path("/tmp")),
            ["/usr/local/bin/fish", "-c", "echo hi"],
        )


class ResolveShellTests(unittest.TestCase):
    def test_prefers_chump_shell_override(self) -> None:
        with patch.dict(os.environ, {"CHUMP_SHELL": "/bin/sh"}):
            self.assertEqual(resolve_shell(), "/bin/sh")

    def test_returns_a_path_on_supported_hosts(self) -> None:
        if os.name == "nt":
            self.skipTest("shell probing is POSIX only")
        resolved = resolve_shell()
        self.assertIsNotNone(resolved)
        self.assertTrue(Path(resolved).exists())


class ProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_probe_reads_environment_from_shell(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "fake-shell"
            script.write_text(
                "#!/bin/sh\nprintf '\\036PROBED=yes\\0PATH=/bin\\0'\n",
                encoding="utf-8",
            )
            script.chmod(0o755)

            environment = await probe_shell_environment(str(script))

        self.assertEqual(environment, {"PROBED": "yes", "PATH": "/bin"})

    async def test_probe_of_missing_shell_returns_none(self) -> None:
        self.assertIsNone(await probe_shell_environment("/nonexistent/shell"))


class ToolEnvironmentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        reset_login_environment()

    async def asyncTearDown(self) -> None:
        reset_login_environment()

    async def test_login_shell_values_override_server_values(self) -> None:
        with (
            patch.dict(os.environ, {"CHUMP_TEST_VALUE": "server"}),
            patch.object(
                shell_env,
                "login_shell_environment",
                AsyncMock(return_value={"CHUMP_TEST_VALUE": "shell"}),
            ),
        ):
            environment = await tool_environment()

        self.assertEqual(environment["CHUMP_TEST_VALUE"], "shell")

    async def test_drops_credentials_chump_injected(self) -> None:
        with (
            patch.dict(os.environ, {"SECRET_TOKEN": "provider-secret"}),
            patch.object(
                shell_env,
                "login_shell_environment",
                AsyncMock(return_value={"SECRET_TOKEN": "provider-secret"}),
            ),
            patch.object(
                config_module,
                "injected_auth_env_keys",
                return_value=frozenset({"SECRET_TOKEN"}),
            ),
        ):
            environment = await tool_environment()

        self.assertNotIn("SECRET_TOKEN", environment)
