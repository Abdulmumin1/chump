#!/usr/bin/env python3
"""Report prompt-cache hit rates from persisted Chump step telemetry."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable


DEFAULT_PROVIDERS = ("chump_cloud", "codex", "google", "workers_ai")


@dataclass
class CacheStats:
    provider: str
    model: str
    sessions: set[str] = field(default_factory=set)
    calls: int = 0
    hit_calls: int = 0
    input_tokens: int = 0
    cached_tokens: int = 0

    @property
    def request_hit_rate(self) -> float:
        return self.hit_calls / self.calls if self.calls else 0.0

    @property
    def token_hit_rate(self) -> float:
        return self.cached_tokens / self.input_tokens if self.input_tokens else 0.0

    def record(self, session_id: str, usage: dict[str, Any]) -> None:
        input_tokens = nonnegative_int(usage.get("input_tokens"))
        cached_tokens = nonnegative_int(usage.get("cached_tokens"))
        if input_tokens is None or input_tokens == 0 or cached_tokens is None:
            raise ValueError("step usage requires non-negative input and cached token counts")
        if cached_tokens > input_tokens:
            raise ValueError("cached tokens cannot exceed input tokens")

        self.sessions.add(session_id)
        self.calls += 1
        self.hit_calls += int(cached_tokens > 0)
        self.input_tokens += input_tokens
        self.cached_tokens += cached_tokens

    def merge(self, other: CacheStats) -> None:
        self.sessions.update(other.sessions)
        self.calls += other.calls
        self.hit_calls += other.hit_calls
        self.input_tokens += other.input_tokens
        self.cached_tokens += other.cached_tokens

    def serializable(self) -> dict[str, Any]:
        value = asdict(self)
        value["sessions"] = len(self.sessions)
        value["request_hit_rate"] = self.request_hit_rate
        value["token_hit_rate"] = self.token_hit_rate
        return value


@dataclass
class ScanDiagnostics:
    databases: int = 0
    sessions: int = 0
    duplicate_sessions: int = 0
    malformed_logs: int = 0
    steps_without_usage: int = 0
    invalid_usage_steps: int = 0
    unattributed_steps: int = 0


@dataclass(frozen=True)
class SessionLog:
    session_id: str
    events: list[Any]

    @property
    def last_event_id(self) -> int:
        for event in reversed(self.events):
            if isinstance(event, dict):
                event_id = nonnegative_int(event.get("id"))
                if event_id is not None:
                    return event_id
        return 0


def nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def default_state_root() -> Path:
    if configured := os.environ.get("XDG_STATE_HOME"):
        return Path(configured).expanduser() / "chump"
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / "chump"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "chump"
    return Path.home() / ".local" / "state" / "chump"


def find_databases(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    direct = root / "chump.sqlite3"
    if direct.is_file():
        return [direct]
    return sorted(root.glob("workspaces/*/chump.sqlite3"))


def read_session_logs(
    database_paths: Iterable[Path], diagnostics: ScanDiagnostics
) -> list[SessionLog]:
    logs_by_session: dict[str, SessionLog] = {}
    for database_path in database_paths:
        diagnostics.databases += 1
        try:
            uri = f"{database_path.resolve().as_uri()}?mode=ro"
            with sqlite3.connect(uri, uri=True) as connection:
                rows = connection.execute(
                    "SELECT key, value FROM kv_store WHERE key GLOB '*:event_log'"
                ).fetchall()
        except sqlite3.Error:
            diagnostics.malformed_logs += 1
            continue

        for key, raw_events in rows:
            session_id = str(key).removesuffix(":event_log")
            try:
                events = json.loads(raw_events)
            except (json.JSONDecodeError, TypeError):
                diagnostics.malformed_logs += 1
                continue
            if not isinstance(events, list):
                diagnostics.malformed_logs += 1
                continue

            candidate = SessionLog(session_id=session_id, events=events)
            existing = logs_by_session.get(session_id)
            if existing is not None:
                diagnostics.duplicate_sessions += 1
                if (candidate.last_event_id, len(candidate.events)) <= (
                    existing.last_event_id,
                    len(existing.events),
                ):
                    continue
            logs_by_session[session_id] = candidate

    diagnostics.sessions = len(logs_by_session)
    return list(logs_by_session.values())


def provider_and_model(event: Any) -> tuple[str, str] | None:
    if not isinstance(event, dict) or event.get("type") != "agent_status":
        return None
    data = event.get("data")
    if not isinstance(data, dict):
        return None
    provider = data.get("provider")
    model = data.get("model")
    if not isinstance(provider, str) or not provider or not isinstance(model, str) or not model:
        return None
    return provider, model


def step_usage(event: Any) -> dict[str, Any] | None:
    if not isinstance(event, dict) or event.get("type") != "status":
        return None
    data = event.get("data")
    if not isinstance(data, dict) or data.get("phase") != "step_finish":
        return None
    usage = data.get("usage")
    return usage if isinstance(usage, dict) else {}


def aggregate_cache_stats(
    logs: Iterable[SessionLog], diagnostics: ScanDiagnostics
) -> dict[tuple[str, str], CacheStats]:
    stats: dict[tuple[str, str], CacheStats] = {}
    for log in logs:
        first_model = next(
            (value for event in log.events if (value := provider_and_model(event))),
            None,
        )
        current_model = first_model

        for event in log.events:
            if model := provider_and_model(event):
                current_model = model
                continue

            usage = step_usage(event)
            if usage is None:
                continue
            if not usage:
                diagnostics.steps_without_usage += 1
                continue
            if current_model is None:
                diagnostics.unattributed_steps += 1
                continue

            provider, model = current_model
            row = stats.setdefault(
                current_model,
                CacheStats(provider=provider, model=model),
            )
            try:
                row.record(log.session_id, usage)
            except ValueError:
                diagnostics.invalid_usage_steps += 1

    return stats


def provider_totals(rows: Iterable[CacheStats]) -> list[CacheStats]:
    totals: dict[str, CacheStats] = {}
    for row in rows:
        total = totals.setdefault(
            row.provider,
            CacheStats(provider=row.provider, model="ALL"),
        )
        total.merge(row)
    return sorted(totals.values(), key=lambda row: row.provider)


def format_integer(value: int) -> str:
    return f"{value:,}"


def format_rate(value: float) -> str:
    return f"{value * 100:.1f}%"


def render_table(rows: list[CacheStats]) -> str:
    headers = (
        "provider/model",
        "sessions",
        "calls",
        "hit calls",
        "request hit",
        "input tokens",
        "cached tokens",
        "token hit",
    )
    values = [
        (
            f"{row.provider}/{row.model}",
            format_integer(len(row.sessions)),
            format_integer(row.calls),
            format_integer(row.hit_calls),
            format_rate(row.request_hit_rate),
            format_integer(row.input_tokens),
            format_integer(row.cached_tokens),
            format_rate(row.token_hit_rate),
        )
        for row in rows
    ]
    widths = [
        max(len(headers[index]), *(len(value[index]) for value in values))
        for index in range(len(headers))
    ]

    def line(value: tuple[str, ...]) -> str:
        return "  ".join(
            item.ljust(widths[index]) if index == 0 else item.rjust(widths[index])
            for index, item in enumerate(value)
        )

    return "\n".join(
        [
            line(headers),
            line(tuple("-" * width for width in widths)),
            *(line(value) for value in values),
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Report provider-reported prompt-cache hits from Chump history."
    )
    parser.add_argument(
        "--state-root",
        type=Path,
        default=default_state_root(),
        help="Chump state root, workspace state directory, or chump.sqlite3 file (default: global Chump state root)",
    )
    parser.add_argument(
        "--provider",
        action="append",
        dest="providers",
        help="Provider to include; repeat for multiple providers (default: Chump Cloud, Codex, Google, Workers AI)",
    )
    parser.add_argument("--min-calls", type=int, default=1)
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.min_calls < 1:
        raise SystemExit("--min-calls must be at least 1")

    diagnostics = ScanDiagnostics()
    databases = find_databases(args.state_root.expanduser())
    if not databases:
        raise SystemExit(f"no Chump databases found under {args.state_root}")

    stats = aggregate_cache_stats(read_session_logs(databases, diagnostics), diagnostics)
    providers = set(args.providers or DEFAULT_PROVIDERS)
    selected_rows = [row for row in stats.values() if row.provider in providers]
    rows = sorted(
        (row for row in selected_rows if row.calls >= args.min_calls),
        key=lambda row: (row.provider, -row.calls, row.model),
    )
    totals = provider_totals(selected_rows)

    if args.json:
        print(
            json.dumps(
                {
                    "models": [row.serializable() for row in rows],
                    "providers": [row.serializable() for row in totals],
                    "diagnostics": asdict(diagnostics),
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0

    print("Prompt cache by model")
    print(render_table(rows))
    print("\nPrompt cache by provider")
    print(render_table(totals))
    print(
        "\nScanned "
        f"{diagnostics.sessions:,} sessions in {diagnostics.databases:,} databases; "
        f"skipped {diagnostics.steps_without_usage:,} steps without usage, "
        f"{diagnostics.invalid_usage_steps:,} invalid usage records, and "
        f"{diagnostics.unattributed_steps:,} unattributed steps."
    )
    print(
        "Request hit = calls reporting cached_tokens > 0. "
        "Token hit = cached_tokens / input_tokens."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
