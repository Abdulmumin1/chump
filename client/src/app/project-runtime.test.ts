import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ManagedServerMetadata } from "../core/types.ts";
import { ProjectRuntimeSupervisor } from "./project-runtime.ts";
import { ProjectRegistryStore } from "./projects.ts";

test("starts, reports, and stops a registered project runtime", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-runtime-"));
  const workspacePath = path.join(rootPath, "workspace");
  await mkdir(workspacePath);
  const projects = new ProjectRegistryStore({
    registryPath: path.join(rootPath, "projects.json"),
  });
  const project = await projects.register(workspacePath);
  let metadata: ManagedServerMetadata | null = null;
  let stoppedWorkspace: string | null = null;
  const supervisor = new ProjectRuntimeSupervisor(projects, {
    ensureServer: async (workspace) => {
      assert.equal(workspace, project.workspacePath);
      metadata = createMetadata(workspace);
      return { started: true, metadata };
    },
    readServer: async () => metadata,
    stopServer: async (workspace) => {
      stoppedWorkspace = workspace;
      metadata = null;
      return "stopped";
    },
  });

  assert.deepEqual(await supervisor.status(project.id), {
    projectId: project.id,
    status: "stopped",
    serverUrl: null,
    pid: null,
  });
  assert.deepEqual(await supervisor.start(project.id), {
    projectId: project.id,
    status: "running",
    serverUrl: "http://127.0.0.1:9000",
    pid: 123,
  });
  assert.equal((await supervisor.status(project.id))?.status, "running");
  assert.equal((await supervisor.stop(project.id))?.status, "stopped");
  assert.equal(stoppedWorkspace, project.workspacePath);
  assert.equal(await supervisor.start("missing"), null);
});

function createMetadata(workspaceRoot: string): ManagedServerMetadata {
  return {
    url: "http://127.0.0.1:9000",
    port: 9000,
    pid: 123,
    command: "server",
    command_args: [],
    command_source: "local",
    workspace_root: workspaceRoot,
    data_dir: "/tmp/chump",
    log_path: "/tmp/chump/server.log",
    started_at: "2026-06-13T00:00:00.000Z",
  };
}
