import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { getGlobalStatePaths } from "./state-paths.ts";

test("global state can be isolated from workspace server state", () => {
  const previousGlobalStateDir = process.env.CHUMP_GLOBAL_STATE_DIR;
  const previousWorkspaceStateDir = process.env.CHUMP_STATE_DIR;
  process.env.CHUMP_GLOBAL_STATE_DIR = "./tmp/global-state";
  process.env.CHUMP_STATE_DIR = "./tmp/workspace-state";

  try {
    const paths = getGlobalStatePaths();
    assert.equal(paths.dataDir, path.resolve("./tmp/global-state"));
    assert.equal(paths.daemonMetadataPath, path.resolve("./tmp/global-state/daemon.json"));
    assert.equal(paths.daemonLockDir, path.resolve("./tmp/global-state/daemon.lock"));
    assert.equal(paths.daemonLogPath, path.resolve("./tmp/global-state/daemon.log"));
    assert.equal(paths.projectsPath, path.resolve("./tmp/global-state/projects.json"));
  } finally {
    restoreEnvironment("CHUMP_GLOBAL_STATE_DIR", previousGlobalStateDir);
    restoreEnvironment("CHUMP_STATE_DIR", previousWorkspaceStateDir);
  }
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
