import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ProjectRegistryStore,
  projectIdForPath,
} from "./projects.ts";

test("registers and persists a project", async () => {
  const fixture = await createFixture();
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
    now: () => 100,
  });

  const project = await store.register(fixture.workspacePath);
  const canonicalWorkspacePath = await realpath(fixture.workspacePath);

  assert.equal(project.name, "workspace");
  assert.equal(project.workspacePath, canonicalWorkspacePath);
  assert.equal(project.id, projectIdForPath(canonicalWorkspacePath));
  assert.deepEqual(await store.list(), [project]);

  const persisted = JSON.parse(await readFile(fixture.registryPath, "utf8"));
  assert.equal(persisted.version, 1);
  assert.deepEqual(persisted.projects, [project]);
});

test("deduplicates canonical workspace paths and updates recency", async (t) => {
  const fixture = await createFixture();
  const aliasPath = path.join(fixture.rootPath, "workspace-alias");
  try {
    await symlink(fixture.workspacePath, aliasPath, "dir");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      t.skip("directory symlinks are not permitted");
      return;
    }
    throw error;
  }
  let now = 100;
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
    now: () => now,
  });

  const first = await store.register(fixture.workspacePath);
  now = 200;
  const second = await store.register(aliasPath, "Renamed");

  assert.equal(second.id, first.id);
  assert.equal(second.name, "Renamed");
  assert.equal(second.createdAt, 100);
  assert.equal(second.lastOpenedAt, 200);
  assert.equal((await store.list()).length, 1);
});

test("removes projects without touching the workspace", async () => {
  const fixture = await createFixture();
  const store = new ProjectRegistryStore({ registryPath: fixture.registryPath });
  const project = await store.register(fixture.workspacePath);

  assert.equal(await store.remove(project.id), true);
  assert.equal(await store.remove(project.id), false);
  assert.deepEqual(await store.list(), []);
  assert.equal(await readFile(path.join(fixture.workspacePath, "marker"), "utf8"), "ok");
});

test("rejects missing workspaces and malformed registries", async () => {
  const fixture = await createFixture();
  const store = new ProjectRegistryStore({ registryPath: fixture.registryPath });

  await assert.rejects(
    store.register(path.join(fixture.rootPath, "missing")),
    /workspace does not exist/,
  );

  await mkdir(path.dirname(fixture.registryPath), { recursive: true });
  await writeFile(fixture.registryPath, "{\"version\":99,\"projects\":[]}\n");
  await assert.rejects(store.list(), /invalid Chump project registry/);
});

async function createFixture(): Promise<{
  rootPath: string;
  workspacePath: string;
  registryPath: string;
}> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-projects-"));
  const workspacePath = path.join(rootPath, "workspace");
  await mkdir(workspacePath);
  await writeFile(path.join(workspacePath, "marker"), "ok");
  return {
    rootPath,
    workspacePath,
    registryPath: path.join(rootPath, "state", "projects.json"),
  };
}
