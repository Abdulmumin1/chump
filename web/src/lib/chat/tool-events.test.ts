import { describe, expect, it } from "vitest";

import type { StoredMessage } from "$lib/chump/types";
import {
    applyLiveEventToMessages,
    removeSteeredQueueItem,
} from "$lib/chat/events";
import { buildTranscript } from "$lib/chat/transcript";

function apply(
    messages: StoredMessage[],
    type: string,
    data: Record<string, unknown>,
): StoredMessage[] {
    return applyLiveEventToMessages(messages, type, data);
}

describe("live tool lifecycle events", () => {
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
