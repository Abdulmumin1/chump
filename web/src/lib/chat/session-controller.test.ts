import { afterEach, describe, expect, it } from "vitest";

import { createSessionController, type SessionControllerState } from "$lib/chat/session-controller";
import type { ChumpState, ChumpStatus } from "$lib/chump/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("session hydration", () => {
    it("opens the daemon event stream after the atomic snapshot cursor", async () => {
        const requestUrls: string[] = [];
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            requestUrls.push(url);
            if (url.endsWith("/session-snapshot")) {
                return Response.json({
                    status: status({ turn_running: true }),
                    messages: [],
                    events: [
                        {
                            id: 7,
                            type: "turn_status",
                            data: {
                                running: true,
                                steering_queue: [],
                                schema_version: 1,
                            },
                        },
                    ],
                });
            }
            if (url.endsWith("/state")) {
                return Response.json(sessionState());
            }
            if (url.includes("/events?")) {
                return new Response(": connected\n\n", {
                    headers: { "content-type": "text/event-stream" },
                });
            }
            throw new Error(`unexpected request: ${url}`);
        }) as typeof fetch;

        const state = controllerState();
        const controller = createSessionController(state, {
            closeConnectModal: () => {},
            scrollTranscriptToEnd: async () => {},
        });

        try {
            await controller.selectSession("session-one");

            const eventsRequest = requestUrls.find((url) => url.includes("/events?"));
            expect(eventsRequest).toBeDefined();
            expect(new URL(eventsRequest!).searchParams.get("last_event_id")).toBe("7");
            expect(requestUrls.some((url) => url.endsWith("/action/status"))).toBe(false);
            expect(requestUrls.some((url) => url.endsWith("/action/event_log"))).toBe(false);
            expect(state.lastEventId).toBe(7);
            expect(state.isSending).toBe(true);
            expect(state.workingSessionIds).toEqual(["session-one"]);
        } finally {
            controller.destroy();
        }
    });

    it("replays an unfinished durable tail after the server restarted idle", async () => {
        const requestUrls: string[] = [];
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            requestUrls.push(url);
            if (url.endsWith("/session-snapshot")) {
                return Response.json({
                    status: status({ turn_running: false }),
                    messages: [
                        { role: "user", content: "delegate four issues" },
                    ],
                    events: [
                        {
                            id: 1,
                            type: "user_message",
                            data: { content: "delegate four issues" },
                        },
                        {
                            id: 2,
                            type: "turn_status",
                            data: { running: true, steering_queue: [] },
                        },
                        {
                            id: 606,
                            type: "tool_call",
                            data: {
                                name: "start_session",
                                call_id: "start-227",
                                args: { session_id: "issue-227" },
                                step: 5,
                                index: 0,
                            },
                        },
                        {
                            id: 606,
                            type: "tool_call",
                            data: {
                                name: "start_session",
                                call_id: "start-228",
                                args: { session_id: "issue-228" },
                                step: 5,
                                index: 1,
                            },
                        },
                        {
                            id: 608,
                            type: "tool_call",
                            data: {
                                name: "start_session",
                                call_id: "start-229",
                                args: { session_id: "issue-229" },
                                step: 5,
                                index: 2,
                            },
                        },
                        {
                            id: 609,
                            type: "tool_call",
                            data: {
                                name: "start_session",
                                call_id: "start-230",
                                args: { session_id: "issue-230" },
                                step: 5,
                                index: 3,
                            },
                        },
                    ],
                });
            }
            if (url.endsWith("/state")) {
                return Response.json(sessionState());
            }
            if (url.includes("/events?")) {
                return new Response(": connected\n\n", {
                    headers: { "content-type": "text/event-stream" },
                });
            }
            throw new Error(`unexpected request: ${url}`);
        }) as typeof fetch;

        const state = controllerState();
        const controller = createSessionController(state, {
            closeConnectModal: () => {},
            scrollTranscriptToEnd: async () => {},
        });

        try {
            await controller.selectSession("session-one");

            expect(JSON.stringify(state.messages)).toContain("start_session");
            for (const issue of ["issue-227", "issue-228", "issue-229", "issue-230"]) {
                expect(JSON.stringify(state.messages)).toContain(issue);
            }
            expect(state.lastEventId).toBe(609);
            expect(state.isSending).toBe(false);
            expect(requestUrls.some((url) => url.includes("/events?"))).toBe(true);
        } finally {
            controller.destroy();
        }
    });

    it("settles orphaned delegated calls from the shared snapshot", async () => {
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/session-snapshot")) {
                return Response.json({
                    status: status({ turn_running: false }),
                    messages: [],
                    events: [
                        {
                            id: 1,
                            type: "turn_status",
                            data: { running: true, steering_queue: [] },
                        },
                        {
                            id: 606,
                            type: "tool_call",
                            data: {
                                name: "start_session",
                                call_id: "start-227",
                                args: { session_id: "issue-227" },
                                step: 5,
                                index: 0,
                            },
                        },
                        {
                            id: 606,
                            type: "tool_result",
                            data: {
                                name: "start_session",
                                tool_name: "start_session",
                                call_id: "start-227",
                                tool_call_id: "start-227",
                                step: 5,
                                index: 0,
                                status: "ok",
                                ok: true,
                                preview: JSON.stringify({
                                    session_id: "issue-227",
                                    delegated_task_status: "completed",
                                }),
                                schema_version: 1,
                            },
                        },
                    ],
                });
            }
            if (url.endsWith("/state")) {
                return Response.json(sessionState());
            }
            if (url.includes("/events?")) {
                return new Response(": connected\n\n", {
                    headers: { "content-type": "text/event-stream" },
                });
            }
            throw new Error(`unexpected request: ${url}`);
        }) as typeof fetch;

        const state = controllerState();
        const controller = createSessionController(state, {
            closeConnectModal: () => {},
            scrollTranscriptToEnd: async () => {},
        });

        try {
            await controller.selectSession("session-one");

            expect(JSON.stringify(state.messages)).toContain("issue-227");
            expect(JSON.stringify(state.messages)).toContain('"status":"completed"');
            expect(state.lastEventId).toBe(606);
            expect(state.isSending).toBe(false);
        } finally {
            controller.destroy();
        }
    });

    it("uses reconciled stored messages after the durable tail is closed", async () => {
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/session-snapshot")) {
                return Response.json({
                    status: status({ turn_running: false }),
                    messages: [
                        { role: "user", content: "delegate work" },
                        {
                            role: "assistant",
                            content: [
                                {
                                    type: "tool_call",
                                    tool_call: {
                                        id: "start-227",
                                        name: "start_session",
                                        arguments: { session_id: "issue-227" },
                                        step: 5,
                                        index: 0,
                                        status: "ready",
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
                                        tool_call_id: "start-227",
                                        tool_name: "start_session",
                                        result: JSON.stringify({
                                            session_id: "issue-227",
                                            delegated_task_status: "completed",
                                        }),
                                        is_error: false,
                                        step: 5,
                                        index: 0,
                                        status: "completed",
                                    },
                                },
                            ],
                        },
                    ],
                    events: [
                        {
                            id: 1,
                            type: "turn_status",
                            data: { running: true, steering_queue: [] },
                        },
                        {
                            id: 606,
                            type: "tool_call",
                            data: {
                                name: "start_session",
                                call_id: "start-227",
                                args: { session_id: "issue-227" },
                                step: 5,
                                index: 0,
                            },
                        },
                        {
                            id: 606,
                            type: "tool_result",
                            data: {
                                name: "start_session",
                                call_id: "start-227",
                                ok: true,
                                status: "ok",
                                preview: "completed",
                                step: 5,
                                index: 0,
                            },
                        },
                        {
                            id: 606,
                            type: "turn_status",
                            data: { running: false, steering_queue: [] },
                        },
                    ],
                });
            }
            if (url.endsWith("/state")) return Response.json(sessionState());
            if (url.includes("/events?")) {
                return new Response(": connected\n\n", {
                    headers: { "content-type": "text/event-stream" },
                });
            }
            throw new Error(`unexpected request: ${url}`);
        }) as typeof fetch;

        const state = controllerState();
        const controller = createSessionController(state, {
            closeConnectModal: () => {},
            scrollTranscriptToEnd: async () => {},
        });

        try {
            await controller.selectSession("session-one");

            expect(JSON.stringify(state.messages)).toContain('"status":"completed"');
            expect(state.lastEventId).toBe(606);
            expect(state.isSending).toBe(false);
        } finally {
            controller.destroy();
        }
    });

});

function controllerState(): SessionControllerState & {
    workingSessionIds: string[];
} {
    const state: SessionControllerState & { workingSessionIds: string[] } = {
        workingSessionIds: [] as string[],
        serverUrl: "http://127.0.0.1:38136",
        apiTarget: {
            kind: "daemon",
            daemonUrl: "http://127.0.0.1:38136",
            token: "daemon-token",
            projectId: "project-one",
        },
        sessionInput: "",
        activeSessionId: "",
        health: null,
        status: null,
        sessionState: null,
        sessions: [],
        sessionPage: 1,
        sessionTotalPages: 1,
        sessionTotal: 0,
        messages: [],
        steeringQueue: [],
        isConnecting: false,
        get isSending() {
            return this.workingSessionIds.includes(this.activeSessionId);
        },
        set isSending(value: boolean) {
            const sessionId = this.activeSessionId;
            if (!sessionId) return;
            this.workingSessionIds = value
                ? Array.from(new Set([...this.workingSessionIds, sessionId]))
                : this.workingSessionIds.filter((item) => item !== sessionId);
        },
        isCompacting: false,
        isLoadingSession: false,
        connectionError: "",
        lastEventId: 0,
        loadToken: 0,
        streamToken: 0,
        stopEvents: null,
        availableModels: [],
    };
    return state;
}

function status(overrides: Partial<ChumpStatus> = {}): ChumpStatus {
    return {
        agent_id: "session-one",
        workspace_root: "/workspace",
        provider: "openai",
        model: "gpt-5",
        max_steps: 100,
        command_timeout: 120,
        managed_idle_timeout: null,
        reasoning: null,
        verbose: false,
        message_count: 1,
        title: null,
        created_at: 1,
        updated_at: 2,
        last_user_goal: "test live hydration",
        steering_queue: [],
        instruction_files: [],
        skills: [],
        ...overrides,
    };
}

function sessionState(): ChumpState {
    return {
        workspace_root: "/workspace",
        title: null,
        created_at: 1,
        updated_at: 2,
        last_user_goal: "test live hydration",
        files_touched: [],
        commands_run: [],
        notes: [],
    };
}
