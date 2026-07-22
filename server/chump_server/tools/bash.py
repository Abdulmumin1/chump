from __future__ import annotations

import asyncio

from ai_query import Field, tool
from ai_query.types import AbortError

from ..config import ChumpConfig
from ..safety import PathResolver, validate_command
from ._utils import _terminate_process, _truncate_command_output


MAX_BASH_TIMEOUT_SECONDS = 3_600


@tool(description="Run a shell command.")
async def bash(
    command: str = Field(description="Shell command to execute"),
    cwd: str = Field(
        description="Working directory; relative paths resolve from workspace root",
        default=".",
    ),
    timeout: int | None = Field(
        description=(
            "Timeout in seconds for this command (max 3600); "
            "defaults to the configured command timeout"
        ),
        default=None,
    ),
) -> str:
    raise NotImplementedError("bash must be bound via bind_bash")


def bind_bash(
    guard: PathResolver,
    config: ChumpConfig,
    wrap_tool,
    note_command,
    agent,
):
    @tool(description="Run a shell command.")
    async def bash_impl(
        command: str = Field(description="Shell command to execute"),
        cwd: str = Field(
            description="Working directory; relative paths resolve from workspace root",
            default=".",
        ),
        timeout: int | None = Field(
            description=(
                "Timeout in seconds for this command (max 3600); "
                "defaults to the configured command timeout"
            ),
            default=None,
        ),
    ) -> str:
        async def runner() -> str:
            validate_command(command)
            timeout_seconds = resolve_command_timeout(timeout, config.command_timeout)
            directory = guard.ensure_directory(cwd)
            if not directory.exists():
                raise RuntimeError(f"directory does not exist: {cwd}")

            await note_command(command)
            abort_signal = getattr(agent, "current_abort_signal", None)
            if abort_signal:
                abort_signal.throw_if_aborted()
            process = await asyncio.create_subprocess_shell(
                command,
                cwd=str(directory),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )

            communicate_task = asyncio.create_task(process.communicate())
            timeout_task = asyncio.create_task(asyncio.sleep(timeout_seconds))
            abort_task = (
                asyncio.create_task(abort_signal.wait())
                if abort_signal
                else None
            )
            try:
                wait_tasks = [communicate_task, timeout_task]
                if abort_task:
                    wait_tasks.append(abort_task)

                done, pending = await asyncio.wait(
                    wait_tasks,
                    return_when=asyncio.FIRST_COMPLETED,
                )

                for task in pending:
                    task.cancel()

                if abort_task and abort_task in done:
                    await _terminate_process(process)
                    raise AbortError(abort_signal.reason)

                if timeout_task in done:
                    await _terminate_process(process)
                    raise RuntimeError(
                        f"command timed out after {timeout_seconds} seconds"
                    )

                stdout, stderr = communicate_task.result()
            finally:
                timeout_task.cancel()
                if abort_task:
                    abort_task.cancel()

            output = _truncate_command_output((stdout + stderr).decode().strip())
            if process.returncode != 0:
                raise RuntimeError(
                    output or f"command failed with exit code {process.returncode}"
                )
            return output or "(command produced no output)"

        return await wrap_tool(
            "bash",
            {"command": command, "cwd": cwd, "timeout": timeout},
            runner,
        )

    return bash_impl


def resolve_command_timeout(requested: int | None, configured: int) -> int:
    timeout = configured if requested is None else requested
    if timeout <= 0:
        raise ValueError("bash timeout must be greater than zero seconds")
    if timeout > MAX_BASH_TIMEOUT_SECONDS:
        raise ValueError(
            f"bash timeout cannot exceed {MAX_BASH_TIMEOUT_SECONDS} seconds"
        )
    return timeout
