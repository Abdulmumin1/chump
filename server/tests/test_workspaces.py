from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path

import pytest
from ai_query.agents import SQLiteStorage

from chump_server.agent import bind_chump_agent
from chump_server.config import ChumpConfig
from chump_server.main import ChumpServer
from chump_server.projects import ProjectRegistry, project_id_for_path
from chump_server.workspaces import WorkspaceRuntimeMap


def test_project_id_matches_the_existing_client_contract(tmp_path: Path) -> None:
    workspace = tmp_path.resolve()

    assert project_id_for_path(workspace).startswith("project-")
    assert project_id_for_path(workspace) == project_id_for_path(workspace)
    assert len(project_id_for_path(workspace)) == len("project-") + 16


@pytest.mark.asyncio
async def test_project_registry_round_trips_the_shared_json_schema(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    registry_path = tmp_path / "projects.json"
    registry = ProjectRegistry(registry_path)

    project = await registry.register(workspace, "Example", now=123)
    reloaded = ProjectRegistry(registry_path)

    assert [item.to_dict() for item in await reloaded.list()] == [
        {
            "id": project.id,
            "name": "Example",
            "workspacePath": str(workspace.resolve()),
            "createdAt": 123,
            "lastOpenedAt": 123,
        }
    ]


@pytest.mark.asyncio
async def test_one_server_isolates_duplicate_session_ids_by_workspace(
    tmp_path: Path,
    aiohttp_client,
) -> None:
    workspace_a = tmp_path / "workspace-a"
    workspace_b = tmp_path / "workspace-b"
    workspace_a.mkdir()
    workspace_b.mkdir()
    registry = ProjectRegistry(tmp_path / "projects.json")
    project_a = await registry.register(workspace_a, now=1)
    project_b = await registry.register(workspace_b, now=2)
    base_config = _test_config(tmp_path / "root")

    def config_for(workspace: Path) -> ChumpConfig:
        return replace(
            base_config,
            workspace_root=workspace,
            data_dir=workspace / ".state",
        )

    runtimes = WorkspaceRuntimeMap(registry, config_loader=config_for)
    server = ChumpServer(
        base_config,
        projects=registry,
        workspace_runtimes=runtimes,
    )
    client = await aiohttp_client(server.create_app())
    runtime_a = await runtimes.get(project_a.id)
    runtime_b = await runtimes.get(project_b.id)
    assert runtime_a is not None
    assert runtime_b is not None
    agent_a = runtime_a.server.get_or_create("shared-session")
    agent_b = runtime_b.server.get_or_create("shared-session")
    await asyncio.gather(agent_a.start(), agent_b.start())
    await asyncio.gather(
        agent_a.update_state(title="Workspace A session"),
        agent_b.update_state(title="Workspace B session"),
    )
    await asyncio.gather(
        runtime_a.server.evict("shared-session"),
        runtime_b.server.evict("shared-session"),
    )

    response_a, response_b = await asyncio.gather(
        client.get(f"/projects/{project_a.id}/sessions/shared-session/state"),
        client.get(f"/projects/{project_b.id}/sessions/shared-session/state"),
    )
    state_a, state_b = await asyncio.gather(response_a.json(), response_b.json())

    assert response_a.status == 200
    assert response_b.status == 200
    assert state_a["workspace_root"] == str(workspace_a.resolve())
    assert state_b["workspace_root"] == str(workspace_b.resolve())
    assert runtime_a is not runtime_b
    assert state_a["title"] == "Workspace A session"
    assert state_b["title"] == "Workspace B session"
    assert agent_a is not agent_b

    messages_response, status_response = await asyncio.gather(
        client.get(
            f"/projects/{project_a.id}/sessions/shared-session/messages"
        ),
        client.post(
            f"/projects/{project_a.id}/sessions/shared-session/action/status",
            json={},
        ),
    )
    assert messages_response.status == 200
    assert status_response.status == 200
    assert (await status_response.json())["result"]["workspace_root"] == str(
        workspace_a.resolve()
    )

    duplicate_response = await client.post(
        f"/projects/{project_a.id}/sessions",
        json={"sessionId": "shared-session"},
    )
    created_response = await client.post(
        f"/projects/{project_a.id}/sessions",
        json={},
    )
    assert duplicate_response.status == 409
    assert created_response.status == 201
    assert (await created_response.json())["projectId"] == project_a.id

    await asyncio.gather(
        runtime_a.server.evict("shared-session"),
        runtime_b.server.evict("shared-session"),
    )

    sessions_a, sessions_b = await asyncio.gather(
        client.get(f"/projects/{project_a.id}/sessions"),
        client.get(f"/projects/{project_b.id}/sessions"),
    )
    sessions_payload_a, sessions_payload_b = await asyncio.gather(
        sessions_a.json(),
        sessions_b.json(),
    )
    assert [item["id"] for item in sessions_payload_a["sessions"]] == [
        "shared-session"
    ]
    assert [item["id"] for item in sessions_payload_b["sessions"]] == [
        "shared-session"
    ]
    assert sessions_payload_a["sessions"][0]["active"] is False
    assert sessions_payload_b["sessions"][0]["active"] is False

    projects_response = await client.get("/projects")
    projects_payload = await projects_response.json()
    assert [project["id"] for project in projects_payload["projects"]] == [
        project_b.id,
        project_a.id,
    ]

    workspace_c = tmp_path / "workspace-c"
    workspace_c.mkdir()
    register_response = await client.post(
        "/projects",
        json={
            "workspacePath": str(workspace_c),
            "name": "Workspace C",
            "approved": True,
        },
    )
    assert register_response.status == 201
    project_c = (await register_response.json())["project"]
    rename_response = await client.patch(
        f"/projects/{project_c['id']}",
        json={"name": "Renamed C"},
    )
    assert (await rename_response.json())["project"]["name"] == "Renamed C"
    get_response = await client.get(f"/projects/{project_c['id']}")
    assert get_response.status == 200
    runtime_c = await runtimes.get(project_c["id"])
    assert runtime_c is not None
    remove_response = await client.delete(f"/projects/{project_c['id']}")
    assert remove_response.status == 204
    assert runtime_c not in runtimes.values()
    assert await runtimes.get(project_c["id"]) is None

    assert await runtimes.evict(project_a.id) is True
    assert await runtimes.get(project_b.id) is runtime_b


@pytest.mark.asyncio
async def test_project_sessions_are_listed_newest_first(
    tmp_path: Path,
    aiohttp_client,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    registry = ProjectRegistry(tmp_path / "projects.json")
    project = await registry.register(workspace, now=1)
    base_config = _test_config(tmp_path / "root")

    def config_for(target: Path) -> ChumpConfig:
        return replace(
            base_config,
            workspace_root=target,
            data_dir=target / ".state",
        )

    runtimes = WorkspaceRuntimeMap(registry, config_loader=config_for)
    server = ChumpServer(
        base_config,
        projects=registry,
        workspace_runtimes=runtimes,
    )
    client = await aiohttp_client(server.create_app())
    runtime = await runtimes.get(project.id)
    assert runtime is not None

    older = runtime.server.get_or_create("older-session")
    newer = runtime.server.get_or_create("newer-session")
    await asyncio.gather(older.start(), newer.start())
    await older.update_state(title="Older", created_at=10, updated_at=10)
    await newer.update_state(title="Newer", created_at=20, updated_at=20)
    await asyncio.gather(
        runtime.server.evict("older-session"),
        runtime.server.evict("newer-session"),
    )

    oldest = runtime.server.get_or_create("oldest-session")
    await oldest.start()
    await oldest.update_state(title="Oldest", created_at=5, updated_at=5)
    await runtime.server.evict("oldest-session")

    response = await client.get(f"/projects/{project.id}/sessions?limit=2")
    payload = await response.json()

    assert response.status == 200
    assert [item["id"] for item in payload["sessions"]] == [
        "newer-session",
        "older-session",
    ]


@pytest.mark.asyncio
async def test_persisted_session_cannot_move_to_another_workspace(
    tmp_path: Path,
) -> None:
    workspace_a = tmp_path / "workspace-a"
    workspace_b = tmp_path / "workspace-b"
    config_a = _test_config(workspace_a)
    config_b = _test_config(workspace_b)
    storage = SQLiteStorage(str(tmp_path / "shared.sqlite3"))
    agent_a = bind_chump_agent(config_a, storage=storage)("fixed-session")
    agent_b = bind_chump_agent(config_b, storage=storage)("fixed-session")

    async with agent_a:
        await agent_a.update_state(title="Fixed session")

    with pytest.raises(ValueError, match="belongs to workspace"):
        await agent_b.start()

    await agent_b.stop()
    storage.close()


def _test_config(workspace_root: Path) -> ChumpConfig:
    workspace_root.mkdir(parents=True, exist_ok=True)
    return ChumpConfig(
        host="127.0.0.1",
        port=0,
        workspace_root=workspace_root.resolve(),
        data_dir=workspace_root / ".state",
        provider="faux",
        model="faux-1",
        max_steps=4,
        retry_max_attempts=1,
        retry_initial_delay=0,
        retry_max_delay=0,
        retry_backoff=1,
        retry_jitter=False,
        command_timeout=10,
        managed_idle_timeout=None,
        compaction_tokens=None,
        compaction_keep_recent_tokens=1_000,
        reasoning=None,
        verbose=False,
        allowed_origins=(),
        available_providers=("faux",),
    )
