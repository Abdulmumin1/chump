import { describe, expect, it } from "vitest";

import type { StoredMessage } from "$lib/chump/types";
import {
    summarizeTerminalActivity,
    toolPresentation,
} from "$lib/chat/activity-summary";
import {
    applyActivityTimingsFromEventLog,
    applyLiveEventToMessages,
    removeSteeredQueueItem,
} from "$lib/chat/events";
import {
    buildTranscript,
    isTerminalActivityBlock,
    mergeReasoningText,
    reasoningSummary,
} from "$lib/chat/transcript";

function apply(
    messages: StoredMessage[],
    type: string,
    data: Record<string, unknown>,
): StoredMessage[] {
    return applyLiveEventToMessages(messages, type, data);
}

describe("live tool lifecycle events", () => {
    it("adds the rounded duration of each reasoning block", () => {
        expect(reasoningSummary("First thought.", "Second thought.")).toBe(
            "Thought for 2 seconds",
        );
    });

    it("delays tools and holds long-running completions before collapsing", () => {
        const running = {
            kind: "tool-call" as const,
            text: "",
            originalToolName: "bash",
            status: "running" as const,
            startedAt: 1_000,
        };
        expect(toolPresentation(running, 1_999)).toBe("hidden");
        expect(toolPresentation(running, 2_000)).toBe("visible");

        expect(
            toolPresentation(
                {
                    ...running,
                    status: "completed",
                    completedAt: 1_800,
                },
                1_800,
            ),
        ).toBe("collapsible");

        const slowCompletion = {
            ...running,
            status: "completed" as const,
            completedAt: 2_500,
        };
        expect(toolPresentation(slowCompletion, 4_499)).toBe("visible");
        expect(toolPresentation(slowCompletion, 4_500)).toBe("collapsible");
    });

    it("summarizes small activity groups without command or file previews", () => {
        const summary = summarizeTerminalActivity(
            [
                {
                    kind: "tool-call",
                    text: "",
                    originalToolName: "bash",
                    toolName: "$ git log -n 30 --oneline",
                },
                {
                    kind: "tool-call",
                    text: "",
                    originalToolName: "read_file",
                    toolName: "reasoning.ts",
                },
            ],
            reasoningSummary,
        );

        expect(summary).toEqual({
            text: "Ran 1 command, Read 1 file",
            parts: ["Ran 1 command", "Read 1 file"],
            condensed: false,
        });
    });

    it("summarizes varied activity into detailed tool counts", () => {
        const summary = summarizeTerminalActivity(
            [
                {
                    kind: "tool-call",
                    text: "",
                    originalToolName: "bash",
                    duration: 0.25,
                    startedAt: 1_000,
                    completedAt: 1_250,
                },
                {
                    kind: "tool-call",
                    text: "",
                    originalToolName: "read_file",
                    duration: 0.3,
                },
                {
                    kind: "tool-call",
                    text: "",
                    originalToolName: "search",
                    duration: 1.8,
                },
                {
                    kind: "tool-call",
                    text: "",
                    originalToolName: "apply_patch",
                    duration: 0.2,
                    startedAt: 60_000,
                    completedAt: 62_000,
                },
            ],
            reasoningSummary,
        );

        expect(summary).toEqual({
            text: "Ran 1 command, Read 1 file, Searched 1 time",
            parts: ["Ran 1 command", "Read 1 file", "Searched 1 time"],
            condensed: true,
        });
    });

    it("restores actual tool timing from the durable event log", () => {
        const messages: StoredMessage[] = [
            {
                role: "assistant",
                content: [
                    {
                        type: "tool_call",
                        tool_call: {
                            id: "call-1",
                            name: "bash",
                            arguments: { command: "pwd" },
                        },
                    },
                ],
            },
        ];

        const timed = applyActivityTimingsFromEventLog(messages, [
            {
                id: 1,
                type: "tool_call.started",
                data: { call_id: "call-1", created_at: 10 },
            },
            {
                id: 2,
                type: "tool_execution.finished",
                data: { call_id: "call-1", created_at: 14.5 },
            },
        ]);

        expect(timed[0]?.content[0]).toMatchObject({
            tool_call: {
                presentation_started_at: 10_000,
                presentation_completed_at: 14_500,
            },
        });
    });

    it("keeps adjacent reasoning summaries separated by newlines", () => {
        let text = mergeReasoningText("", "**Investigating createToolCallPromise concurrency**");
        text = mergeReasoningText(text, "**Reviewing createToolCallPromise function**");
        text = mergeReasoningText(text, "**Inspecting initial test cases**");

        expect(text).toBe(
            "**Investigating createToolCallPromise concurrency**\n\n**Reviewing createToolCallPromise function**\n\n**Inspecting initial test cases**",
        );
    });

    it("separates adjacent summary headings received in a single chunk", () => {
        const text = mergeReasoningText(
            "",
            "**Planning nested tool rendering****Designing session tool status rendering**",
        );
        expect(text).toBe(
            "**Planning nested tool rendering**\n\n**Designing session tool status rendering**",
        );
    });

    it("preserves streamed reasoning headings across live events", () => {
        let messages: StoredMessage[] = [];
        messages = apply(messages, "reasoning", { text: "**Investigating createToolCallPromise concurrency**" });
        messages = apply(messages, "reasoning", { text: "**Reviewing createToolCallPromise function**" });
        const transcript = buildTranscript(messages);
        expect(transcript[0]?.blocks[0]?.text).toBe(
            "**Investigating createToolCallPromise concurrency**\n\n**Reviewing createToolCallPromise function**",
        );
    });

    it("keeps running tools expanded until a terminal result exists", () => {
        for (const status of ["streaming", "ready", "running"] as const) {
            expect(
                isTerminalActivityBlock({
                    kind: "tool-call",
                    text: "",
                    originalToolName: "apply_patch",
                    status,
                }),
            ).toBe(false);
        }

        expect(
            isTerminalActivityBlock({
                kind: "tool-call",
                text: "",
                originalToolName: "apply_patch",
                status: "completed",
                hasResult: true,
            }),
        ).toBe(true);
    });

    it("renders partial bash and write arguments before their JSON is complete", () => {
        let messages: StoredMessage[] = [];
        messages = apply(messages, "tool_call.started", {
            call_id: "call_bash",
            name: "bash",
            step: 1,
            index: 0,
        });
        messages = apply(messages, "tool_call.delta", {
            call_id: "call_bash",
            step: 1,
            index: 0,
            arguments_delta: '{"command":"printf hel',
        });

        expect(buildTranscript(messages)[0]?.blocks[0]).toMatchObject({
            args: { command: "printf hel" },
            toolName: "$ printf hel",
            status: "streaming",
        });

        messages = apply(messages, "tool_call.delta", {
            call_id: "call_bash",
            step: 1,
            index: 0,
            arguments_delta: 'lo"}',
        });
        expect(buildTranscript(messages)[0]?.blocks[0]).toMatchObject({
            args: { command: "printf hello" },
            toolName: "$ printf hello",
        });

        messages = apply(messages, "tool_call.started", {
            call_id: "call_write",
            name: "write_file",
            step: 1,
            index: 1,
        });
        messages = apply(messages, "tool_call.delta", {
            call_id: "call_write",
            step: 1,
            index: 1,
            arguments_delta:
                '{"path":"demo.ts","content":"export const live = tr',
        });

        const writeBlock = buildTranscript(messages)[0]?.blocks[1];
        expect(writeBlock).toMatchObject({
            args: {
                path: "demo.ts",
                content: "export const live = tr",
            },
            toolName: "demo.ts",
            isDiff: true,
            status: "streaming",
        });
        expect(writeBlock?.diffContent).toContain("+export const live = tr");
    });

    it("adopts provider output indexes into the normalized ready call", () => {
        let messages: StoredMessage[] = [];
        messages = apply(messages, "tool_call.started", {
            call_id: "call_codex",
            name: "bash",
            step: 1,
            index: 2,
        });
        messages = apply(messages, "tool_call.delta", {
            call_id: "call_codex",
            step: 1,
            index: 2,
            arguments_delta: '{"command":"printf live"}',
        });
        messages = apply(messages, "tool_call", {
            call_id: "call_codex",
            name: "bash",
            step: 1,
            index: 0,
            args: { command: "printf live" },
        });

        const blocks = buildTranscript(messages).flatMap((item) => item.blocks);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({
            toolCallId: "call_codex",
            args: { command: "printf live" },
            status: "ready",
        });
    });

    it("updates one write tool block from streaming arguments through its diff result", () => {
        let messages: StoredMessage[] = [];
        messages = apply(messages, "tool_call.started", {
            call_id: "call_write",
            name: "write_file",
            step: 1,
            index: 0,
        });
        messages = apply(messages, "tool_call.delta", {
            call_id: "call_write",
            step: 1,
            index: 0,
            arguments_delta: '{"path":"demo.ts","content":"old"}',
        });
        messages = apply(messages, "tool_call", {
            call_id: "call_write",
            tool_call_id: "call_write",
            name: "write_file",
            step: 1,
            index: 0,
            args: { path: "demo.ts", content: "old" },
        });
        messages = apply(messages, "tool_execution.started", {
            call_id: "call_write",
            name: "write_file",
            step: 1,
            index: 0,
        });

        expect(buildTranscript(messages)[0]?.blocks[0]).toMatchObject({
            kind: "tool-call",
            toolCallId: "call_write",
            status: "running",
            isDiff: true,
        });

        messages = apply(messages, "tool_execution.finished", {
            call_id: "call_write",
            name: "write_file",
            step: 1,
            index: 0,
            status: "ok",
            duration: 0.25,
            preview: "Wrote demo.ts",
            metadata: {
                diff: {
                    path: "demo.ts",
                    kind: "update",
                    added: 1,
                    removed: 1,
                    changes: [],
                    lines: ["@@ -1 +1 @@", "-old", "+new"],
                },
            },
        });

        let transcript = buildTranscript(messages);
        expect(transcript).toHaveLength(1);
        expect(transcript[0]?.blocks).toHaveLength(1);
        expect(transcript[0]?.blocks[0]).toMatchObject({
            toolCallId: "call_write",
            status: "completed",
            duration: 0.25,
            hasResult: true,
            isDiff: true,
            result: "Wrote demo.ts",
        });

        messages = apply(messages, "tool_result", {
            call_id: "call_write",
            tool_call_id: "call_write",
            name: "write_file",
            step: 1,
            index: 0,
            status: "ok",
            preview: "Wrote demo.ts",
            metadata: {
                diff: {
                    path: "demo.ts",
                    kind: "update",
                    added: 1,
                    removed: 1,
                    changes: [],
                    lines: ["@@ -1 +1 @@", "-old", "+new"],
                },
            },
        });

        transcript = buildTranscript(messages);
        expect(transcript).toHaveLength(1);
        expect(transcript[0]?.blocks).toHaveLength(1);
        expect(transcript[0]?.blocks[0]?.toolCallId).toBe("call_write");
    });

    it("keeps reverse-completing same-name bash results attached to their call ids", () => {
        let messages: StoredMessage[] = [];
        for (const [index, callId, command] of [
            [0, "call_first", "printf first"],
            [1, "call_second", "printf second"],
        ] as const) {
            messages = apply(messages, "tool_call", {
                call_id: callId,
                tool_call_id: callId,
                name: "bash",
                step: 3,
                index,
                args: { command },
            });
            messages = apply(messages, "tool_execution.started", {
                call_id: callId,
                name: "bash",
                step: 3,
                index,
            });
        }

        messages = apply(messages, "tool_execution.finished", {
            call_id: "call_second",
            name: "bash",
            step: 3,
            index: 1,
            status: "ok",
            preview: "second output",
        });
        messages = apply(messages, "tool_execution.finished", {
            call_id: "call_first",
            name: "bash",
            step: 3,
            index: 0,
            status: "ok",
            preview: "first output",
        });

        const blocks = buildTranscript(messages).flatMap((item) => item.blocks);
        const first = blocks.find((block) => block.toolCallId === "call_first");
        const second = blocks.find((block) => block.toolCallId === "call_second");
        expect(first).toMatchObject({
            args: { command: "printf first" },
            result: "first output",
            status: "completed",
        });
        expect(second).toMatchObject({
            args: { command: "printf second" },
            result: "second output",
            status: "completed",
        });
    });

    it("matches reused provider call ids to the nearest unmatched tool call", () => {
        const messages: StoredMessage[] = [
            {
                role: "assistant",
                content: [
                    {
                        type: "tool_call",
                        tool_call: {
                            id: "call_0",
                            name: "bash",
                            arguments: { command: "printf first" },
                        },
                    },
                ],
            },
            {
                role: "tool",
                content: [
                    {
                        type: "tool_result",
                        tool_result: {
                            tool_call_id: "call_0",
                            tool_name: "bash",
                            result: "first output",
                            is_error: false,
                        },
                    },
                ],
            },
            {
                role: "assistant",
                content: [
                    {
                        type: "tool_call",
                        tool_call: {
                            id: "call_0",
                            name: "bash",
                            arguments: { command: "printf second" },
                        },
                    },
                ],
            },
            {
                role: "tool",
                content: [
                    {
                        type: "tool_result",
                        tool_result: {
                            tool_call_id: "call_0",
                            tool_name: "bash",
                            result: "second output",
                            is_error: false,
                        },
                    },
                ],
            },
        ];

        const transcript = buildTranscript(messages);
        const blocks = transcript.flatMap((item) => item.blocks);
        expect(transcript).toHaveLength(1);
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({
            args: { command: "printf first" },
            result: "first output",
            hasResult: true,
        });
        expect(blocks[1]).toMatchObject({
            args: { command: "printf second" },
            result: "second output",
            hasResult: true,
        });
    });

    it("keeps completed reasoning and tools in one collapsible activity sequence", () => {
        const messages: StoredMessage[] = [
            {
                role: "assistant",
                content: [
                    { type: "reasoning", text: "I should inspect the file." },
                    {
                        type: "tool_call",
                        tool_call: {
                            id: "call_read",
                            name: "read_file",
                            arguments: { path: "demo.ts" },
                            status: "completed",
                        },
                    },
                ],
            },
            {
                role: "tool",
                content: [
                    {
                        type: "tool_result",
                        tool_result: {
                            tool_call_id: "call_read",
                            tool_name: "read_file",
                            result: "export const demo = true;",
                            is_error: false,
                            status: "completed",
                        },
                    },
                ],
            },
            {
                role: "assistant",
                content: [
                    { type: "reasoning", text: "Now I can make the change." },
                    {
                        type: "tool_call",
                        tool_call: {
                            id: "call_patch",
                            name: "apply_patch",
                            arguments: { patch: "*** Begin Patch" },
                            status: "completed",
                        },
                    },
                ],
            },
        ];

        const transcript = buildTranscript(messages);

        expect(transcript).toHaveLength(1);
        expect(transcript[0]).toMatchObject({
            role: "assistant",
            blocks: [
                { kind: "reasoning", text: "I should inspect the file." },
                { kind: "tool-call", toolCallId: "call_read", hasResult: true },
                { kind: "reasoning", text: "Now I can make the change." },
                { kind: "tool-call", toolCallId: "call_patch" },
            ],
        });
    });

    it("keeps reused call ids separate across live lifecycle steps", () => {
        let messages: StoredMessage[] = [];
        for (const [step, command, output] of [
            [1, "printf first", "first output"],
            [2, "printf second", "second output"],
        ] as const) {
            messages = apply(messages, "tool_call.started", {
                call_id: "call_0",
                name: "bash",
                step,
                index: 0,
            });
            messages = apply(messages, "tool_call", {
                call_id: "call_0",
                tool_call_id: "call_0",
                name: "bash",
                args: { command },
                step,
                index: 0,
            });
            messages = apply(messages, "tool_execution.finished", {
                call_id: "call_0",
                name: "bash",
                preview: output,
                status: "ok",
                step,
                index: 0,
            });
        }

        const blocks = buildTranscript(messages).flatMap((item) => item.blocks);
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({
            args: { command: "printf first" },
            result: "first output",
            hasResult: true,
        });
        expect(blocks[1]).toMatchObject({
            args: { command: "printf second" },
            result: "second output",
            hasResult: true,
        });
    });

    it("replays loaded skills without exposing skill content", () => {
        const skillContent =
            '<skill_content name="svelte-code-writer">\\n# Svelte 5\\n</skill_content>';
        const messages: StoredMessage[] = [
            {
                role: "assistant",
                content: [
                    {
                        type: "tool_call",
                        tool_call: {
                            id: "call_skill",
                            name: "skill",
                            arguments: { name: skillContent },
                        },
                    },
                ],
            },
            {
                role: "tool",
                content: [
                    {
                        type: "tool_result",
                        tool_result: {
                            tool_call_id: "call_skill",
                            tool_name: "skill",
                            result: skillContent,
                            is_error: false,
                        },
                    },
                ],
            },
        ];

        const block = buildTranscript(messages)[0]?.blocks[0];

        expect(block).toMatchObject({
            toolName: "Skill svelte-code-writer",
            result: "Loaded skill: svelte-code-writer",
            hasResult: true,
        });
        expect(JSON.stringify(block)).not.toContain("<skill_content");
    });

    it("replays manual skill prompts as compact slash commands", () => {
        const transcript = buildTranscript([
            {
                role: "user",
                content:
                    '<skill_content name="release">\n# Release\n</skill_content>' +
                    "\n\nUser: publish patch",
            },
        ]);

        expect(transcript[0]?.blocks[0]).toEqual({
            kind: "text",
            text: "/skill:release publish patch",
        });
    });

    it("removes a queued steering item when its user message is accepted", () => {
        const queue = [
            { content: "first", display_content: "first" },
            { content: "second", display_content: "second" },
        ];

        expect(
            removeSteeredQueueItem(queue, {
                content: "second",
                display_content: "second",
                steered: true,
            }),
        ).toEqual([{ content: "first", display_content: "first" }]);
    });
});
