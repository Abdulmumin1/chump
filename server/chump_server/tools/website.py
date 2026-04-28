from __future__ import annotations

from typing import Literal

from ai_query import Field, tool

from ._mcp_exa import call_exa_tool


@tool(
    description=(
        "Search the web using Exa and return summarized website context for a query. "
        "Use this when you need current web information, documentation, articles, or "
        "general website research that is not limited to a single URL."
    )
)
async def website(
    query: str = Field(description="Web search query"),
    num_results: int = Field(
        description="Number of search results to return", default=8
    ),
    livecrawl: Literal["fallback", "preferred"] = Field(
        description="Whether to prioritize live crawling", default="fallback"
    ),
    search_type: Literal["auto", "fast", "deep"] = Field(
        description="Search type", default="auto"
    ),
    context_max_characters: int | None = Field(
        description="Maximum context length optimized for LLMs",
        default=None,
    ),
) -> str:
    raise NotImplementedError("website must be bound via bind_website")


def bind_website(
    wrap_tool,
):
    @tool(
        description=(
            "Search the web using Exa and return summarized website context for a query. "
            "Use this when you need current web information, documentation, articles, or "
            "general website research that is not limited to a single URL."
        )
    )
    async def website_impl(
        query: str = Field(description="Web search query"),
        num_results: int = Field(
            description="Number of search results to return", default=8
        ),
        livecrawl: Literal["fallback", "preferred"] = Field(
            description="Whether to prioritize live crawling", default="fallback"
        ),
        search_type: Literal["auto", "fast", "deep"] = Field(
            description="Search type", default="auto"
        ),
        context_max_characters: int | None = Field(
            description="Maximum context length optimized for LLMs",
            default=None,
        ),
    ) -> str:
        async def runner() -> str:
            result = call_exa_tool(
                "web_search_exa",
                {
                    "query": query,
                    "type": search_type,
                    "numResults": max(1, min(num_results, 12)),
                    "livecrawl": livecrawl,
                    "contextMaxCharacters": context_max_characters,
                },
                timeout=25,
            )
            return result or "No search results found. Please try a different query."

        return await wrap_tool(
            "website",
            {
                "query": query,
                "num_results": num_results,
                "livecrawl": livecrawl,
                "search_type": search_type,
                "context_max_characters": context_max_characters,
            },
            runner,
        )

    return website_impl
