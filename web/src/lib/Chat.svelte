<script lang="ts">
    import { browser } from "$app/environment";
    import { onMount, tick } from "svelte";
    import { cubicOut } from "svelte/easing";
    import { fade, fly } from "svelte/transition";
    import SessionsSidebar from "$lib/SessionsSidebar.svelte";
    import TranscriptPane from "$lib/TranscriptPane.svelte";
    import ChatComposer from "$lib/ChatComposer.svelte";
    import Toasts from "$lib/Toasts.svelte";
    import WorkspaceState from "$lib/WorkspaceState.svelte";

    import {
        abortCurrentTurn,
        cancelSteering,
        clearMessages,
        createSessionId,
        getEventLog,
        getHealth,
        getMessages,
        getSessions,
        getState,
        getStatus,
        normalizeServerUrl,
        openEventStream,
        sessionTitle,
        setModel,
        setReasoning,
        steerCurrentTurn,
        streamChat,
    } from "$lib/chump/api";
    import type {
        ChatAttachment,
        ChumpHealth,
        ChumpState,
        ChumpStatus,
        MessagePart,
        SessionSummary,
        StoredMessage,
        SseEvent,
    } from "$lib/chump/types";

    type TranscriptBlock = {
        kind: "text" | "tool-call" | "tool-result" | "image" | "reasoning";
        text: string;
        error?: boolean;
        toolCallId?: string;
        toolName?: string;
        originalToolName?: string;
        args?: Record<string, unknown>;
        result?: unknown;
        metadata?: Record<string, unknown>;
        hasResult?: boolean;
        isDiff?: boolean;
        diffContent?: string;
    };

    type TranscriptMessage = {
        id: string;
        role: string;
        label: string;
        blocks: TranscriptBlock[];
        live?: boolean;
    };

    type ActivityItem = {
        id: string;
        label: string;
        detail: string;
        tone: "default" | "error" | "muted";
    };

    type BarcodeDetectorResult = {
        rawValue: string;
    };

    type BarcodeDetectorInstance = {
        detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
    };

    type BarcodeDetectorConstructor = {
        new (options?: { formats?: string[] }): BarcodeDetectorInstance;
        getSupportedFormats?: () => Promise<string[]>;
    };

    import {
        listModelChoices,
        formatCtxLabel,
        type ModelChoice,
    } from "$lib/models";

    let { data }: { data: any } = $props();
    const initialServerUrl = () => data?.initialServerUrl ?? "";
    const initialSessionId = () => data?.initialSessionId ?? "";

    let serverUrl = $state(initialServerUrl());
    let sessionInput = $state(initialSessionId());
    let activeSessionId = $state(initialSessionId());
    let health = $state<ChumpHealth | null>(null);
    let status = $state<ChumpStatus | null>(null);
    let sessionState = $state<ChumpState | null>(null);
    let sessions = $state<SessionSummary[]>([]);
    let messages = $state<StoredMessage[]>([]);
    let activity = $state<ActivityItem[]>([]);
    let steeringQueue = $state<
        Array<{ content: string; attachments?: Array<Record<string, unknown>> }>
    >([]);
    let composerText = $state("");
    let composerAttachments = $state<ChatAttachment[]>([]);
    let isConnecting = $state(false);

    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let spinnerFrame = $state(0);
    let spinnerTimer: ReturnType<typeof setInterval> | null = null;
    $effect(() => {
        if (isConnecting) {
            spinnerFrame = 0;
            spinnerTimer = setInterval(() => {
                spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
            }, 80);
        } else {
            if (spinnerTimer) clearInterval(spinnerTimer);
            spinnerTimer = null;
        }
        return () => {
            if (spinnerTimer) clearInterval(spinnerTimer);
        };
    });

    let isLoadingSession = $state(false);
    let isSending = $state(false);
    let connectionError = $state("");
    let actionNotice = $state("");
    let transcriptElement = $state<HTMLDivElement | null>(null);
    let isAtBottom = $state(true);
    let connectUrlInput = $state<HTMLInputElement | null>(null);
    let modelSearchInput = $state<HTMLInputElement | null>(null);
    let stopEvents: (() => void) | null = null;
    let lastEventId = 0;
    let loadToken = 0;
    let streamToken = 0;
    let activeRequestController: AbortController | null = null;
    let expandedBlocks = $state<Record<string, boolean>>({});
    let expandedReasoning = $state<Record<string, boolean>>({});
    let sidebarOpen = $state(false);
    let connectModalOpen = $state(false);
    let qrScannerOpen = $state(false);
    let qrScannerError = $state("");
    let qrVideoElement = $state<HTMLVideoElement | null>(null);
    let qrScannerStream: MediaStream | null = null;
    let qrScannerFrame = 0;
    let modelPickerOpen = $state(false);
    let toasts = $state<
        Array<{
            id: number;
            message: string;
            type?: "default" | "success" | "error";
        }>
    >([]);
    let toastId = 0;
    let modelSearchQuery = $state("");

    let availableModels = $state<ModelChoice[]>([]);
    let currentProvider = $derived(status ? status.provider : "");

    let contextUsageLabel = $state<string | null>(null);
    $effect(() => {
        const source = status ?? health;
        if (source) {
            formatCtxLabel(source).then((label) => {
                contextUsageLabel = label;
            });
        } else {
            contextUsageLabel = null;
        }
    });

    function pushToast(
        message: string,
        type: "default" | "success" | "error" = "default",
    ) {
        toastId += 1;
        const id = toastId;
        toasts = [...toasts, { id, message, type }];
        setTimeout(() => {
            toasts = toasts.filter((t) => t.id !== id);
        }, 3000);
    }

    function toggleBlock(id: string) {
        expandedBlocks[id] = !expandedBlocks[id];
    }
    function toggleReasoning(id: string) {
        expandedReasoning[id] = !(expandedReasoning[id] ?? true);
    }
    function toggleSidebar() {
        sidebarOpen = !sidebarOpen;
    }
    function closeSidebar() {
        sidebarOpen = false;
    }

    // Swipe gesture logic
    let touchStartX = $state<number | null>(null);
    let touchStartY = $state<number | null>(null);
    let touchCurrentX = $state<number | null>(null);
    let touchStartTime = $state<number>(0);
    let isDraggingSidebar = $state(false);
    let dragDirectionLocked = $state(false);

    function handleTouchStart(e: TouchEvent) {
        // Don't intercept touches on code blocks or horizontally scrollable areas
        if (e.target instanceof Element && e.target.closest('pre, code, [class*="overflow-x"]')) {
            return;
        }

        const x = e.touches[0].clientX;
        const y = e.touches[1] ? null : e.touches[0].clientY;
        // If closed, allow swipe from the left half of the screen to avoid Android's edge-swipe "back" gesture
        if (!sidebarOpen && x > window.innerWidth / 2) return;
        
        touchStartX = x;
        touchStartY = y;
        touchCurrentX = x;
        touchStartTime = Date.now();
        isDraggingSidebar = true;
        dragDirectionLocked = false;
    }

    function handleTouchMove(e: TouchEvent) {
        if (!isDraggingSidebar || touchStartX === null) return;
        
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        
        if (!dragDirectionLocked && touchStartY !== null) {
            const dx = Math.abs(currentX - touchStartX);
            const dy = Math.abs(currentY - touchStartY);
            
            // If moved more than 10px, lock direction
            if (dx > 10 || dy > 10) {
                if (dy > dx) {
                    // Vertical scroll, cancel drag
                    isDraggingSidebar = false;
                    return;
                } else {
                    // Horizontal drag, lock it
                    dragDirectionLocked = true;
                    e.preventDefault();
                }
            } else {
                // Not enough movement to lock, still update X to avoid jump later
                touchCurrentX = currentX;
                return;
            }
        }
        
        touchCurrentX = currentX;
        
        if (dragDirectionLocked) {
            e.preventDefault();
        }
    }

    function handleTouchEnd() {
        if (!isDraggingSidebar || touchStartX === null || touchCurrentX === null) return;
        
        if (!dragDirectionLocked) {
            // Never crossed the movement threshold, treat as tap or cancel
            isDraggingSidebar = false;
            return;
        }
        
        const deltaX = touchCurrentX - touchStartX;
        const velocity = deltaX / Math.max(1, Date.now() - touchStartTime);
        
        let shouldOpen = sidebarOpen;
        if (!sidebarOpen) {
            if (deltaX > 60 || velocity > 0.3) shouldOpen = true;
        } else {
            if (deltaX < -60 || velocity < -0.3) shouldOpen = false;
        }
        
        sidebarOpen = shouldOpen;
        isDraggingSidebar = false;
        touchStartX = null;
        touchCurrentX = null;
    }

    let dragOffset = $derived((touchCurrentX !== null && touchStartX !== null) ? touchCurrentX - touchStartX : 0);
    let sidebarTranslate = $derived(isDraggingSidebar ? Math.min(0, Math.max(-240, (sidebarOpen ? 0 : -240) + dragOffset)) : (sidebarOpen ? 0 : -240));
    let sidebarProgress = $derived((sidebarTranslate + 240) / 240);

    function swipeable(node: HTMLElement) {
        node.addEventListener('touchstart', handleTouchStart, { passive: true });
        node.addEventListener('touchmove', handleTouchMove, { passive: false });
        node.addEventListener('touchend', handleTouchEnd, { passive: true });
        node.addEventListener('touchcancel', handleTouchEnd, { passive: true });
        
        return {
            destroy() {
                node.removeEventListener('touchstart', handleTouchStart);
                node.removeEventListener('touchmove', handleTouchMove);
                node.removeEventListener('touchend', handleTouchEnd);
                node.removeEventListener('touchcancel', handleTouchEnd);
            }
        };
    }

    async function openConnectModal() {
        connectModalOpen = true;
        closeSidebar();
        await tick();
        connectUrlInput?.focus();
    }
    function closeConnectModal() {
        connectModalOpen = false;
        stopQrScanner();
    }
    async function openModelPicker() {
        modelPickerOpen = true;
        modelSearchQuery = "";
        await tick();
        modelSearchInput?.focus();
    }
    function closeModelPicker() {
        modelPickerOpen = false;
        modelSearchQuery = "";
    }

    let selectedSession = $derived(
        sessions.find((session) => session.id === activeSessionId) ?? null,
    );
    let transcript = $derived(buildTranscript(messages));
    let canConnect = $derived(serverUrl.trim().length > 0);
    let canSend = $derived(
        Boolean(
            serverUrl &&
            (composerText.trim().length > 0 || composerAttachments.length > 0),
        ),
    );

    let filteredModels = $derived(
        availableModels.filter(
            (m) =>
                m.label
                    .toLowerCase()
                    .includes(modelSearchQuery.toLowerCase()) ||
                m.description
                    .toLowerCase()
                    .includes(modelSearchQuery.toLowerCase()),
        ),
    );

    let groupedModels = $derived.by(() => {
        const groups: Array<{provider: string, models: ModelChoice[]}> = [];
        const map: Record<string, number> = {};
        for (const m of filteredModels) {
            if (map[m.provider] === undefined) {
                map[m.provider] = groups.length;
                groups.push({provider: m.provider, models: []});
            }
            groups[map[m.provider]].models.push(m);
        }
        return groups;
    });

    let currentModel = $derived(
        status ? `${status.provider}/${status.model}` : "",
    );
    let displayWorkspace = $derived(
        shortenWorkspacePath(
            status?.workspace_root ?? health?.workspace_root ?? "",
        ),
    );
    let currentGitBranch = $derived(
        status?.git_branch ?? health?.git_branch ?? "",
    );
    let reasoningInfo = $derived.by(() => {
        const r = status?.reasoning ?? health?.reasoning;
        if (!r || typeof r !== "object") return null;
        return {
            effort: typeof r.effort === "string" ? r.effort : null,
            budget: typeof r.budget === "number" ? r.budget : null,
        };
    });

    function shortenWorkspacePath(path: string): string {
        if (!path) return "";
        const parts = path.split(/[/\\]/).filter(Boolean);
        return parts.length > 0 ? parts[parts.length - 1] : path;
    }

    function shortenModel(name: string): string {
        return name.replace(/^workers_ai\/@cf\//, "").replace(/^@cf\//, "");
    }

    $effect(() => {
        if (!browser) {
            return;
        }

        const params = new URLSearchParams();
        if (serverUrl.trim()) {
            params.set("server", serverUrl.trim());
        }
        if (activeSessionId.trim()) {
            params.set("session", activeSessionId.trim());
        }

        const query = params.toString();
        const nextUrl = query
            ? `${window.location.pathname}?${query}`
            : window.location.pathname;
        window.history.replaceState({}, "", nextUrl);
    });

    $effect(() => {
        const el = transcriptElement;
        if (el) {
            const handleScroll = () => {
                const threshold = 50;
                isAtBottom =
                    el.scrollHeight - el.scrollTop - el.clientHeight <=
                    threshold;
            };
            el.addEventListener("scroll", handleScroll);
            return () => el.removeEventListener("scroll", handleScroll);
        }
    });

    onMount(() => {
        if (serverUrl.trim()) {
            void connectToServer();
        }

        return () => {
            stopEvents?.();
            stopEvents = null;
            stopQrScanner();
            activeRequestController?.abort();
        };
    });

    function readBarcodeDetector(): BarcodeDetectorConstructor | null {
        if (!browser || !("BarcodeDetector" in window)) {
            return null;
        }

        return (
            (
                window as Window & {
                    BarcodeDetector?: BarcodeDetectorConstructor;
                }
            ).BarcodeDetector ?? null
        );
    }

    function applyScannedConnectValue(value: string): void {
        const trimmed = value.trim();
        if (!trimmed) return;

        try {
            const url = new URL(trimmed);
            const scannedServer = url.searchParams.get("server");
            const scannedSession = url.searchParams.get("session");
            if (scannedServer) {
                serverUrl = scannedServer;
                if (scannedSession) {
                    sessionInput = scannedSession;
                    activeSessionId = scannedSession;
                }
                return;
            }
        } catch {
            // Not a URL with connection params; treat it as a raw server URL.
        }

        serverUrl = trimmed;
    }

    async function startQrScanner(): Promise<void> {
        const Detector = readBarcodeDetector();
        if (!Detector) {
            qrScannerError = "QR scanning is not supported in this browser.";
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            qrScannerError = "Camera access is not available in this browser.";
            return;
        }

        qrScannerOpen = true;
        qrScannerError = "";
        await tick();

        if (!qrVideoElement) {
            qrScannerError = "Scanner video is not ready.";
            qrScannerOpen = false;
            return;
        }

        try {
            qrScannerStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
                audio: false,
            });
            qrVideoElement.srcObject = qrScannerStream;
            await qrVideoElement.play();

            const detector = new Detector({ formats: ["qr_code"] });
            scanQrFrame(detector);
        } catch (error) {
            stopQrScanner();
            qrScannerError = toErrorMessage(error);
        }
    }

    function stopQrScanner(): void {
        qrScannerOpen = false;
        qrScannerError = "";
        if (qrScannerFrame) {
            cancelAnimationFrame(qrScannerFrame);
            qrScannerFrame = 0;
        }
        qrScannerStream?.getTracks().forEach((track) => track.stop());
        qrScannerStream = null;
        if (qrVideoElement) {
            qrVideoElement.srcObject = null;
        }
    }

    function scanQrFrame(detector: BarcodeDetectorInstance): void {
        qrScannerFrame = requestAnimationFrame(async () => {
            if (!qrScannerOpen || !qrVideoElement) return;

            try {
                const results = await detector.detect(qrVideoElement);
                const value = results[0]?.rawValue;
                if (value) {
                    applyScannedConnectValue(value);
                    stopQrScanner();
                    return;
                }
            } catch (error) {
                qrScannerError = toErrorMessage(error);
            }

            scanQrFrame(detector);
        });
    }

    async function connectToServer(
        options: { selectFirstSession?: boolean } = {},
    ): Promise<void> {
        const targetUrl = normalizeServerUrl(serverUrl);
        if (!targetUrl) {
            return;
        }

        serverUrl = targetUrl;
        isConnecting = true;
        connectionError = "";
        actionNotice = "";

        try {
            const [nextHealth, nextSessionsResponse] = await Promise.all([
                getHealth(targetUrl),
                getSessions(targetUrl),
            ]);

            health = nextHealth;
            sessions = nextSessionsResponse.sessions;
            if (nextHealth.available_providers?.length) {
                listModelChoices(nextHealth.available_providers)
                    .then((choices) => {
                        availableModels = choices;
                    })
                    .catch(console.error);
            } else {
                availableModels = [];
            }

            const preferredSessionId =
                activeSessionId.trim() ||
                sessionInput.trim() ||
                (options.selectFirstSession === false
                    ? ""
                    : (nextSessionsResponse.sessions[0]?.id ?? ""));

            if (preferredSessionId) {
                await selectSession(preferredSessionId);
            } else {
                clearSessionView();
            }
        } catch (error) {
            connectionError = toErrorMessage(error);
            clearSessionView();
        } finally {
            if (!connectionError) {
                closeConnectModal();
            }
            isConnecting = false;
        }
    }

    async function refreshSessionsList(): Promise<void> {
        if (!serverUrl) {
            return;
        }

        try {
            const nextSessions = await getSessions(serverUrl);
            sessions = nextSessions.sessions;
        } catch (error) {
            connectionError = toErrorMessage(error);
        }
    }

    function patchActiveSession(state: ChumpState): void {
        sessions = sessions.map((s) =>
            s.id === activeSessionId
                ? {
                      ...s,
                      title: state.title ?? s.title,
                      updated_at: state.updated_at ?? s.updated_at,
                      last_user_goal: state.last_user_goal ?? s.last_user_goal,
                  }
                : s,
        );
    }

    async function selectSession(sessionId: string): Promise<void> {
        const nextSessionId = sessionId.trim();
        if (!nextSessionId || !serverUrl) {
            return;
        }

        activeSessionId = nextSessionId;
        sessionInput = nextSessionId;
        messages = [];
        activity = [];
        lastEventId = 0;
        stopEvents?.();
        stopEvents = null;
        streamToken += 1;
        await refreshSessionSnapshot(nextSessionId);
        openSessionStream(nextSessionId);
    }

    async function refreshSessionSnapshot(sessionId: string): Promise<void> {
        if (!serverUrl || !sessionId) {
            return;
        }

        const currentToken = ++loadToken;
        isLoadingSession = true;
        connectionError = "";

        try {
            const nextStatus = await getStatus(serverUrl, sessionId);

            if (currentToken !== loadToken || activeSessionId !== sessionId) {
                return;
            }

            const [nextState, nextMessages] = await Promise.all([
                getState(serverUrl, sessionId),
                getMessages(serverUrl, sessionId),
            ]);

            if (currentToken !== loadToken || activeSessionId !== sessionId) {
                return;
            }

            status = nextStatus;
            isSending = nextStatus.turn_running === true;
            steeringQueue = parseSteeringQueue({
                items: nextStatus.steering_queue ?? [],
            });
            sessionState = nextState;
            messages = nextMessages.messages;
            activity = [];
            lastEventId = 0;

            if (nextStatus.turn_running === true) {
                try {
                    const eventLog = await getEventLog(serverUrl, sessionId);
                    if (
                        currentToken !== loadToken ||
                        activeSessionId !== sessionId
                    ) {
                        return;
                    }
                    if (eventLog.events.length > 0) {
                        messages = buildMessagesFromEventLog(eventLog.events);
                        activity = buildActivityFromEventLog(eventLog.events);
                        lastEventId = eventLog.events.at(-1)?.id ?? 0;
                    }
                } catch {
                    // Fall back to the stored message snapshot if event-log hydration fails.
                }
            }

            await scrollTranscriptToEnd();
        } catch (error) {
            if (currentToken !== loadToken) {
                return;
            }
            connectionError = toErrorMessage(error);
        } finally {
            if (currentToken === loadToken) {
                isLoadingSession = false;
            }
        }
    }

    function ensureSessionListed(sessionId: string): void {
        if (sessions.some((session) => session.id === sessionId)) {
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        sessions = [
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
            ...sessions,
        ];
    }

    function openSessionStream(sessionId: string): void {
        if (!serverUrl) {
            return;
        }

        const currentStreamToken = ++streamToken;
        stopEvents = openEventStream(
            serverUrl,
            sessionId,
            {
                onEvent: (event) => {
                    void handleAgentEvent(sessionId, currentStreamToken, event);
                },
                onError: (error) => {
                    if (!isCurrentStream(sessionId, currentStreamToken)) {
                        return;
                    }
                    connectionError = error.message;
                },
            },
            { lastEventId },
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
                lastEventId = parsed;
            }
        }

        const payload = parseJson(event.data);

        // Fast path: streaming text chunks — mutate messages directly
        if (event.event === "assistant_text" || event.event === "reasoning") {
            applyLiveEvent(event.event, payload);
            if (isCurrentStream(sessionId, currentStreamToken)) {
                await scrollTranscriptToEnd();
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
            sessionState = payload.state as ChumpState;
            patchActiveSession(payload.state as ChumpState);
        }

        if (event.event === "agent_status" && payload) {
            status = payload as ChumpStatus;
            return;
        }

        if (event.event === "turn_status" && payload) {
            isSending = payload.running === true;
            if (Array.isArray(payload.steering_queue)) {
                steeringQueue = parseSteeringQueue({
                    items: payload.steering_queue,
                });
            }
            if (!isSending) {
                // Replace live messages with canonical server state
                void refreshMessages(sessionId, currentStreamToken);
                void refreshSessionsList();
            }
            return;
        }

        if (event.event === "steering_queue" && payload) {
            steeringQueue = parseSteeringQueue(payload);
            return;
        }

        const nextItem = formatActivityItem(
            event.id ? Number(event.id) : 0,
            event.event,
            payload,
        );
        if (nextItem) {
            activity = trimTail([...activity, nextItem], 80);
        }

        applyLiveEvent(event.event, payload);

        if (event.event === "user_message") {
            if (isCurrentStream(sessionId, currentStreamToken)) {
                await scrollTranscriptToEnd();
            }
        }
    }

    async function refreshMessages(
        sessionId: string,
        currentStreamToken: number,
    ): Promise<void> {
        if (!serverUrl) return;
        try {
            const response = await getMessages(serverUrl, sessionId);
            if (!isCurrentStream(sessionId, currentStreamToken)) return;
            messages = response.messages;
        } catch {
            // Non-fatal: live messages are still displayed
        }
    }

    async function submitPrompt(): Promise<void> {
        const text =
            composerText.trim() || (composerAttachments.length > 0 ? " " : "");
        if ((!text && composerAttachments.length === 0) || !serverUrl) {
            return;
        }

        const attachments = composerAttachments;
        const sessionId = await ensureActiveSession();
        if (!sessionId) {
            return;
        }

        composerText = "";
        composerAttachments = [];
        if (isSending) {
            try {
                const result = await steerCurrentTurn(
                    serverUrl,
                    sessionId,
                    text || "See attached image.",
                    attachments,
                );
                actionNotice = result.status;
            } catch (error) {
                composerText = text;
                connectionError = toErrorMessage(error);
            }
            return;
        }

        isSending = true;
        actionNotice = "";
        activeRequestController = new AbortController();

        try {
            await streamChat(
                serverUrl,
                sessionId,
                text || "See attached image.",
                attachments,
                activeRequestController.signal,
            );
        } catch (error) {
            if (!activeRequestController.signal.aborted) {
                connectionError = toErrorMessage(error);
            }
        } finally {
            if (!activeRequestController.signal.aborted) {
                isSending = false;
            }
            activeRequestController = null;
        }
    }

    async function deleteSteering(index: number): Promise<void> {
        if (!serverUrl || !activeSessionId) {
            return;
        }

        try {
            await cancelSteering(serverUrl, activeSessionId, index);
        } catch (error) {
            connectionError = toErrorMessage(error);
        }
    }

    async function editSteering(index: number): Promise<void> {
        const item = steeringQueue[index];
        if (!item) {
            return;
        }

        composerText = item.content;
        await deleteSteering(index);
    }

    async function abortTurn(): Promise<void> {
        if (!serverUrl || !activeSessionId) {
            return;
        }

        try {
            activeRequestController?.abort();
            const result = await abortCurrentTurn(serverUrl, activeSessionId);
            actionNotice = result.status;
        } catch (error) {
            connectionError = toErrorMessage(error);
        }
    }

    async function openTypedSession(): Promise<void> {
        const nextSessionId = sessionInput.trim();
        if (!nextSessionId) {
            return;
        }

        if (!health && serverUrl) {
            await connectToServer({ selectFirstSession: false });
        }

        await selectSession(nextSessionId);
    }

    async function createFreshSession(): Promise<void> {
        if (!health && serverUrl) {
            await connectToServer({ selectFirstSession: false });
        }

        if (!health) {
            return;
        }

        const newSessionId = createSessionId(health.workspace_root);
        ensureSessionListed(newSessionId);
        await selectSession(newSessionId);
    }

    async function ensureActiveSession(): Promise<string | null> {
        if (activeSessionId.trim()) {
            return activeSessionId.trim();
        }

        if (!health) {
            await connectToServer({ selectFirstSession: false });
        }

        if (!health) {
            return null;
        }

        const newSessionId = createSessionId(health.workspace_root);
        ensureSessionListed(newSessionId);
        await selectSession(newSessionId);
        return newSessionId;
    }

    function clearSessionView(): void {
        stopEvents?.();
        stopEvents = null;
        streamToken += 1;
        status = null;
        sessionState = null;
        messages = [];
        activity = [];
        lastEventId = 0;
        if (!sessions.some((session) => session.id === activeSessionId)) {
            activeSessionId = "";
        }
    }

    function isCurrentStream(
        sessionId: string,
        currentStreamToken: number,
    ): boolean {
        return (
            activeSessionId === sessionId && streamToken === currentStreamToken
        );
    }

    function handleComposerKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submitPrompt();
        }
    }

    async function handleCommand(command: string, args: string): Promise<void> {
        if (command === "__open_model_picker") {
            openModelPicker();
            return;
        }

        if (!serverUrl || !activeSessionId) {
            pushToast("Not connected", "error");
            return;
        }

        try {
            switch (command) {
                case "model": {
                    const separator = args.indexOf("/");
                    if (separator <= 0 || separator === args.length - 1) {
                        pushToast("Usage: model provider/model", "error");
                        return;
                    }
                    const provider = args.slice(0, separator);
                    const model = args.slice(separator + 1);
                    const result = await setModel(
                        serverUrl,
                        activeSessionId,
                        provider,
                        model,
                    );
                    status = result;
                    closeModelPicker();
                    pushToast(`Switched to ${provider}/${model}`, "success");
                    break;
                }
                case "thinking": {
                    if (!["none", "low", "high", "xhigh"].includes(args)) {
                        pushToast(
                            "Usage: thinking none|low|high|xhigh",
                            "error",
                        );
                        return;
                    }
                    status = await setReasoning(
                        serverUrl,
                        activeSessionId,
                        args,
                    );
                    pushToast(`Thinking set to ${args}`, "success");
                    break;
                }
                case "clear": {
                    const result = await clearMessages(
                        serverUrl,
                        activeSessionId,
                    );
                    await refreshSessionSnapshot(activeSessionId);
                    pushToast("Chat cleared", "success");
                    break;
                }
                case "new": {
                    await createFreshSession();
                    pushToast("New session started", "success");
                    break;
                }
            }
        } catch (error) {
            pushToast(toErrorMessage(error), "error");
        }
    }

    async function scrollTranscriptToEnd(): Promise<void> {
        await tick();
        transcriptElement?.scrollTo({
            top: transcriptElement.scrollHeight,
            behavior: "smooth",
        });
    }

    function parseSteeringQueue(payload: Record<string, unknown>): Array<{
        content: string;
        attachments?: Array<Record<string, unknown>>;
    }> {
        const items = Array.isArray(payload.items) ? payload.items : [];
        return items
            .filter((item): item is Record<string, unknown> =>
                Boolean(item && typeof item === "object"),
            )
            .map((item) => ({
                content: asString(item.content),
                attachments: Array.isArray(item.attachments)
                    ? item.attachments.filter(
                          (attachment): attachment is Record<string, unknown> =>
                              Boolean(
                                  attachment && typeof attachment === "object",
                              ),
                      )
                    : [],
            }))
            .filter(
                (item) =>
                    item.content.trim() || (item.attachments?.length ?? 0) > 0,
            );
    }

    function applyLiveEvent(
        type: string,
        data: Record<string, unknown> | null,
    ): void {
        messages = applyLiveEventToMessages(messages, type, data);
    }

    function applyLiveEventToMessages(
        source: StoredMessage[],
        type: string,
        data: Record<string, unknown> | null,
    ): StoredMessage[] {
        if (!data) return source;
        const next = [...source];

        if (type === "user_message") {
            const text = asString(data.content);
            if (text) {
                next.push({ role: "user", content: text });
            }
            return next;
        }

        if (type === "reasoning") {
            const fragment = asString(data.text);
            if (!fragment) return next;
            const msg = getOrCreateLiveAssistantMessage(next);
            const parts = msg.content as MessagePart[];
            const last = parts.at(-1) as any;
            if (last?.type === "reasoning") {
                last.text = mergeReasoningText(last.text, fragment);
            } else {
                parts.push({ type: "reasoning", text: fragment });
            }
            return [...next];
        }

        if (type === "assistant_text") {
            const chunk = asString(data.content);
            if (!chunk) return next;
            const msg = getOrCreateLiveAssistantMessage(next);
            const parts = msg.content as MessagePart[];
            const last = parts.at(-1) as any;
            if (last?.type === "text") {
                last.text += chunk;
            } else {
                parts.push({ type: "text", text: chunk });
            }
            return [...next];
        }

        if (type === "tool_call") {
            const toolName =
                asString(data.name) || asString(data.tool) || "tool";
            const args = asArgsRecord(
                data.args ?? data.payload ?? data.arguments ?? {},
            );
            const id =
                asString(data.id) ||
                asString(data.tool_call_id) ||
                `live-${Date.now()}`;
            const msg = getOrCreateLiveAssistantMessage(next);
            (msg.content as MessagePart[]).push({
                type: "tool_call",
                tool_call: { id, name: toolName, arguments: args ?? {} },
            });
            return [...next];
        }

        if (type === "tool_result") {
            const toolName =
                asString(data.name) ||
                asString(data.tool) ||
                asString(data.tool_name) ||
                "tool";
            const toolCallId =
                asString(data.tool_call_id) || asString(data.id) || "";
            const result = data.result ?? data.output ?? data.preview ?? "";
            const isError =
                data.ok === false ||
                data.status === "error" ||
                data.is_error === true;
            const metadata = asRecord(data.metadata);
            next.push({
                role: "tool",
                content: [
                    {
                        type: "tool_result",
                        tool_result: {
                            tool_call_id: toolCallId,
                            tool_name: toolName,
                            result,
                            is_error: isError,
                            metadata: metadata ?? undefined,
                        },
                    },
                ],
            });
        }
        return next;
    }

    function buildMessagesFromEventLog(
        events: Array<{
            id: number;
            type: string;
            data: Record<string, unknown>;
        }>,
    ): StoredMessage[] {
        let next: StoredMessage[] = [];
        for (const event of events) {
            next = applyLiveEventToMessages(next, event.type, event.data);
        }
        return next;
    }

    function buildActivityFromEventLog(
        events: Array<{
            id: number;
            type: string;
            data: Record<string, unknown>;
        }>,
    ): ActivityItem[] {
        const items: ActivityItem[] = [];
        for (const event of events) {
            const item = formatActivityItem(event.id, event.type, event.data);
            if (item) {
                items.push(item);
            }
        }
        return trimTail(items, 80);
    }

    function getOrCreateLiveAssistantMessage(
        source: StoredMessage[],
    ): StoredMessage & { live: true } {
        const last = source.at(-1) as
            | (StoredMessage & { live?: boolean })
            | undefined;
        if (last?.live && last.role === "assistant") {
            return last as StoredMessage & { live: true };
        }
        const msg = {
            role: "assistant",
            content: [] as MessagePart[],
            live: true as const,
        };
        source.push(msg);
        return msg;
    }

    function parseJson(value: string): Record<string, unknown> | null {
        try {
            const parsed = JSON.parse(value) as unknown;
            return parsed && typeof parsed === "object"
                ? (parsed as Record<string, unknown>)
                : null;
        } catch {
            return null;
        }
    }

    function asString(value: unknown): string {
        return typeof value === "string" ? value : "";
    }

    function asRecord(value: unknown): Record<string, unknown> | null {
        return value && typeof value === "object"
            ? (value as Record<string, unknown>)
            : null;
    }

    function asArgsRecord(value: unknown): Record<string, unknown> {
        const direct = asRecord(value);
        if (direct) {
            return direct;
        }

        if (typeof value === "string") {
            const parsed = parseJson(value);
            if (parsed) {
                return parsed;
            }
        }

        return {};
    }

    function toErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    function buildTranscript(source: StoredMessage[]): TranscriptMessage[] {
        const items: TranscriptMessage[] = [];

        for (let i = 0; i < source.length; i++) {
            const message = source[i];

            // Assistant messages: split reasoning parts out as separate items
            if (
                message.role === "assistant" &&
                Array.isArray(message.content)
            ) {
                let reasoningBuf = "";
                const nonReasoningBlocks: TranscriptBlock[] = [];

                for (const part of message.content as MessagePart[]) {
                    const candidate = part as Record<string, unknown>;
                    if (candidate.type === "reasoning") {
                        const fragment = asString(candidate.text);
                        if (fragment) {
                            reasoningBuf = mergeReasoningText(
                                reasoningBuf,
                                fragment,
                            );
                        }
                        continue;
                    }
                    // Flush accumulated reasoning before a non-reasoning part
                    if (reasoningBuf) {
                        const text = cleanReasoningText(reasoningBuf);
                        if (text) {
                            items.push({
                                id: `${i}-reasoning-${items.length}`,
                                role: "reasoning",
                                label: "Reasoning",
                                blocks: [{ kind: "reasoning", text }],
                                live: (message as any).live,
                            });
                        }
                        reasoningBuf = "";
                    }
                    const block = formatPartBlock(part);
                    if (block) nonReasoningBlocks.push(block);
                }

                // Flush any trailing reasoning (reasoning-only assistant message)
                if (reasoningBuf) {
                    const text = cleanReasoningText(reasoningBuf);
                    if (text) {
                        items.push({
                            id: `${i}-reasoning-${items.length}`,
                            role: "reasoning",
                            label: "Reasoning",
                            blocks: [{ kind: "reasoning", text }],
                            live: (message as any).live,
                        });
                    }
                }

                if (nonReasoningBlocks.length > 0) {
                    items.push({
                        id: `${i}-assistant`,
                        role: "assistant",
                        label: "Assistant",
                        blocks: nonReasoningBlocks,
                        live: (message as any).live,
                    });
                }
                continue;
            }

            let blocks = formatMessageBlocks(message.content);

            if (message.role === "tool" || message.role === "user") {
                let allMerged = true;
                for (const block of blocks) {
                    if (block.kind === "tool-result") {
                        let found = false;
                        for (const item of items) {
                            for (const parentBlock of item.blocks) {
                                if (block.toolCallId) {
                                    if (
                                        parentBlock.kind === "tool-call" &&
                                        parentBlock.toolCallId ===
                                            block.toolCallId
                                    ) {
                                        parentBlock.result = block.result;
                                        parentBlock.error = block.error;
                                        if (block.metadata) {
                                            parentBlock.metadata =
                                                block.metadata;
                                            parentBlock.isDiff =
                                                parentBlock.isDiff ||
                                                hasDiffMetadata(block.metadata);
                                        }
                                        parentBlock.hasResult = true;
                                        found = true;
                                        break;
                                    }
                                } else if (
                                    parentBlock.kind === "tool-call" &&
                                    !parentBlock.hasResult &&
                                    parentBlock.originalToolName ===
                                        block.originalToolName
                                ) {
                                    parentBlock.result = block.result;
                                    parentBlock.error = block.error;
                                    if (block.metadata) {
                                        parentBlock.metadata = block.metadata;
                                        parentBlock.isDiff =
                                            parentBlock.isDiff ||
                                            hasDiffMetadata(block.metadata);
                                    }
                                    parentBlock.hasResult = true;
                                    found = true;
                                    break;
                                }
                            }
                            if (found) break;
                        }
                        if (!found) allMerged = false;
                        else block.hasResult = true;
                    } else {
                        allMerged = false;
                    }
                }

                blocks = blocks.filter((b) => !b.hasResult);
                if (blocks.length === 0 && allMerged) continue;
            }

            items.push({
                id: `${i}-${message.role}`,
                role: message.role,
                label: formatRole(message.role),
                blocks,
                live: (message as any).live,
            });
        }

        return items;
    }

    function mergeReasoningText(existing: string, incoming: string): string {
        const normalized = normalizeReasoningChunk(
            incoming,
            existing.length === 0,
        );
        if (!normalized.trim()) {
            return existing;
        }
        const appended = appendNovelSuffix(existing, normalized);
        if (!appended) {
            return existing;
        }
        return existing + appended;
    }

    function normalizeReasoningChunk(
        value: string,
        trimStart: boolean,
    ): string {
        const normalized = value
            .replace(/\r\n?/g, "\n")
            .replace(/[^\S\n]+/g, " ")
            .replace(/ *\n */g, "\n");
        return trimStart ? normalized.trimStart() : normalized;
    }

    function appendNovelSuffix(existing: string, incoming: string): string {
        if (!incoming) return "";
        if (!existing) return incoming;
        if (existing.endsWith(incoming)) return "";
        if (incoming.startsWith(existing))
            return incoming.slice(existing.length);

        const tail = existing.slice(
            -Math.min(existing.length, incoming.length, 1024),
        );
        const maxOverlap = Math.min(tail.length, incoming.length);
        for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
            if (tail.slice(-overlap) === incoming.slice(0, overlap)) {
                return incoming.slice(overlap);
            }
        }
        return incoming;
    }

    function cleanReasoningText(value: string): string {
        const normalized = value
            .replace(/\r\n?/g, "\n")
            .replace(/[^\S\n]+/g, " ")
            .replace(/ *\n */g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        if (!normalized) return "";

        return normalized
            .split("\n")
            .map((line) => dedupeAdjacentWords(line))
            .join("\n");
    }

    function dedupeAdjacentWords(value: string): string {
        const words = value.split(" ");
        const cleaned: string[] = [];
        for (const word of words) {
            const previous = cleaned[cleaned.length - 1];
            if (previous && stripWord(previous) === stripWord(word)) {
                continue;
            }
            cleaned.push(word);
        }
        return cleaned.join(" ");
    }

    function stripWord(value: string): string {
        return value.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, "");
    }

    function reasoningSummary(text: string): string {
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        const seconds = Math.max(1, Math.round(words / 35));
        return `Thought for ${seconds} second${seconds === 1 ? "" : "s"}`;
    }

    function formatPartBlock(part: MessagePart): TranscriptBlock | null {
        const candidate = part as Record<string, unknown>;
        const kind = typeof candidate.type === "string" ? candidate.type : "";

        if (kind === "text") {
            return { kind: "text", text: asString(candidate.text) };
        }
        if (kind === "tool_call") {
            const toolCall = asRecord(candidate.tool_call);
            const args = asArgsRecord(toolCall?.arguments ?? {});
            const toolName = asString(toolCall?.name) || "tool";
            let isDiff = false;
            let diffContent = "";
            let headerTitle = toolName;

            if (toolName === "bash" || toolName === "execute_command") {
                const cmd =
                    asString(args?.command) || asString(args?.cmd) || "";
                if (cmd) headerTitle = `$ ${cmd}`;
            } else if (toolName === "read_file" || toolName === "view_file") {
                const file =
                    asString(args?.file_path) || asString(args?.path) || "";
                if (file) headerTitle = file.split("/").pop() || file;
            } else if (
                toolName === "edit_file" ||
                toolName === "apply_patch" ||
                toolName === "write_file" ||
                toolName === "create_file"
            ) {
                const file =
                    asString(args?.file_path) || asString(args?.path) || "";
                if (file) headerTitle = file.split("/").pop() || file;
            } else if (toolName === "skill" || toolName === "load_skill") {
                const name = asString(args?.name) || "";
                if (name) headerTitle = `Skill ${name}`;
            }

            if (
                args &&
                (typeof args.patch === "string" ||
                    typeof args.patchText === "string" ||
                    typeof args.patch_text === "string" ||
                    typeof args.diff === "string" ||
                    typeof args.file_diff === "string")
            ) {
                isDiff = true;
                diffContent = (args.patch ||
                    args.patchText ||
                    args.patch_text ||
                    args.diff ||
                    args.file_diff) as string;
            } else if (
                args &&
                typeof args.content === "string" &&
                (toolName === "write_file" || toolName === "create_file")
            ) {
                isDiff = true;
                diffContent =
                    `+++ ${headerTitle}\n@@ -0,0 +1 @@\n` +
                    args.content
                        .split("\n")
                        .map((l) => `+${l}`)
                        .join("\n");
            }

            return {
                kind: "tool-call",
                text: `${toolName}\n${stringifyValue(args)}`,
                toolCallId: asString(toolCall?.id),
                toolName: headerTitle,
                originalToolName: toolName,
                args: args ?? undefined,
                isDiff,
                diffContent,
            };
        }
        if (kind === "tool_result") {
            const toolResult = asRecord(candidate.tool_result);
            return {
                kind: "tool-result",
                toolCallId: asString(toolResult?.tool_call_id),
                text: stringifyValue(toolResult?.result),
                error: toolResult?.is_error === true,
                result: toolResult?.result,
                metadata: asRecord(toolResult?.metadata) ?? undefined,
                toolName: asString(toolResult?.tool_name) || "tool",
                originalToolName: asString(toolResult?.tool_name) || "tool",
            };
        }
        if (kind === "image") {
            const mediaType = asString(candidate.media_type);
            return {
                kind: "image",
                text: mediaType ? `image · ${mediaType}` : "image",
            };
        }
        return { kind: "text", text: stringifyValue(part) };
    }

    function formatMessageBlocks(
        content: StoredMessage["content"],
    ): TranscriptBlock[] {
        if (typeof content === "string") {
            return [{ kind: "text", text: content }];
        }

        const blocks: TranscriptBlock[] = [];
        for (const part of content as MessagePart[]) {
            const candidate = part as Record<string, unknown>;
            const kind =
                typeof candidate.type === "string" ? candidate.type : "";

            if (kind === "text") {
                blocks.push({ kind: "text", text: asString(candidate.text) });
                continue;
            }
            if (kind === "tool_call") {
                const toolCall = asRecord(candidate.tool_call);
                const args = asArgsRecord(toolCall?.arguments ?? {});
                const toolName = asString(toolCall?.name) || "tool";

                let isDiff = false;
                let diffContent = "";
                let headerTitle = toolName;

                if (toolName === "bash" || toolName === "execute_command") {
                    const cmd =
                        asString(args?.command) || asString(args?.cmd) || "";
                    if (cmd) headerTitle = `$ ${cmd}`;
                } else if (
                    toolName === "read_file" ||
                    toolName === "view_file"
                ) {
                    const file =
                        asString(args?.file_path) || asString(args?.path) || "";
                    if (file) headerTitle = file.split("/").pop() || file;
                } else if (
                    toolName === "edit_file" ||
                    toolName === "apply_patch" ||
                    toolName === "write_file" ||
                    toolName === "create_file"
                ) {
                    const file =
                        asString(args?.file_path) || asString(args?.path) || "";
                    if (file) headerTitle = file.split("/").pop() || file;
                } else if (toolName === "skill" || toolName === "load_skill") {
                    const name = asString(args?.name) || "";
                    if (name) headerTitle = `Skill ${name}`;
                }

                if (
                    args &&
                    (typeof args.patch === "string" ||
                        typeof args.patchText === "string" ||
                        typeof args.patch_text === "string" ||
                        typeof args.diff === "string" ||
                        typeof args.file_diff === "string")
                ) {
                    isDiff = true;
                    diffContent = (args.patch ||
                        args.patchText ||
                        args.patch_text ||
                        args.diff ||
                        args.file_diff) as string;
                } else if (
                    args &&
                    typeof args.content === "string" &&
                    (toolName === "write_file" || toolName === "create_file")
                ) {
                    isDiff = true;
                    diffContent =
                        `+++ ${headerTitle}\n@@ -0,0 +1 @@\n` +
                        args.content
                            .split("\n")
                            .map((l) => `+${l}`)
                            .join("\n");
                }

                blocks.push({
                    kind: "tool-call",
                    text: `${toolName}\n${stringifyValue(args)}`,
                    toolCallId: asString(toolCall?.id),
                    toolName: headerTitle,
                    originalToolName: toolName,
                    args: args ?? undefined,
                    isDiff,
                    diffContent,
                });
                continue;
            }
            if (kind === "tool_result") {
                const toolResult = asRecord(candidate.tool_result);
                const toolName = asString(toolResult?.tool_name) || "tool";
                blocks.push({
                    kind: "tool-result",
                    toolCallId: asString(toolResult?.tool_call_id),
                    text: stringifyValue(toolResult?.result),
                    error: toolResult?.is_error === true,
                    result: toolResult?.result,
                    metadata: asRecord(toolResult?.metadata) ?? undefined,
                    toolName,
                    originalToolName: toolName,
                });
                continue;
            }
            if (kind === "image") {
                const mediaType = asString(candidate.media_type);
                blocks.push({
                    kind: "image",
                    text: mediaType ? `image · ${mediaType}` : "image",
                });
                continue;
            }
            blocks.push({ kind: "text", text: stringifyValue(part) });
        }

        return blocks.length > 0 ? blocks : [{ kind: "text", text: "" }];
    }

    function formatActivityItem(
        id: number,
        type: string,
        payload: Record<string, unknown> | null,
    ): ActivityItem | null {
        if (!payload) {
            return null;
        }

        if (type === "user_message") {
            const content = asString(payload.content);
            return {
                id: `${id}`,
                label: payload.steered === true ? "Steer" : "User",
                detail: content || "message",
                tone: "default",
            };
        }

        if (type === "tool_call") {
            const name =
                asString(payload.name) || asString(payload.tool) || "tool";
            const detail = stringifyValue(
                payload.args ?? payload.payload ?? {},
            );
            return {
                id: `${id}`,
                label: `Tool · ${name}`,
                detail,
                tone: "default",
            };
        }

        if (type === "tool_result") {
            const name =
                asString(payload.tool_name) || asString(payload.tool) || "tool";
            const detail = stringifyValue(
                payload.preview ??
                    payload.error ??
                    payload.result ??
                    payload.output ??
                    "done",
            );
            const isError =
                payload.is_error === true ||
                payload.ok === false ||
                payload.status === "error";
            return {
                id: `${id}`,
                label: `Result · ${name}`,
                detail,
                tone: isError ? "error" : "muted",
            };
        }

        if (type === "status") {
            const phase = asString(payload.phase) || "status";
            const step = payload.step;
            return {
                id: `${id}`,
                label: "Status",
                detail:
                    typeof step === "number"
                        ? `${phase} · step ${step}`
                        : phase,
                tone: "muted",
            };
        }

        return null;
    }

    function hasDiffMetadata(
        metadata: Record<string, unknown> | undefined,
    ): boolean {
        if (!metadata) return false;
        if (Array.isArray(metadata.files) && metadata.files.length > 0) {
            return true;
        }
        return Boolean(metadata.diff && typeof metadata.diff === "object");
    }

    function formatRole(role: string): string {
        if (role === "assistant") {
            return "Assistant";
        }
        if (role === "user") {
            return "You";
        }
        if (role === "tool") {
            return "Tool";
        }
        return role.charAt(0).toUpperCase() + role.slice(1);
    }

    function formatDate(value: number | null): string {
        if (!value) {
            return "—";
        }
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        }).format(value * 1000);
    }

    function stringifyValue(value: unknown): string {
        if (typeof value === "string") {
            return value;
        }
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }

    function trimTail<T>(items: T[], size: number): T[] {
        return items.length <= size ? items : items.slice(items.length - size);
    }

    function reversedTail<T>(items: T[], size: number): T[] {
        return trimTail(items, size).slice().reverse();
    }
</script>

<svelte:head>
    <title>chump web</title>
</svelte:head>

<div
    class="flex h-[100dvh] bg-bg-surface text-text-main font-sans overflow-hidden selection:bg-accent-bg selection:text-text-inverse relative"
    use:swipeable
>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-20 bg-black/10"
        style:opacity={sidebarProgress}
        style:backdrop-filter="blur({sidebarProgress * 1}px)"
        style:pointer-events={sidebarOpen || sidebarProgress > 0 ? "auto" : "none"}
        class:transition-all={!isDraggingSidebar}
        class:duration-200={!isDraggingSidebar}
        onclick={closeSidebar}
    ></div>

    <SessionsSidebar
        {sessions}
        {activeSessionId}
        bind:sessionInput
        {health}
        {serverUrl}
        {isConnecting}
        {canConnect}
        onCreateSession={() => void createFreshSession()}
        onOpenSession={() => void openTypedSession()}
        onSelectSession={(id) => {
            closeSidebar();
            void selectSession(id);
        }}
        onOpenConnectModal={openConnectModal}
        onConnect={() => void connectToServer()}
        {sessionTitle}
        {formatDate}
        open={sidebarOpen}
        {dragOffset}
        isDragging={isDraggingSidebar}
    />

    <!-- Center: Chat/Editor Area -->
    <main
        class="flex-1 flex flex-col bg-bg-surface relative min-w-0 h-[100dvh]"
        class:transition-all={!isDraggingSidebar}
        class:duration-200={!isDraggingSidebar}
        class:ease-out={!isDraggingSidebar}
        style:transform="translateX({sidebarProgress * 40}px)"
        style:overflow={sidebarProgress > 0 ? "hidden" : ""}
        style:border-radius="{sidebarProgress * 12}px"
        style:box-shadow={sidebarProgress > 0 ? "0 0 0 1px var(--border-subtle)" : ""}
    >
        <!-- Top Fade overlay for scrolling under floating header -->
        <div
            class="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-bg-surface via-bg-surface/80 to-transparent z-10 pointer-events-none"
        ></div>

        <!-- Header Controls -->
        <div
            class="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-3 md:p-4 pointer-events-none select-none"
        >
            <button
                class="icon-button pointer-events-auto h-8 w-8"
                onclick={toggleSidebar}
                aria-label="Toggle sidebar"
            >
                <svg
                    class="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 6h16M4 12h16M4 18h16"
                    ></path></svg
                >
            </button>
            <div class="flex items-center gap-2 pointer-events-none">
                <button
                    aria-label="Create new session"
                    class="icon-button pointer-events-auto h-8 w-8"
                    onclick={() => void createFreshSession()}
                >
                    <svg
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="1.5"
                            d="M12 4v16m8-8H4"
                        ></path></svg
                    >
                </button>
            </div>
        </div>

        <TranscriptPane
            {transcript}
            bind:transcriptElement
            {isSending}
            {isConnecting}
            {expandedBlocks}
            {expandedReasoning}
            onToggleBlock={toggleBlock}
            onToggleReasoning={toggleReasoning}
            {reasoningSummary}
            {health}
            {activeSessionId}
            onOpenConnectModal={openConnectModal}
        />

        {#if health}
            <ChatComposer
                bind:composerText
                bind:composerAttachments
                {activeSessionId}
                {canSend}
                {isSending}
                models={availableModels}
                {currentModel}
                {currentProvider}
                workspaceRoot={displayWorkspace}
                gitBranch={currentGitBranch}
                {reasoningInfo}
                {contextUsageLabel}
                {steeringQueue}
                onSend={() => void submitPrompt()}
                onDeleteSteering={(index) => void deleteSteering(index)}
                onEditSteering={(index) => void editSteering(index)}
                onCommand={handleCommand}
                onAbort={() => void abortTurn()}
                onScrollToBottom={!isAtBottom
                    ? () => void scrollTranscriptToEnd()
                    : undefined}
            />
        {/if}
    </main>

    <!-- Workspace State Sidebar -->
    {#if sessionState}
        <WorkspaceState state={sessionState} {sidebarOpen} />
    {/if}
</div>

{#if connectModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay/60 backdrop-blur-[2px] p-4 w-full h-full border-none cursor-default"
        transition:fade={{ duration: 150 }} onclick={closeConnectModal}
    >
        <div
            class="flex w-full max-w-[300px] flex-col overflow-hidden rounded-lg border border-border-default bg-bg-surface shadow-2xl"
            transition:fly={{ y: 8, duration: 150 }}
            onclick={(e) => e.stopPropagation()}
        >
            <div class="p-1.5 space-y-1.5">
                <div class="flex flex-col gap-1.5" role="dialog" aria-label="Connect to server">
                    <div class="flex bg-bg-input rounded-md border border-border-default focus-within:border-accent/40 transition-colors items-center pr-1">
                        <label for="server-url-input" class="sr-only">Server URL</label>
                        <input
                            bind:this={connectUrlInput}
                            id="server-url-input"
                            bind:value={serverUrl}
                            placeholder="http://..."
                            onkeydown={(e) =>
                                e.key === "Enter" &&
                                canConnect &&
                                !isConnecting &&
                                (void connectToServer())}
                            class="w-full bg-transparent border-none px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-muted focus:outline-none"
                            autocomplete="off"
                        />
                        <button
                            onclick={() => {
                                void connectToServer();
                            }}
                            disabled={!canConnect || isConnecting}
                            class="bg-accent text-text-on-accent h-6 px-2.5 rounded-sm text-[11px] font-bold transition-all active:scale-[0.95] disabled:opacity-70 flex items-center justify-center min-w-[60px]"
                        >
                            {#if isConnecting}
                                <span class="flex items-center gap-1.5" aria-live="polite">
                                    <span class="font-mono text-[14px]" aria-hidden="true"
                                        >{spinnerFrames[spinnerFrame]}</span
                                    >
                                </span>
                            {:else}
                                Connect
                            {/if}
                        </button>
                    </div>
                    
                    <button
                        onclick={() => void startQrScanner()}
                        class="flex items-center justify-center gap-2 w-full py-1.5 rounded-md bg-bg-elevated border border-border-subtle hover:bg-bg-hover transition-colors text-text-secondary group active:scale-[0.98]"
                    >
                        <svg class="w-4 h-4 text-text-tertiary group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 7V5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
                            <rect x="7" y="7" width="3" height="3" rx="0.5" />
                            <rect x="14" y="7" width="3" height="3" rx="0.5" />
                            <rect x="7" y="14" width="3" height="3" rx="0.5" />
                            <rect x="14" y="14" width="1" height="1" />
                            <rect x="16" y="16" width="1" height="1" />
                            <rect x="14" y="16" width="1" height="1" />
                            <rect x="16" y="14" width="1" height="1" />
                        </svg>
                        <span class="text-[12px] font-medium">Scan QR Code</span>
                    </button>
                </div>

                {#if qrScannerOpen}
                    <div class="relative overflow-hidden rounded-md border border-border-default bg-black aspect-square shadow-inner">
                        <video
                            bind:this={qrVideoElement}
                            class="w-full h-full object-cover"
                            playsinline
                            muted
                        ></video>
                        <button 
                            aria-label="Close QR scanner"
                            onclick={stopQrScanner}
                            class="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-black/60 text-white rounded-full backdrop-blur-md"
                        >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="Close scanner">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                 {/if}

                {#if connectionError || qrScannerError}
                    <div class="text-[10px] text-error px-2 py-1.5 flex items-start gap-1.5 bg-error/5 rounded-md border border-error/10">
                        <svg class="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {connectionError || qrScannerError}
                    </div>
                {/if}
            </div>
        </div>
    </div>
 {/if}

<Toasts bind:toasts />

<!-- Model Picker Modal -->
{#if modelPickerOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-bg-overlay/60 backdrop-blur-[2px] w-full h-full border-none cursor-default"
        transition:fade={{ duration: 150 }} onclick={closeModelPicker}
    >
        <div
            class="flex max-h-[65vh] w-full flex-col overflow-hidden rounded-t-2xl border-x border-t border-border-subtle bg-bg-elevated md:max-w-md md:rounded-[12px] md:border"
            transition:fly={{ y: 200, duration: 250, opacity: 1 }}
            onclick={(e) => e.stopPropagation()}
        >
            <div class="md:hidden flex justify-center pt-3 pb-1">
                <div class="w-12 h-1.5 bg-text-tertiary/20 rounded-full" aria-hidden="true"></div>
            </div>
            <div
                class="flex items-center justify-between px-4 py-3 border-b border-border-default"
            >
                <span class="text-[14px] font-medium text-text-secondary"
                    >Switch Model</span
                >
                <button
                    class="button-tertiary px-1.5 py-1 text-text-tertiary"
                    onclick={closeModelPicker}
                    aria-label="Close"
                >
                    <svg
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M6 18L18 6M6 6l12 12"
                        ></path></svg
                    >
                </button>
            </div>
            <div
                class="px-3 py-3 border-b border-border-default bg-bg-elevated"
            >
                <label for="model-search-input" class="sr-only">Search models</label>
                <input
                    bind:this={modelSearchInput}
                    type="text"
                    id="model-search-input"
                    bind:value={modelSearchQuery}
                    placeholder="Search models..."
                    class="w-full rounded-[9px] border border-border-subtle bg-bg-surface px-3 py-2 text-[14px] text-text-secondary placeholder:text-text-tertiary transition-all focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/20"
                    autocomplete="off"
                />
            </div>
            <div class="overflow-y-auto py-1 bg-bg-elevated" role="listbox" aria-label="Available models">
                {#each groupedModels as {provider, models}}
                    <div class="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated/80 backdrop-blur-sm sticky top-0 z-10 border-b border-border-subtle/30">
                        {provider.replace(/_/g, ' ')}
                    </div>
                    {#each models as m (m.label)}
                        <button
                            role="option"
                            aria-selected={m.label === currentModel}
                            onclick={() => {
                                void handleCommand(
                                    "model",
                                    `${m.provider}/${m.model}`,
                                );
                                closeModelPicker();
                            }}
                            class="group flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5"
                            type="button"
                        >
                            <div class="flex flex-col min-w-0 pr-4">
                                <span class="text-[13.5px] font-medium {m.label === currentModel ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'} transition-colors"
                                    >{m.name || shortenModel(m.model)}</span
                                >
                                {#if m.description}
                                    <div class="flex items-center gap-2 mt-0.5">
                                        <span class="text-[12px] text-text-tertiary truncate"
                                            >{m.description}</span
                                        >
                                    </div>
                                {/if}
                            </div>
                            {#if m.label === currentModel}
                                <div class="flex items-center gap-2">
                                    <span class="flex-shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[#111111]"
                                        >Active</span
                                    >
                                    <svg class="w-4 h-4 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            {:else}
                                <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                                     <svg class="w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            {/if}
                        </button>
                    {/each}
                {:else}
                    <div
                        class="px-4 py-12 text-center"
                    >
                        <div class="text-[14px] text-text-secondary font-medium">No models found</div>
                        <div class="text-[12px] text-text-tertiary mt-1">Try a different search term</div>
                    </div>
                {/each}
            </div>
            <!-- Bottom safe area spacer for mobile -->
            <div class="h-6 md:hidden bg-bg-elevated"></div>
        </div>
    </div>
 {/if}

<style>
    /* VS Code inspired custom scrollbar */
    ::-webkit-scrollbar {
        width: 10px;
        height: 10px;
    }
    ::-webkit-scrollbar-track {
        background: transparent;
    }
    ::-webkit-scrollbar-thumb {
        background: var(--scroll-thumb);
        border: 2px solid transparent;
        background-clip: padding-box;
    }
    ::-webkit-scrollbar-thumb:hover {
        background: var(--scroll-thumb-hover);
        border: 2px solid transparent;
        background-clip: padding-box;
    }
</style>
