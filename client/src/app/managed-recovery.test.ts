import assert from "node:assert/strict";
import test from "node:test";

import {
  ManagedServerRequestCoordinator,
  reloadManagedServerUrl,
  recoverManagedServerUrl,
} from "./managed-recovery.ts";
import type { ChumpConfig } from "../core/types.ts";

test("recovers through the daemon before using direct fallback", async () => {
  let directCalls = 0;
  const url = await recoverManagedServerUrl("/workspace", "http://old", {
    recoverThroughDaemon: async (workspace) => {
      assert.equal(workspace, "/workspace");
      return "http://daemon-runtime";
    },
    recoverDirectly: async () => {
      directCalls += 1;
      return "http://direct";
    },
  });

  assert.equal(url, "http://daemon-runtime");
  assert.equal(directCalls, 0);
});

test("falls back to direct managed recovery when daemon recovery fails", async () => {
  const url = await recoverManagedServerUrl("/workspace", "http://old", {
    recoverThroughDaemon: async () => {
      throw new Error("daemon unavailable");
    },
    recoverDirectly: async (workspace, previousUrl) => {
      assert.equal(workspace, "/workspace");
      assert.equal(previousUrl, "http://old");
      return "http://direct";
    },
  });

  assert.equal(url, "http://direct");
});

test("reload stops the managed server before recovering it", async () => {
  const calls: string[] = [];
  const url = await reloadManagedServerUrl("/workspace", "http://old", {
    stopManagedServer: async (workspace) => {
      calls.push(`stop:${workspace}`);
      return "stopped";
    },
    recoverThroughDaemon: async (workspace) => {
      calls.push(`recover:${workspace}`);
      return "http://new";
    },
  });

  assert.equal(url, "http://new");
  assert.deepEqual(calls, ["stop:/workspace", "recover:/workspace"]);
});

test("replays the failed request against the recovered server URL", async () => {
  let current = config("http://dead");
  const requestConfig = config("http://dead");
  let recoveries = 0;
  const requestedUrls: string[] = [];
  const coordinator = new ManagedServerRequestCoordinator(
    () => current,
    async () => {
      recoveries += 1;
      current = config("http://recovered");
    },
  );

  const result = await coordinator.run(requestConfig, async (latestConfig) => {
    requestedUrls.push(latestConfig.serverUrl);
    if (latestConfig.serverUrl === "http://dead") {
      throw new TypeError("fetch failed");
    }
    return "delivered";
  });

  assert.equal(result, "delivered");
  assert.equal(recoveries, 1);
  assert.deepEqual(requestedUrls, ["http://dead", "http://recovered"]);
  assert.equal(requestConfig.serverUrl, "http://recovered");
});

test("recovers unsafe interrupted work without replaying it", async () => {
  let current = config("http://dead");
  let requests = 0;
  const coordinator = new ManagedServerRequestCoordinator(
    () => current,
    async () => {
      current = config("http://recovered");
    },
  );

  await assert.rejects(
    coordinator.run(
      current,
      async () => {
        requests += 1;
        throw new TypeError("fetch failed");
      },
      { canReplay: () => false },
    ),
    /fetch failed/,
  );

  assert.equal(current.serverUrl, "http://recovered");
  assert.equal(requests, 1);
});

test("coalesces simultaneous recovery attempts", async () => {
  let current = config("http://dead");
  let recoveries = 0;
  let releaseRecovery!: () => void;
  const recoveryGate = new Promise<void>((resolve) => {
    releaseRecovery = resolve;
  });
  const coordinator = new ManagedServerRequestCoordinator(
    () => current,
    async () => {
      recoveries += 1;
      await recoveryGate;
      current = config("http://recovered");
    },
  );
  const request = (requestConfig: ChumpConfig) =>
    requestConfig.serverUrl === "http://dead"
      ? Promise.reject(new TypeError("fetch failed"))
      : Promise.resolve("ok");

  const first = coordinator.run(current, request);
  const second = coordinator.run(current, request);
  await Promise.resolve();
  releaseRecovery();

  assert.deepEqual(await Promise.all([first, second]), ["ok", "ok"]);
  assert.equal(recoveries, 1);
});

function config(serverUrl: string): ChumpConfig {
  return {
    agentId: "session-1",
    serverUrl,
    serverSource: "managed",
    workspaceRoot: "/workspace",
  };
}
