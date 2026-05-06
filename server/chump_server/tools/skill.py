from __future__ import annotations

from ai_query import Field, tool


@tool(
    description=(
        "Load a specialized skill that provides domain-specific instructions and "
        "workflows. Use this when the task matches one of the available skills."
    )
)
async def skill(
    name: str = Field(description="Skill name from the available_skills list"),
) -> str:
    raise NotImplementedError("skill must be bound via bind_skill")


def bind_skill(
    wrap_tool,
    get_skill,
    available_skills_text: str,
):
    description = (
        "Load a specialized skill that provides domain-specific instructions "
        "and workflows. Use this when the task matches one of the available "
        "skills.\n\nAvailable skills:\n"
        f"{available_skills_text}"
    )

    @tool(
        description=description
    )
    async def skill_impl(
        name: str = Field(description="Skill name from the available_skills list"),
    ) -> str:
        async def runner():
            loaded = get_skill(name)
            if loaded is None:
                raise ValueError(f"unknown skill: {name}")
            return loaded

        return await wrap_tool("skill", {"name": name}, runner)

    return skill_impl
