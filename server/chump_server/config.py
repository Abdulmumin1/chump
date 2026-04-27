from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh"}


@dataclass(frozen=True)
class ChumpConfig:
    host: str
    port: int
    workspace_root: Path
    data_dir: Path
    provider: str
    model: str
    max_steps: int
    command_timeout: int
    reasoning: dict[str, Any] | None
    verbose: bool


def load_config() -> ChumpConfig:
    server_dir = Path(__file__).resolve().parents[1]
    project_root = server_dir.parent
    workspace_root = Path(
        os.environ.get("CHUMP_WORKSPACE_ROOT", str(project_root))
    ).resolve()
    data_dir = Path(
        os.environ.get("CHUMP_DATA_DIR", str(project_root / ".chump"))
    ).resolve()

    return ChumpConfig(
        host=os.environ.get("CHUMP_HOST", "127.0.0.1"),
        port=int(os.environ.get("CHUMP_PORT", "8080")),
        workspace_root=workspace_root,
        data_dir=data_dir,
        provider=os.environ.get("CHUMP_PROVIDER", "openai"),
        model=os.environ.get("CHUMP_MODEL", "gpt-5.4"),
        max_steps=int(os.environ.get("CHUMP_MAX_STEPS", "64")),
        command_timeout=int(os.environ.get("CHUMP_COMMAND_TIMEOUT", "120")),
        reasoning=load_reasoning_config(),
        verbose=os.environ.get("CHUMP_VERBOSE", "1").lower()
        not in {"0", "false", "no"},
    )


def load_reasoning_config() -> dict[str, Any] | None:
    reasoning: dict[str, Any] = {}
    effort = os.environ.get("CHUMP_REASONING_EFFORT")
    budget = os.environ.get("CHUMP_REASONING_BUDGET")

    if effort:
        if effort not in REASONING_EFFORTS:
            valid = ", ".join(sorted(REASONING_EFFORTS))
            raise ValueError(f"invalid CHUMP_REASONING_EFFORT={effort!r}; expected one of: {valid}")
        reasoning["effort"] = effort
    if budget:
        reasoning["budget"] = int(budget)

    return reasoning or None
