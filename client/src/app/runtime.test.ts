import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { workspaceLockIsStale } from "./runtime.ts";

test("detects workspace locks left by exited processes", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-runtime-lock-"));
  const lockDir = path.join(rootPath, "server.lock");
  await mkdir(lockDir);
  await writeFile(
    path.join(lockDir, "owner.json"),
    JSON.stringify({ pid: 999_999_999, createdAt: Date.now() }),
  );

  assert.equal(await workspaceLockIsStale(lockDir), true);
});

test("keeps workspace locks owned by the current process", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-runtime-lock-"));
  const lockDir = path.join(rootPath, "server.lock");
  await mkdir(lockDir);
  await writeFile(
    path.join(lockDir, "owner.json"),
    JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
  );

  assert.equal(await workspaceLockIsStale(lockDir), false);
});
