import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseProjectCommand,
  runProjectCommand,
} from "./project-command.ts";
import { ProjectRegistryStore } from "./projects.ts";

test("parses project commands with a strict grammar", () => {
  assert.deepEqual(parseProjectCommand([], "/workspace"), { action: "list" });
  assert.deepEqual(parseProjectCommand(["list"], "/workspace"), { action: "list" });
  assert.deepEqual(
    parseProjectCommand(["add", "./repo", "--name", "Repo"], "/workspace"),
    {
      action: "add",
      workspacePath: path.resolve("/workspace/repo"),
      name: "Repo",
    },
  );
  assert.deepEqual(parseProjectCommand(["remove", "project-123"], "/workspace"), {
    action: "remove",
    projectId: "project-123",
  });
  assert.throws(
    () => parseProjectCommand(["add", "one", "two"], "/workspace"),
    /unexpected projects add argument/,
  );
  assert.throws(
    () => parseProjectCommand(["remove"], "/workspace"),
    /missing project id/,
  );
});

test("adds, lists, and removes projects", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-project-command-"));
  const workspacePath = path.join(rootPath, "workspace");
  await mkdir(workspacePath);
  const store = new ProjectRegistryStore({
    registryPath: path.join(rootPath, "projects.json"),
    now: () => 100,
  });

  const added = await runProjectCommand(
    { action: "add", workspacePath, name: "Example" },
    store,
  );
  const projectId = added.split("\t")[0]!;

  assert.match(added, new RegExp(`^${projectId}\\tExample\\t`));
  assert.equal(await runProjectCommand({ action: "list" }, store), added);
  assert.equal(
    await runProjectCommand({ action: "remove", projectId }, store),
    `removed ${projectId}`,
  );
  assert.equal(await runProjectCommand({ action: "list" }, store), "No projects registered.");
  await assert.rejects(
    runProjectCommand({ action: "remove", projectId }, store),
    /project not found/,
  );
});
