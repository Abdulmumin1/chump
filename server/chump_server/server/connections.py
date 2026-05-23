from __future__ import annotations

from typing import Any


def active_connection_count(agent_meta_values: list[Any]) -> int:
    count = 0
    unique_sse_clients: set[tuple[str, str]] = set()
    for meta in agent_meta_values:
        agent = meta.agent
        count += len(agent._connections)
        stale_sse = []
        for response in list(agent._sse_connections):
            task = getattr(response, "task", None)
            if task is not None and task.done():
                stale_sse.append(response)
                continue
            client_id = sse_client_id(response)
            if client_id:
                unique_sse_clients.add((agent.id, client_id))
            else:
                count += 1
        for response in stale_sse:
            agent._sse_connections.discard(response)
    return count + len(unique_sse_clients)


def sse_client_id(response: Any) -> str | None:
    request = getattr(response, "_req", None)
    query = getattr(request, "query", None)
    if query is None:
        return None
    value = query.get("client_id")
    return value if isinstance(value, str) and value else None
