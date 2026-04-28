from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator

from ai_query import step_count_is, stream_text
from ai_query.agents import Agent, SQLiteStorage, action
from ai_query.providers import anthropic, google, openai, workers_ai
from ai_query.types import AbortController, AbortError, AbortSignal, Message

from .config import ChumpConfig, load_config
from .tools import build_tools

SYSTEM_PROMPT = """

You are Chump, an interactive CLI coding agent that helps users with software engineering tasks inside their local workspace.

You're currently inside of their project directory

you can ls -la to see the contents of the current directory.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.

You are a great coding agent when you behave like a careful engineer in a terminal:
- Build a map of the workspace before making claims about it.
- Use normal shell discovery habits: `pwd`, `ls`, `find`, `rg`, `git status`, package manifests, and README files.
- Prefer `rg` for content search and `find` for filename/path discovery.
- Read specific files only after you have found where they are.
- For broad requests like "what is this project?" or "make a deep wiki", inspect the repository structure first, then read the key files, then synthesize.
- Do not ask the user which obvious inspection step to take next. Continue until you have enough evidence or hit a real blocker.
- Do not guess paths such as `src` or `packages/*`; discover them.

If the user asks for help or wants to give feedback inform them of the following:
- /help: Get help with using Chump
- To give feedback, users should report the issue at https://github.com/abdulmumin1/chump/issues


# Tone and style
You should be concise, direct, and to the point. When you run a non-trivial bash command, you should explain what the command does and why you are running it, to make sure the user understands what you are doing (this is especially important when you are running a command that will make changes to the user's system).
Remember that your output will be displayed on a command line interface. Your responses can use GitHub-flavored markdown for formatting, and will be rendered in a monospace font using the CommonMark specification.
Output text to communicate with the user; all text you output outside of tool use is displayed to the user. Only use tools to complete tasks. Never use tools like Bash or code comments as means to communicate with the user during the session.
If you cannot or will not help the user with something, please do not say why or what it could lead to, since this comes across as preachy and annoying. Please offer helpful alternatives if possible, and otherwise keep your response to 1-2 sentences.
Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.
IMPORTANT: You should minimize output tokens as much as possible while maintaining helpfulness, quality, and accuracy. Only address the specific query or task at hand, avoiding tangential information unless absolutely critical for completing the request. If you can answer in 1-3 sentences or a short paragraph, please do.
IMPORTANT: You should NOT answer with unnecessary preamble or postamble (such as explaining your code or summarizing your action), unless the user asks you to.
IMPORTANT: Keep your responses short, since they will be displayed on a command line interface. You MUST answer concisely with fewer than 4 lines (not including tool use or code generation), unless user asks for detail. Answer the user's question directly, without elaboration, explanation, or details. One word answers are best. Avoid introductions, conclusions, and explanations. You MUST avoid text before/after your response, such as "The answer is <answer>.", "Here is the content of the file..." or "Based on the information provided, the answer is..." or "Here is what I will do next...". Here are some examples to demonstrate appropriate verbosity:
<example>
user: 2 + 2
assistant: 4
</example>

<example>
user: what is 2+2?
assistant: 4
</example>

<example>
user: is 11 a prime number?
assistant: Yes
</example>

<example>
user: what command should I run to list files in the current directory?
assistant: ls
</example>

<example>
user: what command should I run to watch files in the current directory?
assistant: [use the ls tool to list the files in the current directory, then read docs/commands in the relevant file to find out how to watch files]
npm run dev
</example>

<example>
user: How many golf balls fit inside a jetta?
assistant: 150000
</example>

<example>
user: what files are in the directory src/?
assistant: [runs ls and sees foo.c, bar.c, baz.c]
user: which file contains the implementation of foo?
assistant: src/foo.c
</example>

<example>
user: write tests for new feature
assistant: [uses bash with rg/find to locate similar tests, reads relevant files, edits the test files, then runs the appropriate test command]
</example>

# Proactiveness
You are allowed to be proactive, but only when the user asks you to do something. You should strive to strike a balance between:
1. Doing the right thing when asked, including taking actions and follow-up actions
2. Not surprising the user with actions you take without asking
For example, if the user asks you how to approach something, you should do your best to answer their question first, and not immediately jump into taking actions.
3. Do not add additional code explanation summary unless requested by the user. After working on a file, just stop, rather than providing an explanation of what you did.

# Following conventions
When making changes to files, first understand the file's code conventions. Mimic code style, use existing libraries and utilities, and follow existing patterns.
- NEVER assume that a given library is available, even if it is well known. Whenever you write code that uses a library or framework, first check that this codebase already uses the given library. For example, you might look at neighboring files, or check the package.json (or cargo.toml, and so on depending on the language).
- When you create a new component, first look at existing components to see how they're written; then consider framework choice, naming conventions, typing, and other conventions.
- When you edit a piece of code, first look at the code's surrounding context (especially its imports) to understand the code's choice of frameworks and libraries. Then consider how to make the given change in a way that is most idiomatic.
- Always follow security best practices. Never introduce code that exposes or logs secrets and keys. Never commit secrets or keys to the repository.

# Code style
- IMPORTANT: DO NOT ADD ***ANY*** COMMENTS unless asked

# Doing tasks
The user will primarily request you perform software engineering tasks. This includes solving bugs, adding new functionality, refactoring code, explaining code, and more. For these tasks the following steps are recommended:
- Use bash with `rg`, `find`, `ls`, and related shell tools to understand the codebase and the user's query.
- Implement the solution using the available workspace operations.
- Verify the solution if possible with tests. NEVER assume specific test framework or test script. Check the README or search codebase to determine the testing approach.
- VERY IMPORTANT: When you have completed a task, you MUST run the lint and typecheck commands (e.g. npm run lint, npm run typecheck, ruff, etc.) with Bash if they were provided to you to ensure your code is correct. If you are unable to find the correct command, ask the user for the command to run and if they supply it, proactively suggest writing it to AGENTS.md so that you will know to run it next time.
NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.

- Tool results and user messages may include <system-reminder> tags. <system-reminder> tags contain useful information and reminders. They are NOT part of the user's provided input or the tool result.

# Tool usage policy
- When doing file search, prefer bash with `rg` for content search and `find` for filename/path search.
- When multiple independent facts are needed, gather them efficiently before answering.

You MUST answer concisely with fewer than 4 lines of text (not including tool use or code generation), unless user asks for detail.

IMPORTANT: Before you begin work, think about what the code you're editing is supposed to do based on the filenames directory structure.

# Code References

When referencing specific functions or pieces of code include the pattern `file_path:line_number` to allow the user to easily navigate to the source code location.

<example>
user: Where are errors from the client handled?
assistant: Clients are marked as failed in the `connectToServer` function in src/services/process.ts:712.
</example>
"""


def resolve_model(config: ChumpConfig):
    provider_name = config.provider.lower()
    if provider_name == "openai":
        return openai(config.model)
    if provider_name == "google":
        return google(config.model)
    if provider_name == "anthropic":
        return anthropic(config.model)
    if provider_name == "workers_ai":
        return workers_ai(config.model)
    raise ValueError(f"unsupported provider: {config.provider}")


class ChumpAgent(Agent[dict[str, Any]]):
    enable_event_log = True

    def __init__(self, id: str):
        config = load_config()
        config.data_dir.mkdir(parents=True, exist_ok=True)
        now = time.time()
        super().__init__(
            id,
            model=None,
            system=SYSTEM_PROMPT,
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
        self.tools = build_tools(self, config)
        self._last_step_records: list[dict[str, Any]] = []
        self._current_abort_controller: AbortController | None = None

    @action
    async def status(self) -> dict[str, Any]:
        return {
            "agent_id": self.id,
            "workspace_root": str(self._config.workspace_root),
            "provider": self._config.provider,
            "model": self._config.model,
            "max_steps": self._config.max_steps,
            "command_timeout": self._config.command_timeout,
            "reasoning": self._config.reasoning,
            "verbose": self._config.verbose,
            "message_count": len(self.messages),
            "title": self.state.get("title"),
            "created_at": self.state.get("created_at"),
            "updated_at": self.state.get("updated_at"),
            "last_user_goal": self.state.get("last_user_goal"),
        }

    @action
    async def clear_messages(self) -> dict[str, str]:
        now = time.time()
        await self.clear()
        await self.update_state(last_user_goal=None, read_files={}, updated_at=now)
        return {"status": "ok"}

    @action
    async def event_log(self) -> dict[str, Any]:
        return {"events": list(self._event_log)}

    @action
    async def abort_current_turn(self) -> dict[str, Any]:
        controller = self._current_abort_controller
        if controller is None:
            return {"status": "idle"}
        controller.abort("aborted by user")
        return {"status": "aborting"}

    @property
    def current_abort_signal(self) -> AbortSignal | None:
        controller = self._current_abort_controller
        return controller.signal if controller else None

    async def chat(
        self,
        message: str,
        *,
        signal: AbortSignal | None = None,
        **kwargs: Any,
    ) -> str:
        try:
            result = await self._start_chat_stream(message, signal=signal, **kwargs)
            chunks: list[str] = []
            async for chunk in result.text_stream:
                chunks.append(chunk)
            return await self._finalize_chat_stream(result, "".join(chunks))
        except AbortError:
            self._discard_last_user_message(message)
            raise

    async def stream(
        self,
        message: str,
        *,
        signal: AbortSignal | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        try:
            result = await self._start_chat_stream(message, signal=signal, **kwargs)
            full_response = ""
            async for chunk in result.text_stream:
                full_response += chunk
                yield chunk

            final_response = await self._finalize_chat_stream(result, full_response)
            if not full_response.strip():
                yield final_response
        except AbortError:
            self._discard_last_user_message(message)
            raise

    async def _start_chat_stream(
        self,
        message: str,
        *,
        signal: AbortSignal | None = None,
        **kwargs: Any,
    ):
        self._ensure_model()
        self._last_step_records = []
        self._log(f"chat start: {message}")
        self._messages.append(Message(role="user", content=message))
        now = time.time()
        created_at = self.state.get("created_at")
        title = self.state.get("title")
        await self.update_state(
            title=title or build_session_title(message),
            created_at=created_at if isinstance(created_at, (int, float)) else now,
            updated_at=now,
            last_user_goal=message,
        )

        return stream_text(
            model=self.model,
            system=self.system,
            messages=self._messages,
            tools=self.tools if self.tools else None,
            stop_when=self.stop_when,
            provider_options=self.provider_options,
            reasoning=self.reasoning,
            signal=signal,
            on_reasoning_event=self._handle_reasoning_event,
            on_step_start=self._on_step_start,
            on_step_finish=self._on_step_finish,
            **kwargs,
        )

    async def handle_request_stream(
        self, request: dict[str, Any]
    ) -> AsyncIterator[str]:
        if self._state is None:
            await self.start()

        if request.get("action", "chat") != "chat":
            yield 'event: error\ndata: "Streaming not supported for this action"\n\n'
            return

        message = request.get("message", "")
        controller = AbortController()
        self._current_abort_controller = controller

        try:
            yield "event: start\ndata: \n\n"

            full_text = ""
            async for chunk in self.stream(message, signal=controller.signal):
                full_text += chunk
                yield f"event: chunk\ndata: {json.dumps(chunk)}\n\n"

            yield f"event: end\ndata: {json.dumps(full_text)}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json.dumps(str(exc))}\n\n"
        finally:
            if self._current_abort_controller is controller:
                self._current_abort_controller = None

    async def _finalize_chat_stream(self, result: Any, full_response: str) -> str:
        if not full_response.strip():
            full_response = await self._build_empty_response_fallback(result)
            self._log(f"chat produced fallback response: {full_response}")
        else:
            self._log(f"chat complete with {len(full_response)} chars")

        self._append_step_messages(await self._get_result_steps(result), full_response)
        await self._persist_messages()
        return full_response

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
            self._log(f"tool result [{status}] {tool_result['tool_name']}: {preview}")
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

    def _discard_last_user_message(self, message: str) -> None:
        if not self._messages:
            return
        last = self._messages[-1]
        if last.role == "user" and last.content == message:
            self._messages.pop()


def build_session_title(message: str) -> str:
    normalized = " ".join(message.strip().split())
    if not normalized:
        return "Untitled session"
    if len(normalized) <= 72:
        return normalized
    return normalized[:69].rstrip() + "..."
