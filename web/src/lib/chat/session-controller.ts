import {
    createSessionId,
    getEventLog,
    getHealth,
    getMessages,
    getSessions,
    getState,
    getStatus,
    normalizeServerUrl,
    openEventStream,
    type ChumpApiTarget,
} from "$lib/chump/api";
import type {
    ChumpHealth,
    ChumpState,
    ChumpStatus,
    SessionSummary,
    StoredMessage,
    SseEvent,
} from "$lib/chump/types";
import { listModelChoices, type ModelChoice } from "$lib/models";
import {
    applyLiveEventToMessages,
    buildMessagesFromEventLog,
    parseSteeringQueue,
    removeSteeredQueueItem,
} from "$lib/chat/events";
import { isToolLifecycleEvent } from "$lib/chat/tool-events";
import { parseJson, toErrorMessage } from "$lib/chat/helpers";
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
                listModelChoices(nextHealth.available_providers)
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
            if (!state.apiTarget) return;
            const nextSessions = await getSessions(state.apiTarget, {
                page: state.sessionPage,
            });
            applySessionsResponse(nextSessions);
        } catch (error) {
            state.connectionError = toErrorMessage(error);
        }
    }

    async function loadSessionsPage(page: number): Promise<void> {
        if (!state.apiTarget || page < 1 || page > state.sessionTotalPages) return;
        try {
            applySessionsResponse(await getSessions(state.apiTarget, { page }));
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
        state.messages = [];
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
            const nextStatus = await getStatus(apiTarget, sessionId);

            if (currentToken !== state.loadToken || state.activeSessionId !== sessionId) {
                return;
            }

            const [nextState, nextMessages] = await Promise.all([
                getState(apiTarget, sessionId),
                getMessages(apiTarget, sessionId),
            ]);

            if (currentToken !== state.loadToken || state.activeSessionId !== sessionId) {
                return;
            }

            applyStatus(nextStatus);
            state.steeringQueue = parseSteeringQueue({
                items: nextStatus.steering_queue ?? [],
            });
            state.sessionState = nextState;
            state.messages = nextMessages.messages;
            state.lastEventId = 0;

            if (nextStatus.turn_running === true) {
                try {
                    const eventLog = await getEventLog(apiTarget, sessionId);
                    if (
                        currentToken !== state.loadToken ||
                        state.activeSessionId !== sessionId
                    ) {
                        return;
                    }
                    if (eventLog.events.length > 0) {
                        state.messages = buildMessagesFromEventLog(eventLog.events);
                        state.lastEventId = eventLog.events.at(-1)?.id ?? 0;
                    }
                } catch {
                    // Fall back to the stored message snapshot if event-log hydration fails.
                }
            }

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

        const currentStreamToken = state.streamToken + 1;
        state.streamToken = currentStreamToken;
        state.stopEvents = openEventStream(
            apiTarget,
            sessionId,
            {
                onEvent: (event) => {
                    void handleAgentEvent(sessionId, currentStreamToken, event);
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

        if (event.id) {
            const parsed = Number(event.id);
            if (Number.isFinite(parsed)) {
                state.lastEventId = parsed;
            }
        }

        const payload = parseJson(event.data);

        if (event.event === "error") {
            state.connectionError = toErrorMessage(
                payload ?? (event.data || "An event stream error occurred"),
            );
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
                void refreshMessages(sessionId, currentStreamToken);
                void refreshSessionsList();
            }
            return;
        }

        if (event.event === "compaction_status" && payload) {
            state.isCompacting = payload.running === true;
            if (!state.isCompacting) {
                void refreshMessages(sessionId, currentStreamToken);
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

    async function refreshMessages(
        sessionId: string,
        currentStreamToken: number,
    ): Promise<void> {
        const apiTarget = state.apiTarget;
        if (!apiTarget) return;

        try {
            const response = await getMessages(apiTarget, sessionId);
            if (!isCurrentStream(sessionId, currentStreamToken)) return;
            state.messages = response.messages;
        } catch {
            // Non-fatal: live messages are still displayed.
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
        if (nextStatus.turn_running === true) {
            state.isSending = true;
        }
    }

    return {
        connectToServer,
        refreshSessionsList,
        loadSessionsPage,
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
