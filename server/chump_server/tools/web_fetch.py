from __future__ import annotations

import asyncio
from html.parser import HTMLParser
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from ai_query import Field, tool

from ..safety import SafetyError
from ._utils import _truncate

MAX_WEB_FETCH_BYTES = 5 * 1024 * 1024


@tool(
    description=(
        "Fetches content from a specified URL. Takes a URL and optional format "
        "as input, fetches the URL content, converts to the requested format "
        "(markdown by default), and returns the content. Use this tool when you "
        "need to retrieve and analyze web content. The URL must be a fully formed "
        "valid URL. This tool is read-only and does not modify any files."
    )
)
async def web_fetch(
    url: str = Field(description="The URL to fetch content from"),
    format: Literal["markdown", "text", "html"] = Field(
        description="The format to return the content in", default="markdown"
    ),
    timeout: int = Field(
        description="Optional timeout in seconds (max 120)", default=30
    ),
) -> str:
    raise NotImplementedError("web_fetch must be bound via bind_web_fetch")


def bind_web_fetch(
    wrap_tool,
):
    @tool(
        description=(
            "Fetches content from a specified URL. Takes a URL and optional format "
            "as input, fetches the URL content, converts to the requested format "
            "(markdown by default), and returns the content. Use this tool when you "
            "need to retrieve and analyze web content. The URL must be a fully formed "
            "valid URL. This tool is read-only and does not modify any files."
        )
    )
    async def web_fetch_impl(
        url: str = Field(description="The URL to fetch content from"),
        format: Literal["markdown", "text", "html"] = Field(
            description="The format to return the content in", default="markdown"
        ),
        timeout: int = Field(
            description="Optional timeout in seconds (max 120)", default=30
        ),
    ) -> str:
        async def runner() -> str:
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise SafetyError("URL must start with http:// or https://")

            timeout_seconds = max(1, min(timeout, 120))
            return await asyncio.to_thread(
                _fetch_web_content,
                url,
                format,
                timeout_seconds,
            )

        return await wrap_tool(
            "web_fetch",
            {"url": url, "format": format, "timeout": timeout},
            runner,
        )

    return web_fetch_impl


def _fetch_web_content(
    url: str,
    output_format: Literal["markdown", "text", "html"],
    timeout: int,
) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "chump",
            "Accept": (
                "text/markdown, text/plain, text/html, "
                "application/xhtml+xml, */*;q=0.1"
            ),
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_WEB_FETCH_BYTES + 1)
            if len(raw) > MAX_WEB_FETCH_BYTES:
                raise SafetyError("response too large (exceeds 5MB limit)")
            content_type = response.headers.get("Content-Type", "").lower()
            charset = response.headers.get_content_charset() or "utf-8"
    except HTTPError as exc:
        raise SafetyError(f"web fetch failed: HTTP {exc.code}") from exc
    except URLError as exc:
        raise SafetyError(f"web fetch failed: {exc.reason}") from exc
    except OSError as exc:
        raise SafetyError(f"web fetch failed: {exc}") from exc

    try:
        text = raw.decode(charset, errors="replace")
    except LookupError:
        text = raw.decode("utf-8", errors="replace")

    if output_format == "html":
        return _truncate(text, limit=40_000)

    if "html" in content_type:
        parser = _HTMLTextExtractor(markdown=output_format == "markdown")
        parser.feed(text)
        parser.close()
        return _truncate(parser.get_text(), limit=40_000)

    return _truncate(text, limit=40_000)


class _HTMLTextExtractor(HTMLParser):
    def __init__(self, *, markdown: bool) -> None:
        super().__init__(convert_charrefs=True)
        self._markdown = markdown
        self._parts: list[str] = []
        self._href_stack: list[str | None] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        if tag in {"p", "div", "section", "article", "br", "li", "tr"}:
            self._newline()
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._newline()
            if self._markdown:
                self._parts.append("#" * int(tag[1]) + " ")
        if tag == "a":
            href = None
            for key, value in attrs:
                if key == "href":
                    href = value
                    break
            self._href_stack.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"}:
            if self._skip_depth > 0:
                self._skip_depth -= 1
            return
        if tag == "a" and self._href_stack:
            href = self._href_stack.pop()
            if href:
                self._parts.append(f" ({href})")
        if tag in {"p", "div", "section", "article", "li", "tr"}:
            self._newline()

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        text = " ".join(data.split())
        if not text:
            return
        if self._parts and not self._parts[-1].endswith(("\n", " ", "(")):
            self._parts.append(" ")
        self._parts.append(text)

    def get_text(self) -> str:
        text = "".join(self._parts)
        lines = [line.rstrip() for line in text.splitlines()]
        compacted: list[str] = []
        blank = False
        for line in lines:
            if not line:
                if compacted and not blank:
                    compacted.append("")
                blank = True
                continue
            compacted.append(line)
            blank = False
        return "\n".join(compacted).strip()

    def _newline(self) -> None:
        if not self._parts:
            return
        if not self._parts[-1].endswith("\n"):
            self._parts.append("\n")
