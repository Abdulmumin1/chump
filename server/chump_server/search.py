from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any


class WorkspaceSearch:
    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()

    async def files(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        result = await self._request(
            {"kind": "files", "query": query, "limit": max(1, min(limit, 100))}
        )
        return result if isinstance(result, list) else []

    async def content(
        self,
        query: str,
        *,
        path: str = "",
        mode: str = "plain",
        limit: int = 50,
        before_context: int = 0,
        after_context: int = 0,
    ) -> dict[str, Any]:
        result = await self._request(
            {
                "kind": "content",
                "query": query,
                "path": path,
                "mode": mode,
                "limit": max(1, min(limit, 200)),
                "beforeContext": max(0, min(before_context, 10)),
                "afterContext": max(0, min(after_context, 10)),
            }
        )
        return result if isinstance(result, dict) else {"matches": []}

    async def close(self) -> None:
        if self._process is None:
            return
        self._process.terminate()
        await self._process.wait()
        self._process = None

    async def _request(self, payload: dict[str, Any]) -> Any:
        async with self._lock:
            process = await self._ensure_process()
            request_id = uuid.uuid4().hex
            payload["id"] = request_id
            assert process.stdin is not None
            assert process.stdout is not None
            try:
                process.stdin.write((json.dumps(payload) + "\n").encode())
                await process.stdin.drain()
                raw = await asyncio.wait_for(process.stdout.readline(), timeout=15)
                if not raw:
                    self._process = None
                    raise RuntimeError("FFF search process stopped unexpectedly")
                response = json.loads(raw)
                if response.get("id") != request_id:
                    self._process = None
                    try:
                        process.terminate()
                    except ProcessLookupError:
                        pass
                    raise RuntimeError("FFF search returned an invalid response")
                if response.get("error"):
                    raise RuntimeError(str(response["error"]))
                return response.get("result")
            except Exception:
                self._process = None
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass
                raise

    async def _ensure_process(self) -> asyncio.subprocess.Process:
        if self._process is not None and self._process.returncode is None:
            return self._process
        raw_command = os.environ.get("CHUMP_FFF_COMMAND")
        if not raw_command:
            raise RuntimeError(
                "FFF search is unavailable; start the server through the Chump client"
            )
        command = json.loads(raw_command)
        if not isinstance(command, list) or not all(
            isinstance(item, str) for item in command
        ):
            raise RuntimeError("CHUMP_FFF_COMMAND must be a JSON string array")
        self._process = await asyncio.create_subprocess_exec(
            *command,
            cwd=self.workspace_root,
            env={**os.environ, "CHUMP_WORKSPACE_ROOT": str(self.workspace_root)},
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        return self._process
