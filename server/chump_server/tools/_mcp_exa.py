from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from ..safety import SafetyError


def call_exa_tool(tool: str, arguments: dict[str, object], timeout: int) -> str | None:
    endpoint = _exa_endpoint()
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool,
                "arguments": arguments,
            },
        }
    ).encode("utf-8")
    request = Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": "chump",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        raise SafetyError(f"website failed: HTTP {exc.code}") from exc
    except URLError as exc:
        raise SafetyError(f"website failed: {exc.reason}") from exc
    except OSError as exc:
        raise SafetyError(f"website failed: {exc}") from exc

    return _parse_sse_response(body)


def _exa_endpoint() -> str:
    api_key = os.environ.get("EXA_API_KEY")
    if api_key:
        return f"https://mcp.exa.ai/mcp?exaApiKey={quote(api_key)}"
    return "https://mcp.exa.ai/mcp"


def _parse_sse_response(body: str) -> str | None:
    for line in body.splitlines():
        if not line.startswith("data: "):
            continue
        raw = line[6:]
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            continue
        result = event.get("result")
        if not isinstance(result, dict):
            continue
        content = result.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text:
                return text
    return None
