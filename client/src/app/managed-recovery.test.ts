import assert from "node:assert/strict";
import test from "node:test";

import { recoverManagedServerUrl } from "./managed-recovery.ts";

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
