from __future__ import annotations

import asyncio
import json
import os
import time
import traceback
from dataclasses import replace
from typing import Any, AsyncIterator

from ai_query import RetryPolicy, step_count_is
from ai_query.agents import Agent, AgentTurn, SQLiteStorage, TurnOptions, action
from ai_query.providers import anthropic, google, openai, workers_ai, deepseek
from ai_query.model import LanguageModel
from ai_query.providers.deepseek.provider import DeepSeekProvider
from ai_query.types import AbortSignal, ImagePart, Message, ProviderOptions, TextPart

from .codex_provider import codex_model
from .config import (
    DEFAULT_CHUMP_CLOUD_BASE_URL,
    ChumpConfig,
    auth_file_path,
    load_auth_config,
    load_config,
)
from .resources import ResourceCatalog, build_skill_bundle
from .system_prompt import SYSTEM_PROMPT, build_system_prompt
from .tools import build_tools
from .git_utils import get_git_branch


def resolve_model(config: ChumpConfig):
    provider_name = config.provider.lower()
    if provider_name == "codex":
        return codex_model(
            config.model,
            auth_path=auth_file_path(),
            auth_config=load_auth_config(),
        )
    if provider_name == "openai":
        return openai(
            config.model,
            base_url=os.environ.get("OPENAI_BASE_URL"),
            organization=os.environ.get("OPENAI_ORGANIZATION"),
        )
    if provider_name == "chump_cloud":
        return LanguageModel(
            provider=ChumpCloudProvider(
                api_key="chump-cloud",
                base_url=os.environ.get("CHUMP_CLOUD_BASE_URL")
                or os.environ.get("OPENAI_BASE_URL")
                or DEFAULT_CHUMP_CLOUD_BASE_URL,
            ),
            model_id=config.model,
        )
    if provider_name == "google":
        return google(config.model)
    if provider_name == "anthropic":
        return anthropic(config.model, base_url=os.environ.get("ANTHROPIC_BASE_URL"))
    if provider_name == "workers_ai":
        return workers_ai(config.model)
    if provider_name == "deepseek":
        return deepseek(config.model)
    raise ValueError(f"unsupported provider: {config.provider}")


class ChumpCloudProvider(DeepSeekProvider):
    name = "chump_cloud"

    def __init__(self, *, api_key: str, base_url: str) -> None:
        super().__init__(api_key=api_key)
        self.base_url = base_url


class ChumpAgent(Agent[dict[str, Any]]):
    enable_event_log = True
    _server_config: ChumpConfig | None = None
    _server_resources: ResourceCatalog | None = None

    @classmethod
    def configure(cls, config: ChumpConfig, resources: ResourceCatalog) -> None:
        cls._server_config = config
        cls._server_resources = resources

    def __init__(self, id: str):
        config = self._server_config or load_config()
        config.data_dir.mkdir(parents=True, exist_ok=True)
        resources = self._server_resources or ResourceCatalog(config.workspace_root)
        now = time.time()
        super().__init__(
            id,
            model=None,
            system=build_system_prompt(SYSTEM_PROMPT, resources),
            storage=SQLiteStorage(str(config.data_dir / "chump.sqlite3")),
            initial_state={
                "workspace_root": str(config.workspace_root),
                "title": None,
                "created_at": now,
                "updated_at": now,
                "last_user_goal": None,
                "files_touched": [],
                "read_files": {},
                "commands_run": [],
                "notes": [],
            },
            tools={},
            stop_when=step_count_is(config.max_steps),
            reasoning=config.reasoning,
        )
        self._config = config
        self._resources = resources
        self.tools = build_tools(self, config, resources)
        self._last_step_records: list[dict[str, Any]] = []
        self._current_turn: AgentTurn | None = None
        self._pending_steering_events: list[dict[str, Any]] = []
        self._steering_lock = asyncio.Lock()
        self._turn_instruction_claims: set[str] = set()

    @action
    async def status(self) -> dict[str, Any]:
        return {
            "agent_id": self.id,
            "workspace_root": str(self._config.workspace_root),
            "git_branch": get_git_branch(self._config.workspace_root),
            "provider": self._config.provider,
            "model": self._config.model,
            "max_steps": self._config.max_steps,
            "retry": self._retry_status(),
            "command_timeout": self._config.command_timeout,
            "managed_idle_timeout": self._config.managed_idle_timeout,
            "reasoning": self._config.reasoning,
            "verbose": self._config.verbose,
            "message_count": len(self.messages),
            "title": self.state.get("title"),
            "created_at": self.state.get("created_at"),
            "updated_at": self.state.get("updated_at"),
            "last_user_goal": self.state.get("last_user_goal"),
            "turn_running": self._current_turn is not None and not self._current_turn.done,
            "steering_queue": list(self._pending_steering_events),
            "instruction_files": [
                str(item.path) for item in self._resources.system_instructions
            ],
            "skills": [
                {"name": item.name, "description": item.description}
                for item in self._resources.skills
            ],
        }

    @action
    async def clear_messages(self) -> dict[str, str]:
        now = time.time()
        await self.clear()
        await self.update_state(last_user_goal=None, read_files={}, updated_at=now)
        return {"status": "ok"}

    @action
    async def load_skill(self, name: str, args: str = "") -> dict[str, str]:
        skill = self._resources.get_skill(name)
        if skill is None:
            raise ValueError(f"unknown skill: {name}")
        prompt = build_skill_bundle(skill)
        extra = args.strip()
        if extra:
            prompt = f"{prompt}\n\nUser: {extra}"
        return {"name": skill.name, "prompt": prompt}

    @action
    async def event_log(self) -> dict[str, Any]:
        return {"events": list(self._event_log)}

    @action
    async def abort_current_turn(self) -> dict[str, Any]:
        turn = self._current_turn
        if turn is None:
            return {"status": "idle"}
        turn.abort("aborted by user")
        return {"status": "aborting"}

    @action
    async def steer_current_turn(
        self,
        message: str,
        attachments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        turn = self._current_turn
        if turn is None or turn.done:
            return {"status": "idle"}
        content = build_user_content(message, attachments or [])
        async with self._steering_lock:
            if turn is not self._current_turn or turn.done:
                return {"status": "idle"}
            await turn.steer(content)
            self._pending_steering_events.append(
                {
                    "content": message,
                    "attachments": summarize_attachments(attachments or []),
                    "steered": True,
                }
            )
            await self._emit_steering_queue()
        now = time.time()
        await self.update_state(updated_at=now, last_user_goal=message)
        self._log(f"steer queued: {message} attachments={len(attachments or [])}")
        return {"status": "steered"}

    @action
    async def cancel_last_steering(self) -> dict[str, Any]:
        return await self.cancel_steering()

    @action
    async def cancel_steering(self, index: int | None = None) -> dict[str, Any]:
        turn = self._current_turn
        if turn is None or turn.done or not self._pending_steering_events:
            return {"status": "idle"}
        async with self._steering_lock:
            if turn is not self._current_turn or turn.done or not self._pending_steering_events:
                return {"status": "idle"}
            target_index = len(self._pending_steering_events) - 1 if index is None else index
            if target_index < 0 or target_index >= len(self._pending_steering_events):
                raise ValueError("queued steering index is out of range")
            removed = await remove_queued_message_at(turn._steering, target_index)
            if removed:
                self._pending_steering_events.pop(target_index)
            await self._emit_steering_queue()
        self._log(f"steer canceled: index={target_index} removed={removed}")
        return {"status": "canceled" if removed else "missed"}

    @action
    async def set_model(self, provider: str, model: str) -> dict[str, Any]:
        from .config import (
            apply_auth_environment,
            load_auth_config,
            normalize_model_name,
            normalize_provider_name,
            normalize_reasoning_config,
        )

        provider_name = normalize_provider_name(provider)
        model_name = normalize_model_name(provider_name, model)
        auth_config = load_auth_config()
        apply_auth_environment(auth_config, provider_name)
        reasoning = normalize_reasoning_config(
            auth_config.get("reasoning"), provider_name
        )
        self._config = replace(
            self._config,
            provider=provider_name,
            model=model_name,
            reasoning=reasoning,
        )
        self.model = resolve_model(self._config)
        self.reasoning = reasoning
        status = await self.status()
        await self.emit("agent_status", status)
        return status

    @action
    async def set_reasoning(self, mode: str) -> dict[str, Any]:
        from .config import normalize_reasoning_config

        self._config = replace(
            self._config,
            reasoning=normalize_reasoning_config({"mode": mode}, self._config.provider),
        )
        self.reasoning = self._config.reasoning
        status = await self.status()
        await self.emit("agent_status", status)
        return status

    @property
    def current_abort_signal(self) -> AbortSignal | None:
        turn = self._current_turn
        return turn._controller.signal if turn else None

    async def chat(
        self,
        message: str,
        *,
        attachments: list[dict[str, Any]] | None = None,
        signal: AbortSignal | None = None,
        **kwargs: Any,
    ) -> str:
        chunks: list[str] = []
        async for chunk in self.stream(
            message,
            attachments=attachments,
            signal=signal,
            **kwargs,
        ):
            chunks.append(chunk)
        return "".join(chunks)

    async def stream(
        self,
        message: str,
        *,
        attachments: list[dict[str, Any]] | None = None,
        signal: AbortSignal | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        turn = await self._start_turn(
            message, attachments=attachments, signal=signal, **kwargs
        )
        try:
            full_response = ""
            async for event in turn.events():
                if event.type == "text.delta":
                    full_response += event.text
                    await self.emit("assistant_text", {"content": event.text})
                    yield event.text
                    continue
                if event.type == "step.started":
                    await self._on_step_start(event)
                    continue
                if event.type == "step.finished":
                    await self._on_step_finish(event)
                    continue

            result = await turn.result()
            final_response = await self._finalize_turn(result, full_response)
            if not full_response.strip():
                await self.emit("assistant_text", {"content": final_response})
                yield final_response
        finally:
            if self._current_turn is turn:
                self._current_turn = None
            await self._emit_turn_status(False)

    async def _start_turn(
        self,
        message: str,
        *,
        attachments: list[dict[str, Any]] | None = None,
        signal: AbortSignal | None = None,
        **kwargs: Any,
    ) -> AgentTurn:
        self._ensure_model()
        self._last_step_records = []
        self._turn_instruction_claims = set()
        raw_attachments = attachments or []
        valid_attachments = [
            item for item in raw_attachments if is_image_attachment(item)
        ]
        self._log(
            f"chat start: {message} attachments={len(valid_attachments)}/{len(raw_attachments)}"
        )
        content = build_user_content(message, attachments or [])
        await self.emit(
            "user_message",
            {
                "content": message,
                "attachments": summarize_attachments(attachments or []),
            },
        )
        now = time.time()
        created_at = self.state.get("created_at")
        title = self.state.get("title")
        await self.update_state(
            title=title or build_session_title(message),
            created_at=created_at if isinstance(created_at, (int, float)) else now,
            updated_at=now,
            last_user_goal=message,
        )
        options = TurnOptions(
            provider_options=self._turn_provider_options(),
            retry=self._retry_policy(),
            signal=signal,
        )
        turn = self.turn(content, options=options)
        self._current_turn = turn
        await self._emit_turn_status(True)
        return turn

    def _retry_policy(self) -> RetryPolicy | None:
        if self._config.retry_max_attempts <= 1:
            return None
        return RetryPolicy(
            max_attempts=self._config.retry_max_attempts,
            initial_delay=self._config.retry_initial_delay,
            max_delay=self._config.retry_max_delay,
            backoff=self._config.retry_backoff,
            jitter=self._config.retry_jitter,
        )

    def _retry_status(self) -> dict[str, Any]:
        return {
            "max_attempts": self._config.retry_max_attempts,
            "initial_delay": self._config.retry_initial_delay,
            "max_delay": self._config.retry_max_delay,
            "backoff": self._config.retry_backoff,
            "jitter": self._config.retry_jitter,
        }

    async def handle_request_stream(
        self, request: dict[str, Any]
    ) -> AsyncIterator[str]:
        if self._state is None:
            await self.start()

        if request.get("action", "chat") != "chat":
            yield 'event: error\ndata: "Streaming not supported for this action"\n\n'
            return

        message = request.get("message", "")
        attachments = request.get("attachments", [])
        if not isinstance(attachments, list):
            attachments = []

        try:
            yield "event: start\ndata: \n\n"

            full_text = ""
            async for chunk in self.stream(
                message,
                attachments=attachments,
            ):
                full_text += chunk
                yield f"event: chunk\ndata: {json.dumps(chunk)}\n\n"

            yield f"event: end\ndata: {json.dumps(full_text)}\n\n"
        except Exception as exc:
            self._log(
                "chat error: "
                f"{type(exc).__name__}: {exc!r}\n"
                f"{''.join(traceback.format_exception(exc))}"
            )
            yield f"event: error\ndata: {json.dumps(self._format_chat_error(exc))}\n\n"

    async def _finalize_turn(self, result: Any, full_response: str) -> str:
        if not full_response.strip():
            full_response = await self._build_empty_response_fallback(result)
            self._log(f"chat produced fallback response: {full_response}")
        else:
            self._log(f"chat complete with {len(full_response)} chars")

        return full_response

    def _turn_provider_options(self) -> ProviderOptions | None:
        provider_options: ProviderOptions = dict(self.provider_options or {})
        if self._config.provider == "codex":
            codex_options = dict(provider_options.get("codex") or {})
            codex_options.setdefault("instructions", self.system)
            provider_options["codex"] = codex_options
        return provider_options or None

    async def _on_step_start(self, event) -> None:
        self._log(f"step {event.step_number} start")
        async with self._steering_lock:
            while self._pending_steering_events:
                await self.emit("user_message", self._pending_steering_events.pop(0))
                await self._emit_steering_queue()
        await self.emit("status", {"phase": "step_start", "step": event.step_number})

    async def _emit_steering_queue(self) -> None:
        await self.emit(
            "steering_queue",
            {
                "items": list(self._pending_steering_events),
            },
        )

    async def _emit_turn_status(self, running: bool) -> None:
        await self.emit(
            "turn_status",
            {
                "running": running,
                "steering_queue": list(self._pending_steering_events),
            },
        )

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
            self._log(f"tool result [{status}] {tool_result['tool_name']}: {preview}")
        await self.emit("status", payload)

    def _ensure_model(self) -> None:
        if self.model is None:
            self.model = resolve_model(self._config)

    async def _build_empty_response_fallback(self, result) -> str:
        result_steps = getattr(result, "steps", None)
        steps = result_steps if isinstance(result_steps, list) else await result.steps
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

        tool_names = [call.name for step in steps for call in step.tool_calls]
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

    def _format_chat_error(self, exc: BaseException) -> str:
        text = str(exc).strip()
        if text:
            return text
        return f"{type(exc).__name__}: chat failed without an error message"

    def _discard_last_user_message(self, message: str) -> None:
        if not self._messages:
            return
        last = self._messages[-1]
        if last.role == "user" and message_content_text(last.content) == message:
            self._messages.pop()


def build_session_title(message: str) -> str:
    normalized = " ".join(message.strip().split())
    if not normalized:
        return "Untitled session"
    if len(normalized) <= 72:
        return normalized
    return normalized[:69].rstrip() + "..."
def build_user_content(
    message: str,
    attachments: list[dict[str, Any]],
) -> str | list[TextPart | ImagePart]:
    images = [
        attachment for attachment in attachments if is_image_attachment(attachment)
    ]
    if not images:
        return message

    parts: list[TextPart | ImagePart] = []
    remaining = message
    used: set[int] = set()

    while remaining:
        next_match: tuple[int, int, dict[str, Any]] | None = None
        for index, attachment in enumerate(images):
            if index in used:
                continue
            label = str(attachment.get("label") or "")
            if not label:
                continue
            position = remaining.find(label)
            if position == -1:
                continue
            if next_match is None or position < next_match[0]:
                next_match = (position, index, attachment)

        if next_match is None:
            append_text_part(parts, remaining)
            remaining = ""
            break

        position, index, attachment = next_match
        label = str(attachment.get("label") or "")
        append_text_part(parts, remaining[:position])
        parts.append(image_attachment_part(attachment))
        used.add(index)
        remaining = remaining[position + len(label) :]

    for index, attachment in enumerate(images):
        if index not in used:
            parts.append(image_attachment_part(attachment))

    return parts


def append_text_part(parts: list[TextPart | ImagePart], text: str) -> None:
    if text:
        parts.append(TextPart(text=text))


def image_attachment_part(attachment: dict[str, Any]) -> ImagePart:
    return ImagePart(
        image=f"data:{attachment['mime']};base64,{attachment['data']}",
        media_type=attachment["mime"],
    )


def summarize_attachments(attachments: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {
            "type": "image",
            "filename": str(attachment.get("filename") or "image"),
            "mime": str(attachment.get("mime") or "application/octet-stream"),
        }
        for attachment in attachments
        if is_image_attachment(attachment)
    ]


def is_image_attachment(attachment: Any) -> bool:
    if not isinstance(attachment, dict):
        return False
    if attachment.get("type") != "image":
        return False
    if not isinstance(attachment.get("data"), str) or not attachment["data"]:
        return False
    mime = attachment.get("mime")
    return isinstance(mime, str) and mime.startswith("image/")


def message_content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for part in content:
        if isinstance(part, TextPart):
            parts.append(part.text)
        elif isinstance(part, dict) and part.get("type") == "text":
            parts.append(str(part.get("text") or ""))
    return "".join(parts)


async def remove_queued_message_at(queue: asyncio.Queue[Message], index: int) -> bool:
    items: list[Message] = []
    while not queue.empty():
        items.append(await queue.get())
    removed = 0 <= index < len(items)
    if removed:
        items.pop(index)
    for item in items:
        await queue.put(item)
    return removed
