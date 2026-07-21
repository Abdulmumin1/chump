import { describe, expect, it } from "vitest";

import type { ModelChoice } from "$lib/models";
import { buildComposerSuggestions } from "./commands";

const models: ModelChoice[] = [
    {
        provider: "openai",
        model: "gpt-5.6",
        label: "openai/gpt-5.6",
        description: "reasoning · 1.1M ctx",
    },
    {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        label: "anthropic/claude-sonnet-4-20250514",
        description: "reasoning",
    },
];

describe("buildComposerSuggestions", () => {
    it("shows models from every available provider for /model", () => {
        expect(buildComposerSuggestions("/model ", models)).toEqual([
            expect.objectContaining({ label: "openai/gpt-5.6" }),
            expect.objectContaining({
                label: "anthropic/claude-sonnet-4-20250514",
            }),
        ]);
    });

    it("filters the full model catalog by provider or model text", () => {
        expect(buildComposerSuggestions("/model anthropic", models)).toEqual([
            expect.objectContaining({
                label: "anthropic/claude-sonnet-4-20250514",
            }),
        ]);
        expect(buildComposerSuggestions("/model gpt-5.6", models)).toEqual([
            expect.objectContaining({ label: "openai/gpt-5.6" }),
        ]);
    });

    it("lists and filters discovered skills as Pi-style commands", () => {
        const skills = [
            { name: "release", description: "Publish the project." },
            { name: "review", description: "Review the changes." },
            { name: "animate-text", description: "Animate interface text." },
        ];

        expect(buildComposerSuggestions("/", models, skills)).toContainEqual(
            expect.objectContaining({ command: "/skill:release" }),
        );
        expect(
            buildComposerSuggestions("/skill:rel", models, skills),
        ).toEqual([
            expect.objectContaining({
                command: "/skill:release",
                kind: "skill",
            }),
        ]);
        expect(
            buildComposerSuggestions("/animate text", models, skills),
        ).toEqual([
            expect.objectContaining({
                command: "/skill:animate-text",
                kind: "skill",
            }),
        ]);
    });
});
