from __future__ import annotations

from typing import Literal

from ai_query import Field, tool


def bind_search(search, wrap_tool):
    @tool(
        description=(
            "Search workspace file contents using FFF. Returns ranked path, line, "
            "column, and matching text entries. Prefer this over shell grep."
        )
    )
    async def search_impl(
        query: str = Field(description="Text or regular expression to search for"),
        path: str = Field(
            description="Optional FFF path or glob constraint", default=""
        ),
        mode: Literal["plain", "regex", "fuzzy"] = Field(
            description="Search matching mode", default="plain"
        ),
        limit: int = Field(description="Maximum matches to return", default=50),
        context: int = Field(
            description="Context lines before and after each match", default=0
        ),
    ) -> str:
        async def runner() -> str:
            result = await search.content(
                query,
                path=path,
                mode=mode,
                limit=limit,
                before_context=context,
                after_context=context,
            )
            matches = result.get("matches", [])
            if not matches:
                return "No matches found."
            lines: list[str] = []
            for match in matches:
                for text in match.get("before", []):
                    lines.append(f"{match['path']}-{text}")
                lines.append(
                    f"{match['path']}:{match['line']}:{match['column']}: "
                    f"{match['text']}"
                )
                for text in match.get("after", []):
                    lines.append(f"{match['path']}-{text}")
            total = result.get("totalMatched", len(matches))
            if total > len(matches):
                lines.append(f"[{total - len(matches)} additional matches omitted]")
            return "\n".join(lines)

        return await wrap_tool(
            "search",
            {
                "query": query,
                "path": path,
                "mode": mode,
                "limit": limit,
                "context": context,
            },
            runner,
        )

    return search_impl
