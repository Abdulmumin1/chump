from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ChumpConfig:
    host: str
    port: int
    workspace_root: Path
    data_dir: Path
    provider: str
    model: str


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
        model=os.environ.get("CHUMP_MODEL", "gpt-4.1-mini"),
    )

