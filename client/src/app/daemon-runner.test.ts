import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DaemonMetadataStore } from "./daemon-metadata.ts";
import { startDaemon } from "./daemon-runner.ts";
import { ProjectRuntimeSupervisor } from "./project-runtime.ts";
import { ProjectRegistryStore } from "./projects.ts";

test("publishes metadata and removes it after shutdown", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-daemon-runner-"));
  const metadataStore = new DaemonMetadataStore({
    metadataPath: path.join(rootPath, "daemon.json"),
    processIsAlive: () => true,
  });
  const daemon = await startDaemon({
    metadataStore,
    pid: 123,
    version: "test-version",
    startedAt: "2026-06-13T00:00:00.000Z",
    authToken: "test-token-that-is-long-enough-for-auth",
  });

  assert.deepEqual(await metadataStore.read(), daemon.metadata);
  const response = await fetch(`${daemon.metadata.url}/health`);
  assert.equal(response.status, 200);

  await Promise.all([daemon.close(), daemon.close()]);
  assert.equal(await metadataStore.read(), null);
});

test("does not remove metadata replaced by another daemon", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-daemon-runner-"));
  const metadataStore = new DaemonMetadataStore({
    metadataPath: path.join(rootPath, "daemon.json"),
    processIsAlive: () => true,
  });
  const daemon = await startDaemon({
    metadataStore,
    pid: 123,
    authToken: "test-token-that-is-long-enough-for-auth",
  });
  const replacement = {
    ...daemon.metadata,
    pid: 456,
  };
  await metadataStore.write(replacement);

  await daemon.close();

  assert.deepEqual(await metadataStore.read(), replacement);
});

test("stops supervised project runtimes during daemon shutdown", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-daemon-runner-"));
  const projectStore = new ProjectRegistryStore({
    registryPath: path.join(rootPath, "projects.json"),
  });
  let stopped = false;
  const runtimeSupervisor = new ProjectRuntimeSupervisor(projectStore, {
    stopServer: async () => {
      stopped = true;
      return "stopped";
    },
  });
  runtimeSupervisor.stopAll = async () => {
    stopped = true;
  };
  const daemon = await startDaemon({
    projectStore,
    runtimeSupervisor,
    metadataStore: new DaemonMetadataStore({
      metadataPath: path.join(rootPath, "daemon.json"),
    }),
    authToken: "test-token-that-is-long-enough-for-auth",
  });

  await daemon.close();

  assert.equal(stopped, true);
});
