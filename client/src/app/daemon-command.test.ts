import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DAEMON_PORT,
  DEFAULT_DAEMON_URL,
} from "./daemon-port.ts";
import {
  daemonSpawnCommand,
  isCompatibleDaemonHealth,
  parseDaemonCommand,
} from "./daemon-command.ts";
import { createDaemonMetadata } from "./daemon-metadata.ts";

test("parses daemon commands with a strict grammar", () => {
  assert.equal(parseDaemonCommand([]), "status");
  assert.equal(parseDaemonCommand(["start"]), "start");
  assert.equal(parseDaemonCommand(["status"]), "status");
  assert.equal(parseDaemonCommand(["stop"]), "stop");
  assert.throws(
    () => parseDaemonCommand(["restart"]),
    /unknown daemon command/,
  );
  assert.throws(
    () => parseDaemonCommand(["start", "extra"]),
    /unexpected daemon argument/,
  );
});

test("uses the chmp-derived stable default daemon port", () => {
  assert.equal(DEFAULT_DAEMON_PORT, 38136);
  assert.equal(DEFAULT_DAEMON_URL, "http://127.0.0.1:38136");
});

test("builds daemon spawn commands for source and standalone runtimes", () => {
  assert.deepEqual(
    daemonSpawnCommand("/usr/local/bin/node", ["/usr/local/bin/node", "/repo/client/src/chump.ts"]),
    {
      file: "/usr/local/bin/node",
      args: ["/repo/client/src/chump.ts", "__daemon"],
    },
  );
  assert.deepEqual(
    daemonSpawnCommand("/Users/me/.chump/bin/chump", [
      "/Users/me/.chump/bin/chump",
      "/$bunfs/root/chump-darwin-arm64",
    ]),
    {
      file: "/Users/me/.chump/bin/chump",
      args: ["__daemon"],
    },
  );
  assert.throws(
    () => daemonSpawnCommand("/usr/local/bin/node", ["/usr/local/bin/node"]),
    /cannot determine Chump executable path/,
  );
});

test("only reuses a daemon from the current client version", () => {
  const metadata = createDaemonMetadata(123, 5740);
  assert.equal(
    isCompatibleDaemonHealth(metadata, {
      service: "chump-daemon",
      protocolVersion: metadata.protocolVersion,
      version: "0.2.13",
    }, "0.2.13"),
    true,
  );
  assert.equal(
    isCompatibleDaemonHealth(metadata, {
      service: "chump-daemon",
      protocolVersion: metadata.protocolVersion,
      version: "0.2.12",
    }, "0.2.13"),
    false,
  );
});
