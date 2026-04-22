from __future__ import annotations

from typing import Any

from ai_query import Message, stream_text
from ai_query.agents import Agent, SQLiteStorage, action
from ai_query.providers import anthropic, google, openai

from .config import ChumpConfig, load_config
from .tools import build_tools


SYSTEM_PROMPT = """You are Chump, a coding assistant working inside a local repository.

Inspect the codebase before changing it. Prefer precise edits over broad rewrites.
Stay concise in terminal responses. Use tools to inspect files, search, read, edit,
and run safe commands inside the workspace. Do not attempt destructive operations.
"""


def resolve_model(config: ChumpConfig):
    provider_name = config.provider.lower()
    if provider_name == "openai":
        return openai(config.model)
    if provider_name == "google":
        return google(config.model)
    if provider_name == "anthropic":
        return anthropic(config.model)
    raise ValueError(f"unsupported provider: {config.provider}")


class ChumpAgent(Agent[dict[str, Any]]):
    enable_event_log = True

    def __init__(self, id: str):
        config = load_config()
        config.data_dir.mkdir(parents=True, exist_ok=True)
        super().__init__(
            id,
            model=resolve_model(config),
            system=SYSTEM_PROMPT,
            storage=SQLiteStorage(str(config.data_dir / "chump.sqlite3")),
            initial_state={
                "workspace_root": str(config.workspace_root),
                "last_user_goal": None,
                "files_touched": [],
                "commands_run": [],
                "notes": [],
            },
            tools={},
        )
        self._config = config
        self.tools = build_tools(self, config)

    @action
    async def status(self) -> dict[str, Any]:
        return {
            "agent_id": self.id,
            "workspace_root": str(self._config.workspace_root),
            "provider": self._config.provider,
            "model": self._config.model,
        }

    @action
    async def clear_messages(self) -> dict[str, str]:
        await self.clear()
        return {"status": "ok"}

    async def chat(self, message: str, **kwargs: Any) -> str:
        chunks: list[str] = []
        async for chunk in self.stream(message, **kwargs):
            chunks.append(chunk)
        return "".join(chunks)

    async def stream(self, message: str, **kwargs: Any):
        self._messages.append(Message(role="user", content=message))
        await self.update_state(last_user_goal=message)

        result = stream_text(
            model=self.model,
            system=self.system,
            messages=self._messages,
            tools=self.tools if self.tools else None,
            provider_options=self.provider_options,
            on_step_start=self._on_step_start,
            on_step_finish=self._on_step_finish,
            **kwargs,
        )

        full_response = ""
        async for chunk in result.text_stream:
            full_response += chunk
            yield chunk

        self._messages.append(Message(role="assistant", content=full_response))
        await self.storage.set(
            f"{self.id}:messages",
            [message.to_dict() for message in self._messages],
        )

    async def _on_step_start(self, event) -> None:
        await self.emit("status", {"phase": "step_start", "step": event.step_number})

    async def _on_step_finish(self, event) -> None:
        payload = {
            "phase": "step_finish",
            "step": event.step_number,
            "tool_calls": [
                {"name": call.name, "arguments": call.arguments}
                for call in event.step.tool_calls
            ],
            "tool_results": [
                {"tool_name": result.tool_name, "is_error": result.is_error}
                for result in event.step.tool_results
            ],
        }
        await self.emit("status", payload)

