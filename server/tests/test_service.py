from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

import pytest
from aiohttp import web

from chump_server.service import (
    SERVICE_REGISTRATION_VERSION,
    ServiceRegistration,
    ServiceRegistrationStore,
    service_auth_middleware,
    service_registration_key,
    service_scope_middleware,
)


def registration() -> ServiceRegistration:
    return ServiceRegistration(
        version=SERVICE_REGISTRATION_VERSION,
        url="http://127.0.0.1:38136",
        pid=os.getpid(),
        server_version="1.2.3",
        instance_id="instance-one",
        token="secret-token-that-is-long-enough-for-service-auth",
        started_at="2026-08-24T00:00:00+00:00",
    )


def test_registration_store_round_trips_and_clears_its_own_instance(
    tmp_path: Path,
) -> None:
    path = tmp_path / "service.json"
    store = ServiceRegistrationStore(path)
    expected = registration()

    store.write(expected)

    assert store.read() == expected
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600
    assert store.clear("another-instance") is False
    assert path.exists()
    assert store.clear(expected.instance_id) is True
    assert store.read() is None


def test_registration_store_does_not_replace_another_instance(tmp_path: Path) -> None:
    store = ServiceRegistrationStore(tmp_path / "service.json")
    existing = registration()
    replacement = replace(existing, instance_id="instance-two")
    store.write(existing)

    with pytest.raises(RuntimeError, match="already exists"):
        store.write(replacement)

    assert store.read() == existing


def test_registration_requires_a_loopback_service() -> None:
    with pytest.raises(ValueError, match="127.0.0.1"):
        ServiceRegistration.create(
            host="0.0.0.0",
            port=38136,
            server_version="1.2.3",
            started_at="2026-08-24T00:00:00+00:00",
        )


@pytest.mark.asyncio
async def test_service_auth_protects_api_routes_but_not_health(aiohttp_client) -> None:
    async def health_handler(request):
        return web.json_response({"status": "ok"})

    async def projects_handler(request):
        return web.json_response({"projects": []})

    app = web.Application(middlewares=[service_auth_middleware])
    app[service_registration_key] = registration()
    app.router.add_get("/health", health_handler)
    app.router.add_get("/projects", projects_handler)
    client = await aiohttp_client(app)

    health = await client.get("/health")
    unauthorized = await client.get("/projects")
    authorized = await client.get(
        "/projects",
        headers={"authorization": f"Bearer {registration().token}"},
    )

    assert health.status == 200
    assert unauthorized.status == 401
    assert await unauthorized.json() == {"error": "unauthorized"}
    assert authorized.status == 200


@pytest.mark.asyncio
async def test_service_auth_accepts_the_websocket_protocol_token(
    aiohttp_client,
) -> None:
    async def socket_handler(request):
        return web.Response(status=204)

    app = web.Application(middlewares=[service_auth_middleware])
    app[service_registration_key] = registration()
    app.router.add_get("/socket", socket_handler)
    client = await aiohttp_client(app)

    response = await client.get(
        "/socket",
        headers={
            "sec-websocket-protocol": f"chump-terminal-v1, chump-auth.{registration().token}"
        },
    )

    assert response.status == 204


@pytest.mark.asyncio
async def test_service_scope_rejects_unscoped_workspace_routes(aiohttp_client) -> None:
    async def ok(request):
        return web.Response(status=204)

    app = web.Application(
        middlewares=[service_auth_middleware, service_scope_middleware]
    )
    app[service_registration_key] = registration()
    app.router.add_get("/agent/{agent_id}/messages", ok)
    app.router.add_get("/projects/{project_id}/sessions", ok)
    client = await aiohttp_client(app)
    headers = {"authorization": f"Bearer {registration().token}"}

    unscoped = await client.get("/agent/session-one/messages", headers=headers)
    scoped = await client.get("/projects/project-one/sessions", headers=headers)

    assert unscoped.status == 404
    assert scoped.status == 204
