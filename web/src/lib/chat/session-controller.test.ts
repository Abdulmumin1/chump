import { afterEach, describe, expect, it } from "vitest";

import { createSessionController, type SessionControllerState } from "$lib/chat/session-controller";
import type { ChumpApiTarget } from "$lib/chump/api";
import type { ChumpState, ChumpStatus } from "$lib/chump/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("session loading", () => {
    it("loads stored messages, status, and the event cursor before opening live events", async () => {
        const requestUrls: string[] = [];
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            requestUrls.push(url);
            if (url.endsWith("/action/status")) {
                return Response.json({
                    result: status({
                        turn_running: true,
                        steering_queue: [{ content: "follow up" }],
                    }),
                });
            }
            if (url.endsWith("/state")) {
                return Response.json(sessionState());
            }
            if (url.endsWith("/messages")) {
                return Response.json({
                    messages: [
                        {
                            role: "assistant",
                            content: "stored transcript",
                        },
                    ],
                });
            }
            if (url.endsWith("/action/event_log")) {
                return Response.json({
                    result: {
                        events: [
                            {
                                id: 7,
                                type: "assistant_text",
                                data: {
                                    content: "event log text should stay hidden",
                                },
                            },
                        ],
                    },
                });
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
            expect(requestUrls.some((url) => url.endsWith("/session-snapshot"))).toBe(
                false,
            );
            expect(requestUrls.some((url) => url.endsWith("/action/status"))).toBe(
                true,
            );
            expect(requestUrls.some((url) => url.endsWith("/messages"))).toBe(true);
            expect(requestUrls.some((url) => url.endsWith("/action/event_log"))).toBe(
                true,
            );
            expect(state.messages).toEqual([
                {
                    role: "assistant",
                    content: "stored transcript",
                },
            ]);
            expect(JSON.stringify(state.messages)).not.toContain(
                "event log text should stay hidden",
            );
            expect(state.steeringQueue).toEqual([
                {
                    content: "follow up",
                    display_content: undefined,
                    attachments: [],
                },
            ]);
            expect(state.lastEventId).toBe(7);
            expect(state.isSending).toBe(true);
            expect(state.workingSessionIds).toEqual(["session-one"]);
        } finally {
            controller.destroy();
        }
    });

    it("keeps the live transcript when a turn finishes without reloading stored messages", async () => {
        let messagesRequestCount = 0;
        const eventStream = controllableEventStream();
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/action/status")) {
                return Response.json({
                    result: status({ turn_running: true }),
                });
            }
            if (url.endsWith("/state")) return Response.json(sessionState());
            if (url.endsWith("/messages")) {
                messagesRequestCount += 1;
                return Response.json({
                    messages: [{ role: "user", content: "delegate work" }],
                });
            }
            if (url.endsWith("/action/event_log")) {
                return Response.json({
                    result: {
                        events: [
                            {
                                id: 1,
                                type: "turn_status",
                                data: { running: true, steering_queue: [] },
                            },
                        ],
                    },
                });
            }
            if (url.includes("/sessions?")) {
                return Response.json({
                    sessions: [],
                    page: 1,
                    page_size: 6,
                    total: 0,
                    total_pages: 1,
                });
            }
            if (url.includes("/events?")) {
                return new Response(eventStream.stream, {
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
            state.delegatedActivities = [
                {
                    parentCallId: "start-227",
                    parentStep: 5,
                    parentIndex: 0,
                    sessionId: "issue-227",
                    model: null,
                    phase: "Writing response",
                    activeTool: null,
                    latestDetail: null,
                    updatedAt: 1,
                },
            ];

            eventStream.enqueue(
                'id: 2\nevent: tool_call\ndata: {"name":"start_session","call_id":"start-227","args":{"session_id":"issue-227"},"step":5,"index":0,"schema_version":1}\n\n',
            );
            eventStream.enqueue(
                'id: 3\nevent: tool_result\ndata: {"name":"start_session","call_id":"start-227","ok":true,"status":"ok","preview":"completed","step":5,"index":0,"schema_version":1}\n\n',
            );
            eventStream.enqueue(
                'id: 4\nevent: assistant_text\ndata: {"content":"Done.","schema_version":1}\n\n',
            );
            eventStream.enqueue(
                'id: 5\nevent: turn_status\ndata: {"running":false,"steering_queue":[],"schema_version":1}\n\n',
            );
            await waitFor(
                () =>
                    messagesRequestCount === 1 &&
                    JSON.stringify(state.messages).includes("issue-227") &&
                    JSON.stringify(state.messages).includes("Done.") &&
                    state.delegatedActivities.length === 0 &&
                    state.isSending === false,
            );

            expect(messagesRequestCount).toBe(1);
            expect(JSON.stringify(state.messages)).toContain('"status":"completed"');
            expect(JSON.stringify(state.messages)).toContain("Done.");
            expect(state.delegatedActivities).toEqual([]);
            expect(state.isSending).toBe(false);
        } finally {
            controller.destroy();
        }
    });

    it("keeps the latest useful delegated reasoning and tool detail", async () => {
        const eventStream = controllableEventStream();
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/action/status")) {
                return Response.json({
                    result: status({ turn_running: true }),
                });
            }
            if (url.endsWith("/state")) return Response.json(sessionState());
            if (url.endsWith("/messages")) {
                return Response.json({ messages: [] });
            }
            if (url.endsWith("/action/event_log")) {
                return Response.json({
                    result: {
                        events: [
                            {
                                id: 1,
                                type: "turn_status",
                                data: { running: true, steering_queue: [] },
                            },
                        ],
                    },
                });
            }
            if (url.includes("/events?")) {
                return new Response(eventStream.stream, {
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
            eventStream.enqueue(
                delegatedProgressEvent(2, {
                    type: "reasoning",
                    text: "**Inspecting the session lifecycle**",
                }),
            );
            eventStream.enqueue(
                delegatedProgressEvent(3, {
                    type: "status",
                    phase: "step_start",
                    step: 2,
                }),
            );

            await waitFor(
                () =>
                    state.delegatedActivities[0]?.latestDetail?.kind ===
                    "reasoning",
            );
            expect(state.delegatedActivities[0]).toMatchObject({
                phase: "Working on step 2",
                latestDetail: {
                    kind: "reasoning",
                    text: "Inspecting the session lifecycle",
                },
            });

            eventStream.enqueue(
                delegatedProgressEvent(4, {
                    type: "reasoning",
                    text: " before reading the composer.",
                }),
            );
            await waitFor(
                () =>
                    state.delegatedActivities[0]?.latestDetail?.kind ===
                        "reasoning" &&
                    state.delegatedActivities[0].latestDetail.text.endsWith(
                        "before reading the composer.",
                    ),
            );
            expect(state.delegatedActivities[0]?.latestDetail).toEqual({
                kind: "reasoning",
                text: "Inspecting the session lifecycle before reading the composer.",
            });

            eventStream.enqueue(
                delegatedProgressEvent(5, {
                    type: "tool_call",
                    name: "read_file",
                    call_id: "child-read-1",
                    args: {
                        path: "web/src/lib/ChatComposer.svelte",
                        offset: 440,
                        limit: 80,
                    },
                }),
            );
            eventStream.enqueue(
                delegatedProgressEvent(6, {
                    type: "tool_result",
                    name: "read_file",
                    call_id: "child-read-1",
                    status: "ok",
                }),
            );

            await waitFor(
                () =>
                    state.delegatedActivities[0]?.latestDetail?.kind === "tool" &&
                    state.delegatedActivities[0].latestDetail.status === "completed",
            );
            expect(state.delegatedActivities[0]?.latestDetail).toEqual({
                kind: "tool",
                name: "read_file",
                callId: "child-read-1",
                detail: "web/src/lib/ChatComposer.svelte · L440 +80",
                status: "completed",
            });
        } finally {
            controller.destroy();
        }
    });

	it("ignores stale project hydration after switching targets with the same session id", async () => {
		const requestUrls: string[] = [];
		const projectAStatus = deferred<Response>();
		const projectAState = deferred<Response>();
		const projectAMessages = deferred<Response>();
		const projectAEventLog = deferred<Response>();

		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			requestUrls.push(url);
			if (url === 'http://127.0.0.1:38136/projects/project-a/health') {
				return Response.json(health('/workspace-a'));
			}
			if (url.startsWith('http://127.0.0.1:38136/projects/project-a/sessions?')) {
				return Response.json(sessionsResponse('shared-session', 'project-a'));
			}
			if (url.endsWith('/projects/project-a/sessions/shared-session/action/status')) {
				return await projectAStatus.promise;
			}
			if (url.endsWith('/projects/project-a/sessions/shared-session/state')) {
				return await projectAState.promise;
			}
			if (url.endsWith('/projects/project-a/sessions/shared-session/messages')) {
				return await projectAMessages.promise;
			}
			if (url.endsWith('/projects/project-a/sessions/shared-session/action/event_log')) {
				return await projectAEventLog.promise;
			}
			if (url === 'http://127.0.0.1:38136/projects/project-b/health') {
				return Response.json(health('/workspace-b'));
			}
			if (url.startsWith('http://127.0.0.1:38136/projects/project-b/sessions?')) {
				return Response.json(sessionsResponse('shared-session', 'project-b'));
			}
			if (url.endsWith('/projects/project-b/sessions/shared-session/action/status')) {
				return Response.json({
					result: status({ workspace_root: '/workspace-b' })
				});
			}
			if (url.endsWith('/projects/project-b/sessions/shared-session/state')) {
				return Response.json({
					...sessionState(),
					workspace_root: '/workspace-b'
				});
			}
			if (url.endsWith('/projects/project-b/sessions/shared-session/messages')) {
				return Response.json({
					messages: [{ role: 'assistant', content: 'project b transcript' }]
				});
			}
			if (url.endsWith('/projects/project-b/sessions/shared-session/action/event_log')) {
				return Response.json({
					result: {
						events: [{ id: 9, type: 'turn_status', data: { running: false } }]
					}
				});
			}
			if (url.includes('/projects/project-b/sessions/shared-session/events?')) {
				return new Response(': connected\n\n', {
					headers: { 'content-type': 'text/event-stream' }
				});
			}
			throw new Error(`unexpected request: ${url}`);
		}) as typeof fetch;

		const state = controllerState();
		state.serverUrl = 'http://127.0.0.1:38136';
		setApiTarget(state, {
			kind: 'service',
			serviceUrl: 'http://127.0.0.1:38136',
			token: 'token',
			projectId: 'project-a'
		});
		state.activeSessionId = 'shared-session';
		state.sessionInput = 'shared-session';
		const controller = createSessionController(state, {
			closeConnectModal: () => {},
			scrollTranscriptToEnd: async () => {}
		});

		try {
			const connectProjectA = controller.connectToServer();
			await waitFor(() =>
				requestUrls.some((url) =>
					url.endsWith('/projects/project-a/sessions/shared-session/action/status')
				)
			);

			controller.clearSessionView();
			setApiTarget(state, {
				kind: 'service',
				serviceUrl: 'http://127.0.0.1:38136',
				token: 'token',
				projectId: 'project-b'
			});
			state.activeSessionId = 'shared-session';
			state.sessionInput = 'shared-session';

			await controller.connectToServer();

			projectAStatus.resolve(
				Response.json({
					result: status({ workspace_root: '/workspace-a' })
				})
			);
			projectAState.resolve(
				Response.json({
					...sessionState(),
					workspace_root: '/workspace-a'
				})
			);
			projectAMessages.resolve(
				Response.json({
					messages: [{ role: 'assistant', content: 'project a transcript' }]
				})
			);
			projectAEventLog.resolve(
				Response.json({
					result: {
						events: [{ id: 3, type: 'turn_status', data: { running: true } }]
					}
				})
			);
			await connectProjectA;

			expect(state.health?.workspace_root).toBe('/workspace-b');
			expect(state.status?.workspace_root).toBe('/workspace-b');
			expect(state.sessionState?.workspace_root).toBe('/workspace-b');
			expect(state.messages).toEqual([
				{ role: 'assistant', content: 'project b transcript' }
			]);
			expect(state.lastEventId).toBe(9);
			expect(
				requestUrls.some((url) =>
					url.includes('/projects/project-a/sessions/shared-session/events?')
				)
			).toBe(false);
		} finally {
			controller.destroy();
		}
	});
});

function delegatedProgressEvent(
    id: number,
    event: Record<string, unknown>,
): string {
    return [
        `id: ${id}`,
        "event: tool_execution.progress",
        `data: ${JSON.stringify({
            call_id: "parent-start-1",
            step: 1,
            index: 0,
            data: {
                kind: "delegated_session",
                session_id: "child-1",
                event,
            },
        })}`,
        "",
        "",
    ].join("\n");
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 1_000;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error("condition timed out");
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

function controllableEventStream(): {
    stream: ReadableStream<Uint8Array>;
    enqueue: (event: string) => void;
} {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
        start(nextController) {
            controller = nextController;
        },
    });
    const encoder = new TextEncoder();
    return {
        stream,
        enqueue(event) {
            controller.enqueue(encoder.encode(event));
        },
    };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

function setApiTarget(
	state: SessionControllerState,
	apiTarget: ChumpApiTarget | null
): void {
	(state as unknown as { apiTarget: ChumpApiTarget | null }).apiTarget = apiTarget;
}

function controllerState(): SessionControllerState & {
    workingSessionIds: string[];
} {
    let apiTarget: ChumpApiTarget = {
        kind: "direct",
        serverUrl: "http://127.0.0.1:38136",
    };
    const state: SessionControllerState & { workingSessionIds: string[] } = {
        workingSessionIds: [] as string[],
        serverUrl: "http://127.0.0.1:38136",
        get apiTarget() {
            return apiTarget;
        },
        set apiTarget(value) {
            apiTarget = value;
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
        delegatedActivities: [],
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
        reasoning: null,
        verbose: false,
        message_count: 1,
        title: null,
        created_at: 1,
        updated_at: 2,
        last_user_goal: "test session loading",
        steering_queue: [],
        instruction_files: [],
        skills: [],
        ...overrides,
    };
}

function health(workspaceRoot: string) {
	return {
		service: 'chump-server',
		workspace_root: workspaceRoot,
		git_branch: 'main',
		available_providers: [],
		available_models: [],
		skills: [],
		reasoning: null
	};
}

function sessionsResponse(sessionId: string, projectId: string) {
	return {
		sessions: [
			{
				id: sessionId,
				active: false,
				message_count: 0,
				event_count: 0,
				title: `${projectId} session`,
				created_at: 1,
				updated_at: 2,
				last_user_goal: null,
				last_activity: null,
				connections: 0
			}
		],
		page: 1,
		page_size: 10,
		total: 1,
		total_pages: 1
	};
}

function sessionState(): ChumpState {
    return {
        workspace_root: "/workspace",
        title: null,
        created_at: 1,
        updated_at: 2,
        last_user_goal: "test session loading",
        files_touched: [],
        commands_run: [],
        notes: [],
    };
}
