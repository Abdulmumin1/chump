from __future__ import annotations


def is_resume_gap(loop_gap: float, interval: float, timeout: int) -> bool:
    return loop_gap > max(timeout, interval * 5)
