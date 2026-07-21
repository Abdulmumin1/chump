import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
    CHUMP_EVENT_TYPES,
    parseChumpEvent,
} from "$lib/chump/events";

type Fixture = {
    schema_version: number;
    events: Array<{ type: string; data: unknown }>;
};

describe("Chump collaboration event contract", () => {
    it("accepts every shared v1 fixture", async () => {
        const fixtureUrl = new URL(
            "../../../../protocol/fixtures/chump-events-v1.json",
            import.meta.url,
        );
        const fixture = JSON.parse(
            await readFile(fixtureUrl, "utf8"),
        ) as Fixture;

        expect(fixture.schema_version).toBe(1);
        expect(new Set(fixture.events.map((event) => event.type))).toEqual(
            new Set(CHUMP_EVENT_TYPES),
        );
        for (const event of fixture.events) {
            expect(parseChumpEvent(event.type, event.data)).toEqual(event);
        }
    });

    it("upgrades legacy payloads and rejects future or malformed events", () => {
        expect(parseChumpEvent("assistant_text", { content: "legacy" })).toEqual({
            type: "assistant_text",
            data: { schema_version: 1, content: "legacy" },
        });
        expect(
            parseChumpEvent("assistant_text", {
                schema_version: 2,
                content: "future",
            }),
        ).toBeNull();
        expect(parseChumpEvent("turn_status", { running: "yes" })).toBeNull();
    });
});
