import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installServerRuntimeWith } from "./server-runtime-install.ts";

test("installs a downloaded server runtime atomically and reuses it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chump-runtime-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "data");
  const logs: string[] = [];
  let downloads = 0;
  const options = {
    version: "1.2.3",
    platform: "linux-x64",
    executableName: "chump-server",
    dataRoot,
    releaseBaseUrl: "https://example.test/releases",
    fetchArchive: async (url: string) => {
      downloads += 1;
      assert.equal(
        url,
        "https://example.test/releases/chump-server-v1.2.3/chump-server-linux-x64.tar.gz",
      );
      return new Uint8Array([1, 2, 3]);
    },
    extractArchive: async (_archivePath: string, destination: string) => {
      const runtime = path.join(destination, "chump-server-linux-x64");
      await mkdir(runtime, { recursive: true });
      await writeFile(path.join(runtime, "chump-server"), "runtime");
    },
    log: (message: string) => logs.push(message),
  };

  const first = await installServerRuntimeWith(options);
  const second = await installServerRuntimeWith(options);

  assert.equal(first, second);
  assert.equal(downloads, 1);
  assert.deepEqual(logs, [
    "First run: downloading chump-server 1.2.3 for linux-x64...",
    "Installed chump-server 1.2.3.",
  ]);
});
