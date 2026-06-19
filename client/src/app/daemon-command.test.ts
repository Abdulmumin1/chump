import assert from "node:assert/strict";
import test from "node:test";

import { daemonSpawnCommand, parseDaemonCommand } from "./daemon-command.ts";

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
