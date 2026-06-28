import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { normalizeFffPathConstraint } from "./fff-search.ts";

test("encodes workspace directories as FFF directory constraints", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "chump-fff-search-"));
  t.after(async () => await rm(workspace, { recursive: true, force: true }));
  await mkdir(path.join(workspace, "client", "src"), { recursive: true });

  assert.equal(
    normalizeFffPathConstraint("client/src", workspace),
    "client/src/",
  );
  assert.equal(
    normalizeFffPathConstraint("client\\src", workspace),
    "client/src/",
  );
  assert.equal(
    normalizeFffPathConstraint("./client/src", workspace),
    "client/src/",
  );
});

test("preserves exact files, globs, and missing paths", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "chump-fff-search-"));
  t.after(async () => await rm(workspace, { recursive: true, force: true }));
  await mkdir(path.join(workspace, "client", "src"), { recursive: true });
  await writeFile(path.join(workspace, "client", "src", "index.ts"), "");

  assert.equal(
    normalizeFffPathConstraint("client/src/index.ts", workspace),
    "client/src/index.ts",
  );
  assert.equal(
    normalizeFffPathConstraint("client/src/**/*.ts", workspace),
    "client/src/**/*.ts",
  );
  assert.equal(
    normalizeFffPathConstraint("missing/path", workspace),
    "missing/path",
  );
});
