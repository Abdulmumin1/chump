import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DaemonMetadataStore } from "./daemon-metadata.ts";
import { startDaemon } from "./daemon-runner.ts";

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
  });
  const replacement = {
    ...daemon.metadata,
    pid: 456,
  };
  await metadataStore.write(replacement);

  await daemon.close();

  assert.deepEqual(await metadataStore.read(), replacement);
});
