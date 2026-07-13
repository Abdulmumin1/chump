from __future__ import annotations

from typing import Any

from ai_query import generate_text
from ai_query.types import Message

from .messages import message_content_text


def estimate_messages_tokens(messages: list[Message]) -> int:
    return sum(estimate_message_tokens(message) for message in messages)


def estimate_message_tokens(message: Message) -> int:
    return max(1, (len(message_content_text(message.content)) + 3) // 4)


def choose_compaction_start(
    messages: list[Message],
    keep_recent_tokens: int,
    *,
    force: bool = False,
) -> int:
    minimum_start = max(1, leading_system_message_count(messages))
    start = find_recent_message_start(messages, keep_recent_tokens)
    if start > minimum_start or not force or len(messages) < 4:
        return align_compaction_start(messages, start)
    # Manual compaction should still do useful work when provider-reported
    # context is high but local text heuristics say the whole transcript is
    # below the recent-history budget.
    return align_compaction_start(messages, max(minimum_start, len(messages) - 2))


def align_compaction_start(messages: list[Message], start: int) -> int:
    minimum_start = max(1, leading_system_message_count(messages))
    start = min(max(0, start), len(messages))
    while (
        start > minimum_start
        and start < len(messages)
        and is_tool_result_message(messages[start])
    ):
        start -= 1
    return start


def leading_system_message_count(messages: list[Message]) -> int:
    for index, message in enumerate(messages):
        if str(message.role) != "system":
            return index
    return len(messages)


def is_tool_result_message(message: Message) -> bool:
    if str(message.role) == "tool":
        return True
    content = message.content
    if not isinstance(content, list):
        return False
    for part in content:
        if isinstance(part, dict) and part.get("type") == "tool_result":
            return True
    return False


def find_recent_message_start(messages: list[Message], keep_recent_tokens: int) -> int:
    if not messages:
        return 0
    tokens = 0
    start = len(messages)
    for index in range(len(messages) - 1, -1, -1):
        tokens += estimate_message_tokens(messages[index])
        start = index
        if tokens >= keep_recent_tokens:
            break
    return max(1, leading_system_message_count(messages), start)


def replace_compacted_messages(
    messages: list[Message],
    keep_start: int,
    summary: str,
) -> list[Message]:
    protected_count = leading_system_message_count(messages)
    if keep_start < protected_count:
        raise ValueError("compaction cannot replace system messages")
    return [
        *messages[:protected_count],
        build_compaction_summary_message(summary),
        *messages[keep_start:],
    ]


def serialize_messages_for_compaction(messages: list[Message]) -> str:
    sections: list[str] = []
    for index, message in enumerate(messages, start=1):
        text = message_content_text(message.content).strip()
        if len(text) > 12_000:
            text = text[:12_000].rstrip() + "\n[truncated]"
        sections.append(f"## Message {index}: {message.role}\n{text}")
    return "\n\n".join(sections)


def build_compaction_summary_message(summary: str) -> Message:
    return Message(
        role="user",
        content=(
            "The conversation history before this point was compacted into "
            "the following summary. Treat it as authoritative context for "
            "future turns.\n\n<summary>\n"
            f"{summary.strip()}\n"
            "</summary>"
        ),
    )


async def generate_compaction_summary(
    *,
    model: Any,
    messages: list[Message],
    retry: Any = None,
    provider_options: dict[str, Any] | None = None,
) -> str:
    transcript = serialize_messages_for_compaction(messages)
    prompt = (
        "Summarize the conversation history for a coding agent session. "
        "Preserve user goals, decisions, constraints, files changed or read, "
        "commands run, failures, pending tasks, and any explicit preferences. "
        "Omit low-value chatter and repeated tool output. Be concise but "
        "specific enough that future turns can continue safely.\n\n"
        f"{transcript}"
    )
    result = await generate_text(
        model=model,
        system="You produce durable context summaries for coding-agent sessions.",
        prompt=prompt,
        retry=retry,
        provider_options=provider_options,
        reasoning=None,
    )
    summary = result.text.strip()
    if not summary:
        raise ValueError("compaction summary was empty")
    return summary
