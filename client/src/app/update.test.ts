import assert from "node:assert/strict";
import test from "node:test";

import { formatUpdateNotice } from "./update.ts";

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
