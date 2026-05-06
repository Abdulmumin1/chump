"""chump server package."""

from .config import ChumpConfig, load_config

__all__ = ["ChumpAgent", "ChumpConfig", "load_config"]


def __getattr__(name: str):
    if name == "ChumpAgent":
        from .agent import ChumpAgent

        return ChumpAgent
    raise AttributeError(name)
