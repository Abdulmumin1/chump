import {
    createSessionId,
    getHealth,
    getSessionSnapshot,
    getSessions,
    getState,
    normalizeServerUrl,
    openEventStream,
    type ChumpApiTarget,
} from "$lib/chump/api";
import type {
    ChumpHealth,
    ChumpState,
    ChumpStatus,
    DelegatedSessionActivity,
    SessionSummary,
    StoredMessage,
    SseEvent,
} from "$lib/chump/types";
import {
    isChumpEventType,
    parseDelegatedSessionProgress,
    parseChumpEvent,
    type DelegatedSessionProgress,
} from "$lib/chump/events";
import { listModelChoices, type ModelChoice } from "$lib/models";
import {
    applyLiveEventToMessages,
    buildMessagesFromEventLog,
    parseSteeringQueue,
    removeSteeredQueueItem,
} from "$lib/chat/events";
import { isToolLifecycleEvent } from "$lib/chat/tool-events";
import { parseJson, toErrorMessage } from "$lib/chat/helpers";
import { mergeReasoningText } from "$lib/chat/transcript";
import type { SteeringQueueItem } from "$lib/chat/types";

export type SessionControllerState = {
    get serverUrl(): string;
    set serverUrl(value: string);
    get apiTarget(): ChumpApiTarget | null;
    get sessionInput(): string;
    set sessionInput(value: string);
    get activeSessionId(): string;
    set activeSessionId(value: string);
    get health(): ChumpHealth | null;
    set health(value: ChumpHealth | null);
    get status(): ChumpStatus | null;
    set status(value: ChumpStatus | null);
    get sessionState(): ChumpState | null;
    set sessionState(value: ChumpState | null);
    get sessions(): SessionSummary[];
    set sessions(value: SessionSummary[]);
    get sessionPage(): number;
    set sessionPage(value: number);
    get sessionTotalPages(): number;
    set sessionTotalPages(value: number);
    get sessionTotal(): number;
    set sessionTotal(value: number);
    get messages(): StoredMessage[];
    set messages(value: StoredMessage[]);
    get steeringQueue(): SteeringQueueItem[];
    set steeringQueue(value: SteeringQueueItem[]);
    get isConnecting(): boolean;
    set isConnecting(value: boolean);
    get isSending(): boolean;
    set isSending(value: boolean);
    get isCompacting(): boolean;
    set isCompacting(value: boolean);
    get isLoadingSession(): boolean;
    set isLoadingSession(value: boolean);
    get connectionError(): string;
    set connectionError(value: string);
    get lastEventId(): number;
    set lastEventId(value: number);
    get loadToken(): number;
    set loadToken(value: number);
    get streamToken(): number;
    set streamToken(value: number);
    get stopEvents(): (() => void) | null;
    set stopEvents(value: (() => void) | null);
    get availableModels(): ModelChoice[];
    set availableModels(value: ModelChoice[]);
    get delegatedActivities(): DelegatedSessionActivity[];
    set delegatedActivities(value: DelegatedSessionActivity[]);
};

export function createSessionController(
    state: SessionControllerState,
    callbacks: {
        closeConnectModal: () => void;
        scrollTranscriptToEnd: () => Promise<void>;
    },
) {
    async function connectToServer(
        options: { selectFirstSession?: boolean } = {},
    ): Promise<void> {
        const targetUrl = normalizeServerUrl(state.serverUrl);
        const apiTarget = state.apiTarget;
        if (!targetUrl || !apiTarget) {
            return;
        }

        state.serverUrl = targetUrl;
        state.isConnecting = true;
        state.connectionError = "";

        try {
            const [nextHealth, nextSessionsResponse] = await Promise.all([
                getHealth(apiTarget),
                getSessions(apiTarget),
            ]);

            state.health = nextHealth;
            applySessionsResponse(nextSessionsResponse);
            if (nextHealth.available_providers?.length) {
                listModelChoices(
                    nextHealth.available_providers,
                    nextHealth.available_models,
                )
                    .then((choices) => {
                        state.availableModels = choices;
                    })
                    .catch(console.error);
            } else {
                state.availableModels = [];
            }

            const preferredSessionId =
                state.activeSessionId.trim() ||
                state.sessionInput.trim() ||
                (options.selectFirstSession === false
                    ? ""
                    : (nextSessionsResponse.sessions[0]?.id ?? ""));

            if (preferredSessionId) {
                await selectSession(preferredSessionId);
            } else {
                clearSessionView();
            }
        } catch (error) {
            state.connectionError = toErrorMessage(error);
            clearSessionView();
        } finally {
            if (!state.connectionError) {
                callbacks.closeConnectModal();
            }
            state.isConnecting = false;
        }
    }

    async function refreshSessionsList(): Promise<void> {
        if (!state.serverUrl) {
            return;
        }

        try {
            const apiTarget = state.apiTarget;
            if (!apiTarget) return;
            const firstPage = await getSessions(apiTarget, { page: 1 });
            const loadedPageCount = Math.max(
                1,
                Math.min(state.sessionPage, firstPage.total_pages),
            );
            const remainingPages = await Promise.all(
                Array.from({ length: loadedPageCount - 1 }, (_, index) =>
                    getSessions(apiTarget, { page: index + 2 }),
                ),
            );
            state.sessions = [firstPage, ...remainingPages].flatMap(
                (response) => response.sessions,
            );
            state.sessionPage = loadedPageCount;
            state.sessionTotalPages = firstPage.total_pages;
            state.sessionTotal = firstPage.total;
        } catch (error) {
            state.connectionError = toErrorMessage(error);
        }
    }

    async function loadMoreSessions(): Promise<void> {
        if (!state.apiTarget || state.sessionPage >= state.sessionTotalPages) return;
        try {
            const response = await getSessions(state.apiTarget, {
                page: state.sessionPage + 1,
            });
            const existingSessionIds = new Set(
                state.sessions.map((session) => session.id),
            );
            state.sessions = [
                ...state.sessions,
                ...response.sessions.filter(
                    (session) => !existingSessionIds.has(session.id),
                ),
            ];
            state.sessionPage = response.page;
            state.sessionTotalPages = response.total_pages;
            state.sessionTotal = response.total;
        } catch (error) {
            state.connectionError = toErrorMessage(error);
        }
    }

    function applySessionsResponse(response: {
        sessions: SessionSummary[];
        page: number;
        total_pages: number;
        total: number;
    }): void {
        state.sessions = response.sessions;
        state.sessionPage = response.page;
        state.sessionTotalPages = response.total_pages;
        state.sessionTotal = response.total;
    }

    async function selectSession(sessionId: string): Promise<void> {
        const nextSessionId = sessionId.trim();
        if (!nextSessionId || !state.serverUrl) {
            return;
        }

        state.activeSessionId = nextSessionId;
        state.sessionInput = nextSessionId;
        // Session-scoped status must never leak into the next active view while
        // its snapshot is loading. The previous turn continues server-side.
        state.status = null;
        state.sessionState = null;
        state.messages = [];
        state.steeringQueue = [];
        state.delegatedActivities = [];
        state.isSending = false;
        state.isCompacting = false;
        state.lastEventId = 0;
        state.stopEvents?.();
        state.stopEvents = null;
        state.streamToken += 1;
        state.isLoadingSession = true;
        try {
            await refreshSessionSnapshot(nextSessionId);
        } finally {
            state.isLoadingSession = false;
        }
        openSessionStream(nextSessionId);
    }

    async function refreshSessionSnapshot(sessionId: string): Promise<void> {
        if (!state.serverUrl || !sessionId) {
            return;
        }

        const currentToken = state.loadToken + 1;
        state.loadToken = currentToken;
        state.connectionError = "";

        try {
            const apiTarget = state.apiTarget;
            if (!apiTarget) return;
            const snapshot = await getSessionSnapshot(apiTarget, sessionId);

            if (currentToken !== state.loadToken || state.activeSessionId !== sessionId) {
                return;
            }

            const nextState = await getState(apiTarget, sessionId);

            if (currentToken !== state.loadToken || state.activeSessionId !== sessionId) {
                return;
            }

            applyStatus(snapshot.status);
            state.steeringQueue = parseSteeringQueue({
                items: snapshot.status.steering_queue ?? [],
            });
            state.sessionState = nextState;
            const unfinishedDurableTurn = eventLogHasUnfinishedTurn(snapshot.events);
            if (snapshot.status.turn_running === true || unfinishedDurableTurn) {
                state.messages = buildMessagesFromEventLog(snapshot.events);
            } else {
                state.messages = snapshot.messages;
            }
            state.lastEventId = Math.max(
                0,
                ...snapshot.events.map((event) => event.id),
            );

            await callbacks.scrollTranscriptToEnd();
        } catch (error) {
            if (currentToken !== state.loadToken) {
                return;
            }
            state.connectionError = toErrorMessage(error);
        }
    }

    function ensureSessionListed(sessionId: string): void {
        if (state.sessions.some((session) => session.id === sessionId)) {
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        state.sessions = [
            {
                id: sessionId,
                active: false,
                message_count: 0,
                event_count: 0,
                title: null,
                created_at: now,
                updated_at: now,
                last_user_goal: null,
                last_activity: null,
                connections: 0,
            },
            ...state.sessions,
        ];
    }

    async function openTypedSession(): Promise<void> {
        const nextSessionId = state.sessionInput.trim();
        if (!nextSessionId) {
            return;
        }

        if (!state.health && state.serverUrl) {
            await connectToServer({ selectFirstSession: false });
        }

        await selectSession(nextSessionId);
    }

    async function createFreshSession(): Promise<void> {
        if (!state.health && state.serverUrl) {
            await connectToServer({ selectFirstSession: false });
        }

        if (!state.health) {
            return;
        }

        const newSessionId = createSessionId(state.health.workspace_root);
        ensureSessionListed(newSessionId);
        await selectSession(newSessionId);
    }

    async function ensureActiveSession(): Promise<string | null> {
        if (state.activeSessionId.trim()) {
            return state.activeSessionId.trim();
        }

        if (!state.health) {
            await connectToServer({ selectFirstSession: false });
        }

        if (!state.health) {
            return null;
        }

        const newSessionId = createSessionId(state.health.workspace_root);
        ensureSessionListed(newSessionId);
        await selectSession(newSessionId);
        return newSessionId;
    }

    function clearSessionView(): void {
        state.stopEvents?.();
        state.stopEvents = null;
        state.streamToken += 1;
        state.status = null;
        state.sessionState = null;
        state.messages = [];
        state.steeringQueue = [];
        state.delegatedActivities = [];
        state.isSending = false;
        state.isCompacting = false;
        state.lastEventId = 0;
        if (!state.sessions.some((session) => session.id === state.activeSessionId)) {
            state.activeSessionId = "";
        }
    }

    function destroy(): void {
        state.stopEvents?.();
        state.stopEvents = null;
    }

    function patchActiveSession(nextState: ChumpState): void {
        state.sessions = state.sessions.map((session) =>
            session.id === state.activeSessionId
                ? {
                      ...session,
                      title: nextState.title ?? session.title,
                      updated_at: nextState.updated_at ?? session.updated_at,
                      last_user_goal:
                          nextState.last_user_goal ?? session.last_user_goal,
                  }
                : session,
        );
    }

    function openSessionStream(sessionId: string): void {
        const apiTarget = state.apiTarget;
        if (!apiTarget) {
            return;
        }

        state.stopEvents?.();
        const currentStreamToken = state.streamToken + 1;
        state.streamToken = currentStreamToken;
        state.stopEvents = openEventStream(
            apiTarget,
            sessionId,
            {
                onEvent: async (event) => {
                    await handleAgentEvent(sessionId, currentStreamToken, event);
                    if (!isCurrentStream(sessionId, currentStreamToken)) {
                        return;
                    }
                    const eventId = Number(event.id);
                    if (Number.isSafeInteger(eventId) && eventId >= 0) {
                        state.lastEventId = eventId;
                    }
                },
                onError: (error) => {
                    if (!isCurrentStream(sessionId, currentStreamToken)) {
                        return;
                    }
                    console.debug("event stream reconnecting", toErrorMessage(error));
                },
            },
            { lastEventId: state.lastEventId },
        );
    }

    async function handleAgentEvent(
        sessionId: string,
        currentStreamToken: number,
        event: SseEvent,
    ): Promise<void> {
        if (!isCurrentStream(sessionId, currentStreamToken)) {
            return;
        }

        const rawPayload = parseJson(event.data);

        if (event.event === "error") {
            state.connectionError = toErrorMessage(
                rawPayload ?? (event.data || "An event stream error occurred"),
            );
            return;
        }

        if (event.event === "tool_execution.progress") {
            const progress = parseDelegatedSessionProgress(rawPayload);
            if (progress) {
                state.delegatedActivities = applyDelegatedProgress(
                    state.delegatedActivities,
                    progress,
                );
            }
            return;
        }

        const chumpEvent = parseChumpEvent(event.event, rawPayload);
        if (isChumpEventType(event.event) && !chumpEvent) {
            return;
        }
        const payload = chumpEvent?.data ?? rawPayload;

        if (chumpEvent?.type === "turn_error") {
            state.connectionError = chumpEvent.data.message;
            state.delegatedActivities = [];
            return;
        }

        if (event.event === "assistant_text" || event.event === "reasoning") {
            state.messages = applyLiveEventToMessages(
                state.messages,
                event.event,
                payload,
            );
            if (isCurrentStream(sessionId, currentStreamToken)) {
                await callbacks.scrollTranscriptToEnd();
            }
            return;
        }

        if (!isCurrentStream(sessionId, currentStreamToken)) {
            return;
        }

        if (
            event.event === "state" &&
            payload?.state &&
            typeof payload.state === "object"
        ) {
            state.sessionState = payload.state as ChumpState;
            patchActiveSession(payload.state as ChumpState);
        }

        if (event.event === "agent_status" && payload) {
            applyStatus(payload as ChumpStatus);
            return;
        }

        if (event.event === "turn_status" && payload) {
            state.isSending = payload.running === true;
            if (Array.isArray(payload.steering_queue)) {
                state.steeringQueue = parseSteeringQueue({
                    items: payload.steering_queue,
                });
            }
            if (!state.isSending) {
                void refreshCompletedTurn(sessionId, currentStreamToken);
                void refreshSessionsList();
            }
            return;
        }

        if (
            (event.event === "tool_result" || event.event === "tool_execution.finished") &&
            payload
        ) {
            state.delegatedActivities = settleDelegatedActivity(
                state.delegatedActivities,
                payload,
            );
        }

        if (event.event === "compaction_status" && payload) {
            state.isCompacting = payload.running === true;
            if (!state.isCompacting) {
                void refreshCompletedTurn(sessionId, currentStreamToken);
                void refreshSessionsList();
            }
            return;
        }

        if (event.event === "steering_queue" && payload) {
            state.steeringQueue = parseSteeringQueue(payload);
            return;
        }

        state.messages = applyLiveEventToMessages(
            state.messages,
            event.event,
            payload,
        );
        if (event.event === "user_message") {
            state.steeringQueue = removeSteeredQueueItem(
                state.steeringQueue,
                payload,
            );
        }

        if (
            (event.event === "user_message" ||
                isToolLifecycleEvent(event.event)) &&
            isCurrentStream(sessionId, currentStreamToken)
        ) {
            await callbacks.scrollTranscriptToEnd();
        }
    }

    async function refreshCompletedTurn(
        sessionId: string,
        currentStreamToken: number,
    ): Promise<void> {
        const apiTarget = state.apiTarget;
        if (!apiTarget) return;

        try {
            const snapshot = await getSessionSnapshot(apiTarget, sessionId);
            if (
                !isCurrentStream(sessionId, currentStreamToken) ||
                state.isSending
            ) {
                return;
            }
            state.messages = snapshot.messages;
        } catch {
            // Non-fatal: live messages are still displayed.
        } finally {
            if (
                isCurrentStream(sessionId, currentStreamToken) &&
                !state.isSending
            ) {
                state.delegatedActivities = [];
            }
        }
    }

    function isCurrentStream(
        sessionId: string,
        currentStreamToken: number,
    ): boolean {
        return (
            state.activeSessionId === sessionId &&
            state.streamToken === currentStreamToken
        );
    }

    function applyStatus(nextStatus: ChumpStatus): void {
        state.status = nextStatus;
        state.isSending = nextStatus.turn_running === true;
    }

    return {
        connectToServer,
        refreshSessionsList,
        loadMoreSessions,
        selectSession,
        refreshSessionSnapshot,
        ensureSessionListed,
        openTypedSession,
        createFreshSession,
        ensureActiveSession,
        clearSessionView,
        destroy,
    };
}

function applyDelegatedProgress(
    current: DelegatedSessionActivity[],
    progress: DelegatedSessionProgress,
): DelegatedSessionActivity[] {
    const key = `${progress.parentCallId}:${progress.parentStep}:${progress.parentIndex}`;
    const existing = current.find(
        (activity) =>
            `${activity.parentCallId}:${activity.parentStep}:${activity.parentIndex}` === key,
    );
    const event = progress.event;
    let phase = existing?.phase ?? "Starting delegated task";
    let activeTool = existing?.activeTool ?? null;
    let latestDetail = existing?.latestDetail ?? null;
    if (event.type === "reasoning") {
        phase = "Thinking";
        activeTool = null;
        const previousReasoning =
            latestDetail?.kind === "reasoning" ? latestDetail.text : "";
        const incomingReasoning = summarizeDelegatedReasoning(event.text);
        const text = summarizeDelegatedReasoning(
            mergeReasoningText(
                previousReasoning,
                previousReasoning && /^\s/.test(event.text)
                    ? ` ${incomingReasoning}`
                    : incomingReasoning,
            ),
        );
        if (text) {
            latestDetail = { kind: "reasoning", text };
        }
    } else if (event.type === "tool_call") {
        phase = "Working";
        activeTool = event.name;
        latestDetail = {
            kind: "tool",
            name: event.name,
            callId: event.callId,
            detail: delegatedToolDetail(event.name, event.args),
            status: "running",
        };
    } else if (event.type === "tool_result") {
        phase = event.status === "ok" ? "Working" : `Failed: ${event.name}`;
        activeTool = null;
        latestDetail = {
            kind: "tool",
            name: event.name,
            callId: event.callId,
            detail:
                latestDetail?.kind === "tool" &&
                latestDetail.callId === event.callId
                    ? latestDetail.detail
                    : "",
            status: event.status === "ok" ? "completed" : "error",
        };
    } else if (event.type === "assistant_text") {
        phase = "Writing response";
        activeTool = null;
    } else if (event.type === "status" && event.phase === "step_start") {
        phase = `Working on step ${event.step}`;
    } else if (event.type === "turn_error") {
        phase = `Failed: ${event.message}`;
        activeTool = null;
        latestDetail = null;
    }

    const next: DelegatedSessionActivity = {
        parentCallId: progress.parentCallId,
        parentStep: progress.parentStep,
        parentIndex: progress.parentIndex,
        sessionId: progress.sessionId,
        model: existing?.model ?? null,
        phase,
        activeTool,
        latestDetail,
        updatedAt: Date.now(),
    };
    return existing
        ? current.map((activity) =>
              `${activity.parentCallId}:${activity.parentStep}:${activity.parentIndex}` === key
                  ? next
                  : activity,
          )
        : [...current, next];
}

function summarizeDelegatedReasoning(value: string): string {
    return value
        .replace(/\r?\n+/g, " ")
        .replace(/[*_`#>]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function delegatedToolDetail(
    name: string,
    args: Record<string, unknown>,
): string {
    const stringArg = (...keys: string[]): string => {
        for (const key of keys) {
            const value = args[key];
            if (typeof value === "string" && value.trim()) return value.trim();
        }
        return "";
    };

    if (name === "bash" || name === "execute_command") {
        return stringArg("command", "cmd");
    }
    if (
        name === "read_file" ||
        name === "view_file" ||
        name === "view_image" ||
        name === "write_file" ||
        name === "create_file" ||
        name === "edit_file"
    ) {
        const path = stringArg("file_path", "path");
        if (!path || (name !== "read_file" && name !== "view_file")) return path;

        const offset = typeof args.offset === "number" ? `L${args.offset}` : "";
        const limit = typeof args.limit === "number" ? `+${args.limit}` : "";
        return [path, [offset, limit].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(" · ");
    }
    if (name === "apply_patch") {
        const patch = stringArg("patch_text", "patch", "diff");
        const file = patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)?.[1];
        return file ?? "Applying file changes";
    }
    if (name === "search") {
        const query = stringArg("query");
        const path = stringArg("path");
        return [query, path ? `in ${path}` : ""].filter(Boolean).join(" ");
    }
    if (name === "website" || name === "web_search") {
        return stringArg("query");
    }
    if (name === "web_fetch") {
        return stringArg("url");
    }
    if (name === "skill" || name === "load_skill") {
        return stringArg("name");
    }
    if (name === "inspect_session" || name === "start_session") {
        return stringArg("session_id");
    }
    if (name === "mcp") {
        return [
            stringArg("server"),
            stringArg("tool_name", "action", "query"),
        ]
            .filter(Boolean)
            .join(" / ");
    }
    return "";
}

function settleDelegatedActivity(
    current: DelegatedSessionActivity[],
    payload: Record<string, unknown>,
): DelegatedSessionActivity[] {
    const callId = typeof payload.call_id === "string" ? payload.call_id : null;
    const step = typeof payload.step === "number" ? payload.step : null;
    const index = typeof payload.index === "number" ? payload.index : null;
    return current.filter(
        (activity) =>
            !(
                (callId !== null && activity.parentCallId === callId) ||
                (step !== null && index !== null &&
                    activity.parentStep === step && activity.parentIndex === index)
            ),
    );
}

function eventLogHasUnfinishedTurn(
    events: Array<{ type: string; data: Record<string, unknown> }>,
): boolean {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === "turn_status") {
            return event.data.running === true;
        }
    }
    return false;
}
