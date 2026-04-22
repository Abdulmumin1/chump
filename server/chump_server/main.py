from __future__ import annotations

from ai_query.agents import AgentServer

from .agent import ChumpAgent
from .config import load_config


def main() -> None:
    config = load_config()
    if config.verbose:
        print(
            "[chump] "
            f"provider={config.provider} "
            f"model={config.model} "
            f"max_steps={config.max_steps} "
            f"workspace={config.workspace_root}",
            flush=True,
        )
    server = AgentServer(ChumpAgent)
    server.serve(host=config.host, port=config.port)


if __name__ == "__main__":
    main()
