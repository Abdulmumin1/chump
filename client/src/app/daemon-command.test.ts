import assert from "node:assert/strict";
import test from "node:test";

import { parseDaemonCommand } from "./daemon-command.ts";

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
