from __future__ import annotations

import hmac
import json
import os
import secrets
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aiohttp import web

from .config import global_state_dir

SERVICE_REGISTRATION_VERSION = 1
DEFAULT_SERVICE_PORT = 38136
AUTH_PROTOCOL_PREFIX = "chump-auth."


@dataclass(frozen=True)
class ServiceRegistration:
    version: int
    url: str
    pid: int
    server_version: str
    instance_id: str
    token: str
    started_at: str

    @classmethod
    def create(
        cls,
        *,
        host: str,
        port: int,
        server_version: str,
        started_at: str,
    ) -> ServiceRegistration:
        if host != "127.0.0.1":
            raise ValueError("registered Chump service must bind to 127.0.0.1")
        if port < 1 or port > 65_535:
            raise ValueError(f"invalid Chump service port: {port}")
        return cls(
            version=SERVICE_REGISTRATION_VERSION,
            url=f"http://{host}:{port}",
            pid=os.getpid(),
            server_version=server_version,
            instance_id=str(uuid.uuid4()),
            token=secrets.token_urlsafe(32),
            started_at=started_at,
        )

    def to_dict(self) -> dict[str, int | str]:
        return {
            "version": self.version,
            "url": self.url,
            "pid": self.pid,
            "serverVersion": self.server_version,
            "instanceId": self.instance_id,
            "token": self.token,
            "startedAt": self.started_at,
        }


class ServiceRegistrationStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or global_state_dir() / "service.json"

    def read(self) -> ServiceRegistration | None:
        if not self.path.exists():
            return None
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid Chump service registration: {self.path}") from error
        return parse_service_registration(value, self.path)

    def write(self, registration: ServiceRegistration) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = f"{json.dumps(registration.to_dict(), indent=2)}\n"
        temporary = self.path.with_name(
            f"{self.path.name}.{registration.instance_id}.tmp"
        )
        try:
            temporary.write_text(payload, encoding="utf-8")
            temporary.chmod(0o600)
            os.link(temporary, self.path)
        except FileExistsError as error:
            current = self.read()
            if current == registration:
                return
            raise RuntimeError(
                f"Chump service registration already exists: {self.path}"
            ) from error
        finally:
            temporary.unlink(missing_ok=True)

    def clear(self, instance_id: str) -> bool:
        registration = self.read()
        if registration is None or registration.instance_id != instance_id:
            return False
        self.path.unlink(missing_ok=True)
        return True


@web.middleware
async def service_auth_middleware(
    request: web.Request,
    handler: Any,
) -> web.StreamResponse:
    registration = request.app[service_registration_key]
    if request.method == "OPTIONS" or request.path == "/health":
        return await handler(request)
    if not request_is_authorized(request, registration.token):
        return web.json_response({"error": "unauthorized"}, status=401)
    return await handler(request)


def request_is_authorized(request: web.Request, token: str) -> bool:
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer ") and hmac.compare_digest(
        authorization.removeprefix("Bearer "),
        token,
    ):
        return True
    for header in request.headers.getall("Sec-WebSocket-Protocol", ()):
        for protocol in header.split(","):
            candidate = protocol.strip()
            if candidate.startswith(AUTH_PROTOCOL_PREFIX) and hmac.compare_digest(
                candidate.removeprefix(AUTH_PROTOCOL_PREFIX),
                token,
            ):
                return True
    return False


def parse_service_registration(value: object, path: Path) -> ServiceRegistration:
    if not isinstance(value, dict):
        raise ValueError(f"invalid Chump service registration: {path}")
    version = value.get("version")
    url = value.get("url")
    pid = value.get("pid")
    server_version = value.get("serverVersion")
    instance_id = value.get("instanceId")
    token = value.get("token")
    started_at = value.get("startedAt")
    if (
        version != SERVICE_REGISTRATION_VERSION
        or not isinstance(url, str)
        or isinstance(pid, bool)
        or not isinstance(pid, int)
        or pid < 1
        or not isinstance(server_version, str)
        or not isinstance(instance_id, str)
        or not instance_id
        or not isinstance(token, str)
        or len(token) < 32
        or not isinstance(started_at, str)
        or not started_at
    ):
        raise ValueError(f"invalid Chump service registration: {path}")
    return ServiceRegistration(
        version=version,
        url=url,
        pid=pid,
        server_version=server_version,
        instance_id=instance_id,
        token=token,
        started_at=started_at,
    )


service_registration_key = web.AppKey(
    "chump_service_registration",
    ServiceRegistration,
)
