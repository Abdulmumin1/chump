from __future__ import annotations

import inspect
from typing import Any


def default_usage_summary() -> dict[str, Any]:
    return {
        "last_step": None,
        "current_turn": None,
        "last_turn": None,
        "session_total": zero_usage_dict(),
    }


def zero_usage_dict() -> dict[str, int]:
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "cached_tokens": 0,
        "total_tokens": 0,
    }


def context_usage_dict(total_tokens: int) -> dict[str, int]:
    total = max(0, int(total_tokens))
    return {
        "input_tokens": total,
        "output_tokens": 0,
        "cached_tokens": 0,
        "total_tokens": total,
    }


def usage_to_dict(usage: Any) -> dict[str, int] | None:
    if usage is None:
        return None
    return {
        "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
        "cached_tokens": int(getattr(usage, "cached_tokens", 0) or 0),
        "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
    }


def merge_usage_dicts(
    base: dict[str, int] | None,
    delta: dict[str, int] | None,
) -> dict[str, int] | None:
    if base is None:
        return delta
    if delta is None:
        return base
    return {
        "input_tokens": int(base.get("input_tokens", 0))
        + int(delta.get("input_tokens", 0)),
        "output_tokens": int(base.get("output_tokens", 0))
        + int(delta.get("output_tokens", 0)),
        "cached_tokens": int(base.get("cached_tokens", 0))
        + int(delta.get("cached_tokens", 0)),
        "total_tokens": int(base.get("total_tokens", 0))
        + int(delta.get("total_tokens", 0)),
    }


def normalize_usage_summary(raw: Any) -> dict[str, Any]:
    summary = default_usage_summary()
    if not isinstance(raw, dict):
        return summary
    for key in ("last_step", "current_turn", "last_turn", "session_total"):
        value = raw.get(key)
        if isinstance(value, dict):
            summary[key] = {
                "input_tokens": int(value.get("input_tokens", 0) or 0),
                "output_tokens": int(value.get("output_tokens", 0) or 0),
                "cached_tokens": int(value.get("cached_tokens", 0) or 0),
                "total_tokens": int(value.get("total_tokens", 0) or 0),
            }
    summary["session_total"] = summary["session_total"] or zero_usage_dict()
    return summary


def latest_usage_context_tokens(usage_summary: dict[str, Any]) -> int | None:
    value = usage_summary.get("last_step")
    if not isinstance(value, dict):
        return None
    total = int(value.get("total_tokens", 0) or 0)
    if total > 0:
        return total
    return None


async def resolve_usage(result: Any) -> Any:
    usage = getattr(result, "usage", None)
    if inspect.isawaitable(usage):
        return await usage
    return usage
