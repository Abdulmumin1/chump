import { describe, expect, it } from "vitest";
import {
    advanceBySegments,
    countSegments,
    StreamSmoother,
} from "$lib/chat/StreamSmoother";

describe("StreamSmoother", () => {
    it("uses words as presentation segments, not provider chunks", () => {
        expect(countSegments("one  two\nthree")).toBe(3);
        expect(advanceBySegments("one two three", 0, 2)).toBe(8);
    });

    it("reveals the first segment immediately", () => {
        const visible: string[] = [];
        const smoother = new StreamSmoother({ onReveal: (text) => visible.push(text) });

        smoother.push("The first burst contains several words.");

        expect(visible[0]).toBe("The ");
        smoother.reset();
    });

    it("can flush all received content without waiting for the drain loop", () => {
        let visible = "";
        const smoother = new StreamSmoother({ onReveal: (text) => (visible = text) });

        smoother.push("one two three");
        smoother.flush();

        expect(visible).toBe("one two three");
    });
});
