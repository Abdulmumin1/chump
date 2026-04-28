from __future__ import annotations

import asyncio

from ai_query import Field, tool
from ai_query.types import AbortError

from ..config import ChumpConfig
from ..safety import WorkspaceGuard, validate_command
from ._utils import _terminate_process, _truncate


@tool(description="Run a shell command inside the workspace.")
async def bash(
    command: str = Field(description="Shell command to execute"),
    cwd: str = Field(
        description="Working directory relative to workspace root", default="."
    ),
) -> str:
    raise NotImplementedError("bash must be bound via bind_bash")


def bind_bash(
    guard: WorkspaceGuard,
    config: ChumpConfig,
    wrap_tool,
    note_command,
    agent,
):
    @tool(description="Run a shell command inside the workspace.")
    async def bash_impl(
        command: str = Field(description="Shell command to execute"),
        cwd: str = Field(
            description="Working directory relative to workspace root", default="."
        ),
    ) -> str:
        async def runner() -> str:
            validate_command(command)
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
            timeout_task = asyncio.create_task(asyncio.sleep(config.command_timeout))
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
                        f"command timed out after {config.command_timeout} seconds"
                    )

                stdout, stderr = communicate_task.result()
            finally:
                timeout_task.cancel()
                if abort_task:
                    abort_task.cancel()

            output = _truncate((stdout + stderr).decode().strip())
            if process.returncode != 0:
                raise RuntimeError(
                    output or f"command failed with exit code {process.returncode}"
                )
            return output or "(command produced no output)"

        return await wrap_tool("bash", {"command": command, "cwd": cwd}, runner)

    return bash_impl
