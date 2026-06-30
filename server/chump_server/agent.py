from __future__ import annotations

import asyncio
from collections import defaultdict, deque
import hashlib
import json
import time
import traceback
from dataclasses import replace
from typing import Any, AsyncIterator

from ai_query import RetryPolicy, step_count_is
from ai_query.agents import Agent, AgentTurn, SQLiteStorage, TurnOptions, action
from ai_query.types import AbortSignal, Message, ProviderOptions

from .config import ChumpConfig, load_auth_config, load_config
from .resources import ResourceCatalog, build_skill_bundle
from .runtime.compaction import (
    build_compaction_summary_message,
    choose_compaction_start,
    estimate_messages_tokens,
    generate_compaction_summary,
)
from .runtime.messages import (
    build_session_title,
    build_user_content,
    build_user_display_content,
    is_image_attachment,
    message_content_text,
    remove_queued_message_at,
    summarize_attachments,
)
from .runtime.model import resolve_model
from .runtime.usage import (
    context_usage_dict,
    default_usage_summary,
    latest_usage_context_tokens,
    merge_usage_dicts,
    normalize_usage_summary,
    resolve_usage,
    usage_to_dict,
    zero_usage_dict,
)
from .system_prompt import SYSTEM_PROMPT, build_system_prompt
from .tools import build_tools
from .git_utils import get_git_branch


class ChumpAgent(Agent[dict[str, Any]]):
    enable_event_log = True
    _server_config: ChumpConfig | None = None
    _server_resources: ResourceCatalog | None = None
    _server_search: Any = None

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
                "file_diffs": {},
                "change_records": [],
                "read_files": {},
                "commands_run": [],
                "notes": [],
                "compaction": None,
                "usage_summary": default_usage_summary(),
            },
            tools={},
            stop_when=step_count_is(config.max_steps),
            reasoning=config.reasoning,
        )
        self._config = config
        self._resources = resources
        self.tools = build_tools(self, config, resources, self._server_search)
        self._last_step_records: list[dict[str, Any]] = []
        self._current_turn: AgentTurn | None = None
        self._pending_steering_events: list[dict[str, Any]] = []
        self._steering_lock = asyncio.Lock()
        self._turn_instruction_claims: set[str] = set()
        self._usage_summary: dict[str, Any] = default_usage_summary()
        self._pending_tool_result_details: dict[str, deque[dict[str, Any]]] = (
            defaultdict(deque)
        )
        self._correlated_tool_result_details: dict[
            tuple[int, int, str], dict[str, Any]
        ] = {}

    async def on_start(self) -> None:
        self._usage_summary = normalize_usage_summary(self.state.get("usage_summary"))

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
            "compaction": self._compaction_status(),
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
            "usage": self._usage_summary,
        }

    @action
    async def clear_messages(self) -> dict[str, str]:
        now = time.time()
        self._usage_summary = default_usage_summary()
        await self.clear()
        await self.update_state(
            last_user_goal=None,
            files_touched=[],
            file_diffs={},
            change_records=[],
            read_files={},
            updated_at=now,
            usage_summary=self._usage_summary,
        )
        return {"status": "ok"}

    @action
    async def compact(self, reason: str = "manual") -> dict[str, Any]:
        if self._current_turn is not None and not self._current_turn.done:
            raise ValueError("cannot compact while a turn is running")
        return await self._compact_messages(reason=reason)

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
                    "display_content": build_user_display_content(
                        message, attachments or []
                    ),
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
                if (
                    event.type.startswith("tool_call.")
                    or event.type.startswith("tool_execution.")
                    or event.type == "tool_result"
                ):
                    await self._on_tool_lifecycle(event)
                    continue

            result = await turn.result()
            final_response = await self._finalize_turn(result, full_response)
            await self._ensure_final_assistant_persisted(result, final_response)
            if not full_response.strip():
                await self.emit("assistant_text", {"content": final_response})
                yield final_response

            # Steering may have arrived after the last step.started boundary
            # (e.g. while the model was streaming its final text).  Drain any
            # remaining items and auto-restart them as a new turn so the user's
            # message is not silently dropped.
            drained = await self._drain_remaining_steering()
            if drained:
                combined = "\n".join(item["content"] for item in drained)
                self._log(f"auto-restarting turn for {len(drained)} un-drained steering item(s)")
                async for chunk in self.stream(
                    combined,
                    attachments=None,
                    signal=signal,
                    **kwargs,
                ):
                    yield chunk
        finally:
            if self._current_turn is turn:
                self._current_turn = None
            await self._emit_turn_status(False)

    async def _drain_remaining_steering(self) -> list[dict[str, Any]]:
        """Pop and emit any steering that arrived after the last step boundary.

        Returns the drained items so the caller can decide whether to
        restart the turn with the accumulated steering content.
        """
        async with self._steering_lock:
            if not self._pending_steering_events:
                return []
            drained = list(self._pending_steering_events)
            self._pending_steering_events.clear()
            await self._emit_steering_queue()

        for item in drained:
            await self.emit("user_message", item)

        return drained

    async def _start_turn(
        self,
        message: str,
        *,
        attachments: list[dict[str, Any]] | None = None,
        signal: AbortSignal | None = None,
        **kwargs: Any,
    ) -> AgentTurn:
        self._ensure_model()
        await self._maybe_compact_before_turn()
        self._last_step_records = []
        self._turn_instruction_claims = set()
        self._pending_tool_result_details.clear()
        self._correlated_tool_result_details.clear()
        self._usage_summary["last_step"] = None
        self._usage_summary["current_turn"] = zero_usage_dict()
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
                "display_content": build_user_display_content(
                    message, attachments or []
                ),
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
            usage_summary=self._usage_summary,
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

    def _compaction_status(self) -> dict[str, Any]:
        estimate = self._context_token_estimate()
        last = self.state.get("compaction")
        return {
            "threshold_tokens": self._config.compaction_tokens,
            "keep_recent_tokens": self._config.compaction_keep_recent_tokens,
            "estimated_tokens": estimate,
            "message_count": len(self._messages),
            "last": last if isinstance(last, dict) else None,
        }

    async def _maybe_compact_before_turn(self) -> None:
        threshold = self._config.compaction_tokens
        if threshold is None:
            return
        estimate = self._context_token_estimate()
        if estimate < threshold:
            return
        await self._compact_messages(reason="auto", estimated_tokens=estimate)

    def _context_token_estimate(self) -> int:
        return latest_usage_context_tokens(self._usage_summary) or 0

    async def _compact_messages(
        self,
        *,
        reason: str,
        estimated_tokens: int | None = None,
    ) -> dict[str, Any]:
        if len(self._messages) < 4:
            return {
                "status": "skipped",
                "reason": "not_enough_messages",
                "message_count": len(self._messages),
            }

        estimated_tokens = estimated_tokens or self._context_token_estimate()
        keep_start = choose_compaction_start(
            self._messages,
            self._config.compaction_keep_recent_tokens,
            # Auto compaction is triggered from provider-reported context usage
            # (the same source shown in the CLI ctx badge). Local text estimates
            # can undercount tool/image/provider framing, so still compact a
            # minimal old slice when provider usage crosses the threshold.
            force=reason in {"auto", "manual"},
        )
        if keep_start <= 1:
            return {
                "status": "skipped",
                "reason": "nothing_to_compact",
                "message_count": len(self._messages),
                "estimated_tokens": estimated_tokens,
            }

        compacted_messages = self._messages[:keep_start]
        recent_messages = self._messages[keep_start:]
        await self.emit(
            "compaction_status",
            {
                "running": True,
                "reason": reason,
                "tokens_before": estimated_tokens,
                "messages_before": len(self._messages),
            },
        )
        try:
            summary = await self._generate_compaction_summary(compacted_messages)
        finally:
            await self.emit(
                "compaction_status",
                {
                    "running": False,
                    "reason": reason,
                },
            )
        summary_message = build_compaction_summary_message(summary)
        before_count = len(self._messages)
        self._messages = [summary_message, *recent_messages]
        await self._persist_messages()
        tokens_after = estimate_messages_tokens(self._messages)
        self._usage_summary["last_step"] = context_usage_dict(tokens_after)
        self._usage_summary["current_turn"] = zero_usage_dict()

        now = time.time()
        compaction = {
            "reason": reason,
            "tokens_before": estimated_tokens,
            "tokens_after": tokens_after,
            "messages_before": before_count,
            "messages_after": len(self._messages),
            "compacted_messages": len(compacted_messages),
            "kept_messages": len(recent_messages),
            "summary_chars": len(summary),
            "created_at": now,
        }
        await self.update_state(
            compaction=compaction,
            updated_at=now,
            usage_summary=self._usage_summary,
        )
        await self.emit("compaction", compaction)
        await self.emit("agent_status", await self.status())
        self._log(
            "compacted conversation: "
            f"reason={reason} messages={before_count}->{len(self._messages)} "
            f"tokens_before={estimated_tokens}"
        )
        return {"status": "ok", **compaction}

    async def _generate_compaction_summary(self, messages: list[Message]) -> str:
        self._ensure_model()
        if self.model is None:
            raise ValueError("No model set for compaction")
        return await generate_compaction_summary(
            model=self.model,
            messages=messages,
            retry=self._retry_policy(),
            provider_options=self._turn_provider_options(),
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
        usage = await resolve_usage(result)
        final_step_usage = usage_to_dict(usage)
        current_turn_usage = self._usage_summary.get("current_turn")
        if not isinstance(current_turn_usage, dict) or not any(
            int(value or 0) for value in current_turn_usage.values()
        ):
            current_turn_usage = final_step_usage
        if current_turn_usage is not None:
            self._usage_summary["current_turn"] = current_turn_usage
            self._usage_summary["last_turn"] = current_turn_usage
            self._usage_summary["session_total"] = merge_usage_dicts(
                self._usage_summary.get("session_total"), current_turn_usage
            )
            await self._persist_usage_summary()
            await self.emit("agent_status", await self.status())
        if not full_response.strip():
            full_response = await self._build_empty_response_fallback(result)
            self._log(f"chat produced fallback response: {full_response}")
        else:
            self._log(f"chat complete with {len(full_response)} chars")

        return full_response

    async def _ensure_final_assistant_persisted(
        self,
        result: Any,
        final_response: str,
    ) -> None:
        if not final_response.strip():
            return

        steps = getattr(result, "steps", None)
        final_step = steps[-1] if isinstance(steps, list) and steps else None
        final_step_text = (
            str(getattr(final_step, "text", "") or "")
            if final_step is not None
            else ""
        )
        use_final_step = bool(
            final_step is not None
            and not getattr(final_step, "tool_calls", [])
            and final_step_text.strip()
        )
        expected_text = final_step_text if use_final_step else final_response
        if (
            self._messages
            and self._messages[-1].role == "assistant"
            and message_content_text(self._messages[-1].content).strip()
            == expected_text.strip()
        ):
            return

        if use_final_step:
            self._append_step_message(final_step)
        else:
            self._messages.append(Message(role="assistant", content=final_response))
        await self._persist_messages()

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

    async def _on_tool_lifecycle(self, event) -> None:
        if event.type == "tool_call.ready":
            call = event.tool_call
            await self.emit(
                "tool_call",
                {
                    "tool": call.name,
                    "name": call.name,
                    "payload": call.arguments,
                    "args": call.arguments,
                    "id": call.id,
                    "call_id": call.id,
                    "tool_call_id": call.id,
                    "step": event.step_number,
                    "index": event.index,
                    "status": "ready",
                },
            )
            return

        if event.type == "tool_result":
            call = event.tool_call
            result = event.tool_result
            key = self._tool_lifecycle_key(event)
            detail = self._correlated_tool_result_details.pop(key, {})
            preview = detail.get("preview")
            if not isinstance(preview, str):
                preview = str(result.result)
                if len(preview) > 4_000:
                    preview = preview[:3_980] + "\n...[truncated]"
            payload = {
                "tool": call.name,
                "name": call.name,
                "tool_name": result.tool_name,
                "id": call.id,
                "call_id": call.id,
                "tool_call_id": result.tool_call_id or call.id,
                "step": event.step_number,
                "index": event.index,
                "ok": not result.is_error,
                "status": "error" if result.is_error else "ok",
                "is_error": result.is_error,
                "preview": preview,
                "metadata": detail.get("metadata", {}),
                "duration": detail.get("duration"),
            }
            if result.is_error:
                payload["error"] = str(result.result)
            await self.emit("tool_result", payload)
            return

        payload: dict[str, Any] = {
            "step": event.step_number,
            "index": event.index,
        }
        if event.type == "tool_call.started":
            payload.update(
                {
                    "call_id": event.tool_call_id,
                    "name": event.name,
                }
            )
        elif event.type == "tool_call.delta":
            payload.update(
                {
                    "call_id": event.tool_call_id,
                    "name_delta": event.name_delta,
                    "arguments_delta": event.arguments_delta,
                }
            )
        else:
            call = event.tool_call
            payload.update(
                {
                    "tool": call.name,
                    "call_id": call.id,
                    "tool_call_id": call.id,
                    "name": call.name,
                }
            )
            if event.type == "tool_execution.finished":
                key = self._tool_lifecycle_key(event)
                detail = self._take_tool_result_detail(
                    call.name,
                    getattr(event, "tool_result", None),
                )
                detail["duration"] = event.duration
                self._correlated_tool_result_details[key] = detail
                payload.update(
                    {
                        "duration": event.duration,
                        "error": event.error,
                        "aborted": event.aborted,
                        "ok": event.error is None and not event.aborted,
                        "status": (
                            "error" if event.error else "aborted" if event.aborted else "ok"
                        ),
                        "preview": detail.get("preview", ""),
                        "metadata": detail.get("metadata", {}),
                    }
                )
        await self.emit(event.type, payload, replay=False)

    def capture_tool_result_detail(
        self,
        tool_name: str,
        *,
        ok: bool,
        preview: str,
        metadata: dict[str, object],
        result: object,
        error: str | None = None,
    ) -> None:
        self._pending_tool_result_details[tool_name].append(
            {
                "ok": ok,
                "status": "ok" if ok else "error",
                "preview": preview,
                "metadata": metadata,
                "error": error,
                "result_fingerprint": self._tool_result_fingerprint(result),
            }
        )

    def _take_tool_result_detail(
        self,
        tool_name: str,
        tool_result: ToolResult | None,
    ) -> dict[str, Any]:
        pending = self._pending_tool_result_details.get(tool_name)
        if not pending or tool_result is None:
            return {}

        expected = self._tool_result_fingerprint(tool_result.result)
        matching_index = next(
            (
                index
                for index, detail in enumerate(pending)
                if detail.get("result_fingerprint") == expected
            ),
            None,
        )
        if matching_index is None:
            return {}

        detail = pending[matching_index]
        del pending[matching_index]
        if not pending:
            self._pending_tool_result_details.pop(tool_name, None)
        detail.pop("result_fingerprint", None)
        return detail

    @staticmethod
    def _tool_result_fingerprint(result: object) -> str:
        encoded = json.dumps(
            result,
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _tool_lifecycle_key(event) -> tuple[int, int, str]:
        return (event.step_number, event.index, event.tool_call.id)

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
        raw_step_usage = getattr(event.step, "usage", None) or getattr(
            event, "usage", None
        )
        step_usage = usage_to_dict(raw_step_usage)
        self._usage_summary["last_step"] = step_usage
        cumulative_usage = merge_usage_dicts(
            self._usage_summary.get("current_turn"), step_usage
        )
        self._usage_summary["current_turn"] = cumulative_usage
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
            "usage": step_usage,
            "cumulative_usage": cumulative_usage,
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
            "usage": step_usage,
            "cumulative_usage": cumulative_usage,
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
        await self._persist_usage_summary()
        await self.emit("status", payload)
        await self.emit("agent_status", await self.status())

    async def _persist_usage_summary(self) -> None:
        self.state["usage_summary"] = normalize_usage_summary(self._usage_summary)
        await self.save_state()

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
