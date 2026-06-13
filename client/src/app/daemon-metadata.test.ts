import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDaemonMetadata,
  DaemonMetadataStore,
} from "./daemon-metadata.ts";

test("creates valid loopback daemon metadata", () => {
  assert.deepEqual(createDaemonMetadata(123, 5740, "2026-06-13T00:00:00.000Z"), {
    protocolVersion: 1,
    pid: 123,
    host: "127.0.0.1",
    port: 5740,
    url: "http://127.0.0.1:5740",
    startedAt: "2026-06-13T00:00:00.000Z",
  });
  assert.throws(() => createDaemonMetadata(0, 5740), /invalid daemon pid/);
  assert.throws(() => createDaemonMetadata(123, 70_000), /invalid daemon port/);
});

test("persists and reads daemon metadata atomically", async () => {
  const metadataPath = await temporaryMetadataPath();
  const store = new DaemonMetadataStore({ metadataPath });
  const metadata = createDaemonMetadata(123, 5740);

  await store.write(metadata);

  assert.deepEqual(await store.read(), metadata);
  assert.deepEqual(JSON.parse(await readFile(metadataPath, "utf8")), metadata);
});

test("clears stale metadata but preserves replacement metadata", async () => {
  const metadataPath = await temporaryMetadataPath();
  const store = new DaemonMetadataStore({
    metadataPath,
    processIsAlive: () => false,
  });
  await store.write(createDaemonMetadata(123, 5740));

  assert.equal(await store.readActive(), null);
  assert.equal(await store.read(), null);

  await store.write(createDaemonMetadata(456, 5741));
  assert.equal(await store.clear(123), false);
  assert.equal((await store.read())?.pid, 456);
  assert.equal(await store.clear(456), true);
  assert.equal(await store.read(), null);
});

test("rejects malformed or incompatible metadata", async () => {
  const metadataPath = await temporaryMetadataPath();
  const store = new DaemonMetadataStore({ metadataPath });
  await writeFile(
    metadataPath,
    JSON.stringify({
      protocolVersion: 99,
      pid: 123,
      host: "0.0.0.0",
      port: 5740,
      url: "http://0.0.0.0:5740",
      startedAt: "invalid",
    }),
  );

  await assert.rejects(store.read(), /invalid Chump daemon metadata/);
});

async function temporaryMetadataPath(): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-daemon-metadata-"));
  return path.join(rootPath, "daemon.json");
}
