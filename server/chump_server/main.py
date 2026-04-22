from __future__ import annotations

from ai_query.agents import AgentServer

from .agent import ChumpAgent
from .config import load_config


def main() -> None:
    config = load_config()
    server = AgentServer(ChumpAgent)
    server.serve(host=config.host, port=config.port)


if __name__ == "__main__":
    main()
