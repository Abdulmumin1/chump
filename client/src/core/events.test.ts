import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  CHUMP_EVENT_TYPES,
  parseChumpEvent,
} from "./events.ts";

type Fixture = {
  schema_version: number;
  events: Array<{ type: string; data: unknown }>;
};

test("CLI accepts every shared Chump v1 event fixture", async () => {
  const fixtureUrl = new URL(
    "../../../protocol/fixtures/chump-events-v1.json",
    import.meta.url,
  );
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as Fixture;

  assert.equal(fixture.schema_version, 1);
  assert.deepEqual(
    new Set(fixture.events.map((event) => event.type)),
    new Set(CHUMP_EVENT_TYPES),
  );
  for (const event of fixture.events) {
    assert.deepEqual(parseChumpEvent(event.type, event.data), event);
  }
});

test("CLI upgrades legacy payloads and rejects future or malformed events", () => {
  assert.deepEqual(parseChumpEvent("assistant_text", { content: "legacy" }), {
    type: "assistant_text",
    data: { schema_version: 1, content: "legacy" },
  });
  assert.equal(
    parseChumpEvent("assistant_text", { schema_version: 2, content: "future" }),
    null,
  );
  assert.equal(parseChumpEvent("turn_status", { running: "yes" }), null);
});
