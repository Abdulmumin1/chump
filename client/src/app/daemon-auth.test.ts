import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  authorizeBearerHeader,
  DaemonAuthStore,
} from "./daemon-auth.ts";

test("creates and reuses a private daemon token", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-daemon-auth-"));
  const authPath = path.join(rootPath, "daemon-auth.json");
  let tokenCreations = 0;
  const store = new DaemonAuthStore({
    authPath,
    createToken: () => {
      tokenCreations += 1;
      return "a".repeat(43);
    },
    now: () => new Date("2026-06-13T00:00:00.000Z"),
  });

  assert.equal(await store.getOrCreateToken(), "a".repeat(43));
  assert.equal(await store.getOrCreateToken(), "a".repeat(43));
  assert.equal(tokenCreations, 1);
  assert.equal((await stat(authPath)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(authPath, "utf8")), {
    version: 1,
    token: "a".repeat(43),
    createdAt: "2026-06-13T00:00:00.000Z",
  });
});

test("rejects malformed auth files", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-daemon-auth-"));
  const authPath = path.join(rootPath, "daemon-auth.json");
  await writeFile(authPath, JSON.stringify({ version: 1, token: "short" }));

  await assert.rejects(
    new DaemonAuthStore({ authPath }).readToken(),
    /invalid Chump daemon auth file/,
  );
});

test("validates bearer credentials without accepting malformed headers", () => {
  const token = "secret-token-value-that-is-long-enough";
  assert.equal(authorizeBearerHeader(`Bearer ${token}`, token), true);
  assert.equal(authorizeBearerHeader(`Bearer ${token}x`, token), false);
  assert.equal(authorizeBearerHeader(token, token), false);
  assert.equal(authorizeBearerHeader(undefined, token), false);
});
