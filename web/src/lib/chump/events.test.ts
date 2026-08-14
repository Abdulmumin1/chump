import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
    CHUMP_EVENT_TYPES,
    parseDelegatedSessionProgress,
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

    it("parses transient delegated-session progress envelopes", () => {
        expect(
            parseDelegatedSessionProgress({
                call_id: "start-1",
                step: 2,
                index: 0,
                data: {
                    kind: "delegated_session",
                    session_id: "child-1",
                    event: {
                        type: "tool_call",
                        name: "read_file",
                        call_id: "child-call-1",
                        args: { path: "README.md" },
                    },
                },
            }),
        ).toEqual({
            parentCallId: "start-1",
            parentStep: 2,
            parentIndex: 0,
            sessionId: "child-1",
            event: {
                type: "tool_call",
                name: "read_file",
                callId: "child-call-1",
                args: { path: "README.md" },
            },
        });
        expect(
            parseDelegatedSessionProgress({
                call_id: "start-1",
                step: 2,
                index: 0,
                data: {
                    kind: "delegated_session",
                    session_id: "child-1",
                    event: { type: "unknown" },
                },
            }),
        ).toBeNull();
    });
});
