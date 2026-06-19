import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDaemonConnectUrl,
  DEFAULT_CHUMP_WEB_URL,
  parseAppCommand,
} from "./app-command.ts";

test("parses app command options", () => {
  assert.deepEqual(parseAppCommand([]), {
    open: true,
    json: false,
  });
  assert.deepEqual(
    parseAppCommand(["--web-url", "http://localhost:5173", "--no-open"]),
    {
      webUrl: "http://localhost:5173",
      open: false,
      json: false,
    },
  );
  assert.deepEqual(parseAppCommand(["--json"]), {
    open: false,
    json: true,
  });
  assert.throws(
    () => parseAppCommand(["--web-url"]),
    /missing URL/,
  );
  assert.throws(
    () => parseAppCommand(["extra"]),
    /unexpected app argument/,
  );
});

test("builds daemon web connect URLs for local development", () => {
  assert.equal(
    buildDaemonConnectUrl(
      "http://localhost:5173/?theme=dark",
      "http://127.0.0.1:53080",
      "secret-token",
    ),
    "http://localhost:5173/?theme=dark#daemonUrl=http%3A%2F%2F127.0.0.1%3A53080&daemonToken=secret-token",
  );
  assert.throws(
    () =>
      buildDaemonConnectUrl(
        "https://chump.example.com",
        "http://127.0.0.1:53080",
        "secret-token",
      ),
    /loopback URL/,
  );
});

test("allows the trusted hosted chump web app", () => {
  assert.equal(
    buildDaemonConnectUrl(
      DEFAULT_CHUMP_WEB_URL,
      "http://127.0.0.1:53080",
      "secret-token",
    ),
    "https://chump.yaqeen.me/#daemonUrl=http%3A%2F%2F127.0.0.1%3A53080&daemonToken=secret-token",
  );
});
