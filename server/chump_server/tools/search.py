from __future__ import annotations

from typing import Literal

from ai_query import Field, tool


def bind_search(search, wrap_tool):
    @tool(
        description=(
            "Search workspace file contents using FFF. The default plain mode "
            "matches literal text; set mode='regex' whenever query uses regex "
            "operators such as .*, |, ^, $, or character classes. Scope searches "
            "with a workspace-relative file, directory, or glob path such as "
            "'server', 'web/src/lib/chat', or 'client/src/**/*.ts' (omit './'). "
            "Returns ranked path, line, column, and matching text entries."
        )
    )
    async def search_impl(
        query: str = Field(
            description=(
                "Content query. Interpreted literally in plain mode. Regex syntax "
                "only works when mode is regex."
            )
        ),
        path: str = Field(
            description=(
                "Optional workspace-relative file, directory, or glob constraint. "
                "Use 'server' or 'web/src/lib/chat' for folders, not './server'."
            ),
            default="",
        ),
        mode: Literal["plain", "regex", "fuzzy"] = Field(
            description=(
                "Matching mode: plain for literal text (default), regex for .*, |, "
                "^, $, groups, or character classes, fuzzy for approximate text."
            ),
            default="plain",
        ),
        limit: int = Field(description="Maximum matches to return", default=50),
        context: int = Field(
            description="Context lines before and after each match", default=0
        ),
    ) -> str:
        async def runner():
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
                return ("No matches found.", {"matches": [], "totalMatched": 0, "totalFiles": 0})
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
            total_files = result.get("totalFiles", 0)
            if total > len(matches):
                lines.append(f"[{total - len(matches)} additional matches omitted]")
            structured = [
                {
                    "path": m["path"],
                    "line": m["line"],
                    "column": m["column"],
                    "text": m["text"],
                    "before": m.get("before", []),
                    "after": m.get("after", []),
                }
                for m in matches
            ]
            extra = {
                "matches": structured,
                "totalMatched": total,
                "totalFiles": total_files,
            }
            return ("\n".join(lines), extra)

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
