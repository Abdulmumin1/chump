from __future__ import annotations

import json
from typing import Any

from ai_query import step_count_is, stream_text
from ai_query.agents import Agent, SQLiteStorage, action
from ai_query.providers import anthropic, google, openai
from ai_query.types import Message

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
            model=None,
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
            stop_when=step_count_is(config.max_steps),
        )
        self._config = config
        self.tools = build_tools(self, config)
        self._last_step_records: list[dict[str, Any]] = []

    @action
    async def status(self) -> dict[str, Any]:
        return {
            "agent_id": self.id,
            "workspace_root": str(self._config.workspace_root),
            "provider": self._config.provider,
            "model": self._config.model,
            "max_steps": self._config.max_steps,
            "verbose": self._config.verbose,
            "message_count": len(self.messages),
            "last_user_goal": self.state.get("last_user_goal"),
        }

    @action
    async def clear_messages(self) -> dict[str, str]:
        await self.clear()
        await self.update_state(last_user_goal=None)
        return {"status": "ok"}

    async def chat(self, message: str, **kwargs: Any) -> str:
        self._ensure_model()
        chunks: list[str] = []
        async for chunk in self.stream(message, **kwargs):
            chunks.append(chunk)
        return "".join(chunks)

    async def stream(self, message: str, **kwargs: Any):
        self._ensure_model()
        self._last_step_records = []
        self._log(f"chat start: {message}")
        self._messages.append(Message(role="user", content=message))
        await self.update_state(last_user_goal=message)

        result = stream_text(
            model=self.model,
            system=self.system,
            messages=self._messages,
            tools=self.tools if self.tools else None,
            stop_when=self.stop_when,
            provider_options=self.provider_options,
            on_step_start=self._on_step_start,
            on_step_finish=self._on_step_finish,
            **kwargs,
        )

        full_response = ""
        async for chunk in result.text_stream:
            full_response += chunk
            yield chunk

        if not full_response.strip():
            full_response = await self._build_empty_response_fallback(result)
            self._log(f"chat produced fallback response: {full_response}")
            yield full_response
        else:
            self._log(f"chat complete with {len(full_response)} chars")

        self._messages.append(Message(role="assistant", content=full_response))
        await self.storage.set(
            f"{self.id}:messages",
            [message.to_dict() for message in self._messages],
        )

    async def _on_step_start(self, event) -> None:
        self._log(f"step {event.step_number} start")
        await self.emit("status", {"phase": "step_start", "step": event.step_number})

    async def _on_step_finish(self, event) -> None:
        record = {
            "step": event.step_number,
            "text": event.step.text,
            "tool_calls": [
                {"name": call.name, "arguments": call.arguments}
                for call in event.step.tool_calls
            ],
            "tool_results": [
                {
                    "tool_name": result.tool_name,
                    "is_error": result.is_error,
                    "result": str(result.result),
                }
                for result in event.step.tool_results
            ],
            "finish_reason": event.step.finish_reason,
        }
        self._last_step_records.append(record)
        payload = {
            "phase": "step_finish",
            "step": event.step_number,
            "tool_calls": record["tool_calls"],
            "tool_results": [
                {
                    "tool_name": result["tool_name"],
                    "is_error": result["is_error"],
                }
                for result in record["tool_results"]
            ],
        }
        self._log(
            "step "
            f"{event.step_number} finish: "
            f"finish_reason={event.step.finish_reason!r} "
            f"text_chars={len(event.step.text)} "
            f"tool_calls={len(event.step.tool_calls)} "
            f"tool_results={len(event.step.tool_results)}"
        )
        for tool_call in record["tool_calls"]:
            self._log(
                "tool call: "
                f"{tool_call['name']} "
                f"{json.dumps(tool_call['arguments'], ensure_ascii=True)}"
            )
        for tool_result in record["tool_results"]:
            status = "error" if tool_result["is_error"] else "ok"
            preview = tool_result["result"].replace("\n", " ")
            if len(preview) > 240:
                preview = preview[:237] + "..."
            self._log(
                f"tool result [{status}] {tool_result['tool_name']}: {preview}"
            )
        await self.emit("status", payload)

    def _ensure_model(self) -> None:
        if self.model is None:
            self.model = resolve_model(self._config)

    async def _build_empty_response_fallback(self, result) -> str:
        steps = await result.steps
        if not steps and self._last_step_records:
            if any(step["tool_results"] for step in self._last_step_records):
                last_results = self._last_step_records[-1]["tool_results"]
                if last_results:
                    last_tool_result = last_results[-1]
                    if last_tool_result["is_error"]:
                        return (
                            "I did not finish the request. The last tool failed: "
                            f"{last_tool_result['result']}"
                        )

            tool_names = [
                call["name"]
                for step in self._last_step_records
                for call in step["tool_calls"]
            ]
            if tool_names:
                recent_tools = ", ".join(tool_names[-5:])
                return (
                    "I inspected the workspace but did not produce a final answer. "
                    f"Recent tool calls: {recent_tools}. "
                    "Check the server logs for the exact step trace."
                )

        if not steps:
            return (
                "I did not produce a response. The model returned no text and no"
                " tool activity."
            )

        last_step = steps[-1]
        if last_step.tool_results:
            last_result = last_step.tool_results[-1]
            if last_result.is_error:
                return (
                    "I did not finish the request. The last tool failed: "
                    f"{last_result.result}"
                )

        tool_names = [
            call.name
            for step in steps
            for call in step.tool_calls
        ]
        if tool_names:
            recent_tools = ", ".join(tool_names[-5:])
            return (
                "I inspected the workspace but did not produce a final answer. "
                f"Recent tool calls: {recent_tools}. "
                "Try `/events on` to watch tool activity, or raise "
                "`CHUMP_MAX_STEPS` if the task needs a longer loop."
            )

        return (
            "I did not produce a final answer for that request. "
            "Try again or enable `/events on` for more visibility."
        )

    def _log(self, message: str) -> None:
        if not self._config.verbose:
            return
        print(f"[chump:{self.id}] {message}", flush=True)
