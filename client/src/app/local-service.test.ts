import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseServiceRegistration,
  ServiceRegistrationStore,
  serviceHealthMatchesRegistration,
  serviceVersionIsCompatible,
  stopLocalService,
  type ServiceRegistration,
} from "./local-service.ts";

const REGISTRATION: ServiceRegistration = {
  version: 1,
  url: "http://127.0.0.1:38136",
  pid: 1234,
  serverVersion: "0.2.1",
  instanceId: "instance-one",
  token: "secret-token-that-is-long-enough-for-service-auth",
  startedAt: "2026-08-24T00:00:00.000Z",
};

test("parses a private loopback service registration", () => {
  assert.deepEqual(parseServiceRegistration(REGISTRATION), REGISTRATION);
});

test("rejects loose or remote service registrations", () => {
  assert.throws(
    () => parseServiceRegistration({ ...REGISTRATION, pid: "1234" }),
    /invalid Chump service registration/,
  );
  assert.throws(
    () => parseServiceRegistration({ ...REGISTRATION, url: "https://example.com" }),
    /invalid Chump service registration/,
  );
  assert.throws(
    () => parseServiceRegistration({ ...REGISTRATION, token: "short" }),
    /invalid Chump service registration/,
  );
});

test("registration store only clears the expected service instance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chump-service-store-"));
  const registrationPath = path.join(directory, "service.json");
  const store = new ServiceRegistrationStore(registrationPath);
  await writeFile(registrationPath, `${JSON.stringify(REGISTRATION)}\n`, "utf8");

  assert.deepEqual(await store.read(), REGISTRATION);
  assert.equal(await store.clear("another-instance"), false);
  assert.deepEqual(await store.read(), REGISTRATION);
  assert.equal(await store.clear(REGISTRATION.instanceId), true);
  assert.equal(await store.read(), null);
});

test("registration store removes malformed data", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chump-service-invalid-"));
  const registrationPath = path.join(directory, "service.json");
  const store = new ServiceRegistrationStore(registrationPath);
  await writeFile(registrationPath, "{truncated", "utf8");

  assert.equal(await store.read(), null);
  assert.equal(await store.read(), null);
});

test("stop treats a corrupt registration as stale", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chump-service-invalid-"));
  const previousState = process.env.CHUMP_GLOBAL_STATE_DIR;
  process.env.CHUMP_GLOBAL_STATE_DIR = directory;
  await writeFile(path.join(directory, "service.json"), "{truncated", "utf8");

  try {
    assert.equal(await stopLocalService(), "service is not running");
    assert.equal(await new ServiceRegistrationStore().read(), null);
  } finally {
    restoreEnvironment("CHUMP_GLOBAL_STATE_DIR", previousState);
  }
});

test("health must identify the exact registered process", () => {
  const health = {
    status: "ok" as const,
    service: "chump-server" as const,
    version: REGISTRATION.serverVersion,
    instance_id: REGISTRATION.instanceId,
    process_id: REGISTRATION.pid,
  };

  assert.equal(serviceHealthMatchesRegistration(health, REGISTRATION), true);
  assert.equal(
    serviceHealthMatchesRegistration(
      { ...health, instance_id: "another-instance" },
      REGISTRATION,
    ),
    false,
  );
  assert.equal(
    serviceHealthMatchesRegistration(
      { ...health, process_id: REGISTRATION.pid + 1 },
      REGISTRATION,
    ),
    false,
  );
});

test("bundled services require the expected server version", () => {
  assert.equal(serviceVersionIsCompatible("bundled", "0.2.1", "0.2.1"), true);
  assert.equal(serviceVersionIsCompatible("bundled", "0.2.0", "0.2.1"), false);
  assert.equal(serviceVersionIsCompatible("local", "dev", "0.2.1"), true);
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
