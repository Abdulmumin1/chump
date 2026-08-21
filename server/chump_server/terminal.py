from __future__ import annotations

import asyncio
import errno
import json
import os
import shutil
import signal
import struct
from pathlib import Path
from typing import Literal

from aiohttp import WSMsgType, web

MIN_COLS = 2
MAX_COLS = 500
MIN_ROWS = 1
MAX_ROWS = 300
MAX_INPUT_BYTES = 1024 * 1024
_READ_CHUNK_BYTES = 64 * 1024
_READ_QUEUE_CHUNKS = 64
TERMINAL_PROTOCOL = "chump-terminal-v1"
TerminalTheme = Literal["light", "dark"]


class TerminalUnavailableError(RuntimeError):
    pass


class PtySession:
    def __init__(
        self,
        master_fd: int,
        process: asyncio.subprocess.Process,
    ) -> None:
        self.master_fd = master_fd
        self.process = process
        self._loop = asyncio.get_running_loop()
        self._read_queue: asyncio.Queue[bytes | None] = asyncio.Queue(
            maxsize=_READ_QUEUE_CHUNKS
        )
        self._reader_active = False
        self._closed = False
        os.set_blocking(master_fd, False)
        self._resume_reader()

    @classmethod
    async def start(
        cls,
        workspace_root: Path,
        cols: int,
        rows: int,
        *,
        shell: str | None = None,
        theme: TerminalTheme | None = None,
    ) -> PtySession:
        if os.name != "posix":
            raise TerminalUnavailableError(
                "The web terminal currently requires macOS or Linux"
            )

        import pty

        shell_path = resolve_shell(shell)
        master_fd, slave_fd = pty.openpty()
        try:
            resize_pty(slave_fd, cols, rows)
            environment = os.environ.copy()
            environment.update(
                {
                    "TERM": "xterm-256color",
                    "COLORTERM": "truecolor",
                    "TERM_PROGRAM": "chump",
                }
            )
            if theme is not None:
                environment["CHUMP_THEME"] = theme
                environment["COLORFGBG"] = "0;15" if theme == "light" else "15;0"
            process = await asyncio.create_subprocess_exec(
                shell_path,
                cwd=workspace_root,
                env=environment,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                start_new_session=True,
            )
        except BaseException:
            os.close(master_fd)
            raise
        finally:
            os.close(slave_fd)
        return cls(master_fd, process)

    async def read(self) -> bytes | None:
        chunk = await self._read_queue.get()
        if not self._closed and not self._reader_active:
            self._resume_reader()
        return chunk

    async def write(self, data: bytes) -> None:
        if self._closed or not data:
            return
        view = memoryview(data)
        while view:
            try:
                written = os.write(self.master_fd, view)
                view = view[written:]
            except BlockingIOError:
                await self._wait_until_writable()
            except OSError as error:
                if error.errno in {errno.EBADF, errno.EIO}:
                    return
                raise

    def resize(self, cols: int, rows: int) -> None:
        if not self._closed:
            resize_pty(self.master_fd, cols, rows)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._remove_reader()
        self._loop.remove_writer(self.master_fd)
        try:
            os.close(self.master_fd)
        except OSError:
            pass
        if self._read_queue.empty():
            self._read_queue.put_nowait(None)
        await terminate_process_group(self.process)

    def _on_readable(self) -> None:
        try:
            chunk = os.read(self.master_fd, _READ_CHUNK_BYTES)
        except BlockingIOError:
            return
        except OSError as error:
            if error.errno not in {errno.EBADF, errno.EIO}:
                self._read_queue.put_nowait(None)
            self._remove_reader()
            if self._read_queue.empty():
                self._read_queue.put_nowait(None)
            return

        if not chunk:
            self._remove_reader()
            if self._read_queue.empty():
                self._read_queue.put_nowait(None)
            return

        self._read_queue.put_nowait(chunk)
        if self._read_queue.full():
            self._remove_reader()

    def _resume_reader(self) -> None:
        if self._closed or self._reader_active:
            return
        self._loop.add_reader(self.master_fd, self._on_readable)
        self._reader_active = True

    def _remove_reader(self) -> None:
        if self._reader_active:
            self._loop.remove_reader(self.master_fd)
            self._reader_active = False

    async def _wait_until_writable(self) -> None:
        ready = self._loop.create_future()

        def mark_ready() -> None:
            if not ready.done():
                ready.set_result(None)

        self._loop.add_writer(self.master_fd, mark_ready)
        try:
            await ready
        finally:
            self._loop.remove_writer(self.master_fd)


async def terminal_websocket(
    request: web.Request,
    *,
    workspace_root: Path,
    allowed_origins: tuple[str, ...],
) -> web.WebSocketResponse:
    origin = request.headers.get("Origin")
    if not is_allowed_terminal_origin(origin, allowed_origins):
        raise web.HTTPForbidden(text="terminal origin is not allowed")
    if TERMINAL_PROTOCOL not in offered_websocket_protocols(request):
        raise web.HTTPBadRequest(
            text=f"terminal websocket requires the {TERMINAL_PROTOCOL} protocol"
        )

    if os.name != "posix":
        raise web.HTTPNotImplemented(
            text="The web terminal currently requires macOS or Linux"
        )
    try:
        shell = resolve_shell()
    except TerminalUnavailableError as error:
        raise web.HTTPNotImplemented(text=str(error)) from error

    cols = parse_terminal_dimension(
        request.query.get("cols"), "cols", default=80, minimum=MIN_COLS, maximum=MAX_COLS
    )
    rows = parse_terminal_dimension(
        request.query.get("rows"), "rows", default=24, minimum=MIN_ROWS, maximum=MAX_ROWS
    )
    theme = parse_terminal_theme(request.query.get("theme"))

    ws = web.WebSocketResponse(
        protocols=(TERMINAL_PROTOCOL,),
        heartbeat=30,
        compress=False,
        max_msg_size=MAX_INPUT_BYTES,
    )
    await ws.prepare(request)
    if ws.ws_protocol != TERMINAL_PROTOCOL:
        await ws.close(code=1002, message=b"terminal protocol negotiation failed")
        return ws

    try:
        session = await PtySession.start(
            workspace_root, cols, rows, shell=shell, theme=theme
        )
    except (OSError, TerminalUnavailableError) as error:
        await ws.send_str(json.dumps({"type": "error", "message": str(error)}))
        await ws.close(code=1011, message=b"terminal unavailable")
        return ws

    output_task = asyncio.create_task(pump_pty_output(session, ws))
    try:
        async for message in ws:
            if message.type is WSMsgType.BINARY:
                await session.write(bytes(message.data))
            elif message.type is WSMsgType.TEXT:
                resize = parse_resize_message(message.data)
                if resize is None:
                    await ws.close(code=1003, message=b"invalid terminal control message")
                    break
                session.resize(*resize)
            elif message.type is WSMsgType.ERROR:
                break
    finally:
        output_task.cancel()
        await session.close()
        await asyncio.gather(output_task, return_exceptions=True)
    return ws


async def pump_pty_output(
    session: PtySession,
    ws: web.WebSocketResponse,
) -> None:
    while True:
        chunk = await session.read()
        if chunk is None:
            break
        await ws.send_bytes(chunk)
    exit_code = await session.process.wait()
    if not ws.closed:
        await ws.send_str(json.dumps({"type": "exit", "code": exit_code}))
        await ws.close()


def parse_resize_message(value: str) -> tuple[int, int] | None:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or payload.get("type") != "resize":
        return None
    try:
        cols = validated_dimension(payload.get("cols"), MIN_COLS, MAX_COLS)
        rows = validated_dimension(payload.get("rows"), MIN_ROWS, MAX_ROWS)
    except ValueError:
        return None
    return cols, rows


def parse_terminal_dimension(
    value: str | None,
    name: str,
    *,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    if value is None:
        return default
    try:
        return validated_dimension(value, minimum, maximum)
    except ValueError as error:
        raise web.HTTPBadRequest(
            text=f"{name} must be an integer from {minimum} to {maximum}"
        ) from error


def validated_dimension(value: object, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise ValueError("boolean is not a terminal dimension")
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as error:
        raise ValueError("invalid terminal dimension") from error
    if parsed < minimum or parsed > maximum:
        raise ValueError("terminal dimension is out of range")
    return parsed


def parse_terminal_theme(value: str | None) -> TerminalTheme | None:
    if value is None:
        return None
    if value == "light" or value == "dark":
        return value
    raise web.HTTPBadRequest(text="theme must be light or dark")


def resize_pty(fd: int, cols: int, rows: int) -> None:
    import fcntl
    import termios

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def resolve_shell(shell: str | None = None) -> str:
    candidate = shell or os.environ.get("SHELL")
    if candidate:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    for fallback in ("zsh", "bash", "sh"):
        resolved = shutil.which(fallback)
        if resolved:
            return resolved
    raise TerminalUnavailableError("No interactive shell was found")


def is_allowed_terminal_origin(
    origin: str | None,
    allowed_origins: tuple[str, ...],
) -> bool:
    if not origin:
        return False
    return origin in allowed_origins


def offered_websocket_protocols(request: web.Request) -> set[str]:
    return {
        protocol.strip()
        for header in request.headers.getall("Sec-WebSocket-Protocol", [])
        for protocol in header.split(",")
        if protocol.strip()
    }


async def terminate_process_group(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    for process_signal, timeout in (
        (signal.SIGHUP, 0.5),
        (signal.SIGTERM, 1.0),
        (signal.SIGKILL, 1.0),
    ):
        if process.returncode is not None:
            return
        try:
            os.killpg(process.pid, process_signal)
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), timeout=timeout)
            return
        except TimeoutError:
            continue
