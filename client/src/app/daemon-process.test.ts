import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_DAEMON_PORT } from "./daemon-port.ts";
import { readConfiguredDaemonPort } from "./daemon-process.ts";

test("daemon defaults to the chmp-derived stable port", () => {
  const previous = process.env.CHUMP_DAEMON_PORT;
  delete process.env.CHUMP_DAEMON_PORT;
  try {
    assert.equal(readConfiguredDaemonPort(), DEFAULT_DAEMON_PORT);
  } finally {
    if (previous === undefined) delete process.env.CHUMP_DAEMON_PORT;
    else process.env.CHUMP_DAEMON_PORT = previous;
  }
});

test("daemon port can be overridden by environment", () => {
  const previous = process.env.CHUMP_DAEMON_PORT;
  process.env.CHUMP_DAEMON_PORT = "49152";
  try {
    assert.equal(readConfiguredDaemonPort(), 49152);
  } finally {
    if (previous === undefined) delete process.env.CHUMP_DAEMON_PORT;
    else process.env.CHUMP_DAEMON_PORT = previous;
  }
});
