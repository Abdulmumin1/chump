import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkForUpdate,
  currentClientVersion,
  formatUpdateNotice,
} from "./update.ts";

test("renders client and server update notices", () => {
  assert.equal(
    formatUpdateNotice({
      currentVersion: "0.1.0",
      latestVersion: "0.1.4",
      updateAvailable: true,
      currentServerVersion: "0.0.38",
      latestServerVersion: "0.0.40",
      serverUpdateAvailable: true,
    }),
    "update available: chump 0.1.0 -> 0.1.4, server 0.0.38 -> 0.0.40; run `chump update`",
  );
});

test("renders server-only update notices", () => {
  assert.equal(
    formatUpdateNotice({
      currentVersion: "0.1.4",
      latestVersion: "0.1.4",
      updateAvailable: false,
      currentServerVersion: "0.0.38",
      latestServerVersion: "0.0.40",
      serverUpdateAvailable: true,
    }),
    "update available: server 0.0.38 -> 0.0.40; run `chump update`",
  );
});

test("hides notice when nothing is outdated", () => {
  assert.equal(
    formatUpdateNotice({
      currentVersion: "0.1.4",
      latestVersion: "0.1.4",
      updateAvailable: false,
      currentServerVersion: "0.0.40",
      latestServerVersion: "0.0.40",
      serverUpdateAvailable: false,
    }),
    null,
  );
});

test("refreshes past a fresh up-to-date cache entry", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "chump-update-test-"));
  const originalConfigDir = process.env.CHUMP_AGENT_DIR;
  const originalCi = process.env.CI;
  const originalFetch = globalThis.fetch;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  let npmRequests = 0;

  process.env.CHUMP_AGENT_DIR = configDir;
  delete process.env.CI;
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  await writeFile(
    path.join(configDir, "update-check.json"),
    JSON.stringify({
      checkedAt: Date.now(),
      latestVersion: currentClientVersion(),
    }),
  );
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("registry.npmjs.org")) {
      npmRequests += 1;
      return new Response(JSON.stringify({ version: "9.9.9" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  try {
    const info = await checkForUpdate({ refresh: true });
    assert.equal(npmRequests, 1);
    assert.equal(info?.latestVersion, "9.9.9");
    assert.equal(info?.updateAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (ttyDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
    } else {
      Reflect.deleteProperty(process.stdout, "isTTY");
    }
    if (originalConfigDir === undefined) {
      delete process.env.CHUMP_AGENT_DIR;
    } else {
      process.env.CHUMP_AGENT_DIR = originalConfigDir;
    }
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
    await rm(configDir, { recursive: true, force: true });
  }
});
