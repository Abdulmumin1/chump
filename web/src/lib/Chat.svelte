<script lang="ts">
    import { browser } from "$app/environment";
    import { onMount, tick } from "svelte";
    import { Pane, PaneGroup, PaneResizer } from "paneforge";
    import SessionsSidebar from "$lib/SessionsSidebar.svelte";
    import TranscriptPane from "$lib/TranscriptPane.svelte";
    import ChatComposer from "$lib/ChatComposer.svelte";
    import Toasts from "$lib/Toasts.svelte";
    import ChatTopBar from "$lib/chat/ChatTopBar.svelte";
    import { summarizeWorkspaceChanges } from "$lib/chump/workspace-changes";
    import ConnectServerModal from "$lib/chat/ConnectServerModal.svelte";
    import ModelPickerModal from "$lib/chat/ModelPickerModal.svelte";
    import CommandPalette from "$lib/chat/CommandPalette.svelte";
    import { sidebarSwipe, type SidebarSwipeState } from "$lib/chat/sidebar-swipe";
    import {
        shortenModel,
        shortenWorkspacePath,
        toErrorMessage,
    } from "$lib/chat/helpers";
    import { reasoningSummary, buildTranscript } from "$lib/chat/transcript";
    import {
        createQrScannerController,
        applyScannedConnectValue,
    } from "$lib/chat/qr-scanner";
    import {
        createSessionController,
        type SessionControllerState,
    } from "$lib/chat/session-controller";
    import type { ModelGroup, SteeringQueueItem } from "$lib/chat/types";
    import {
        abortCurrentTurn,
        cancelSteering,
        clearMessages,
        compactMessages,
        getHealth,
        getMessages,
        getSessions,
        loadSkill,
        normalizeServerUrl,
        setModel,
        setReasoning,
        sessionTitle,
        steerCurrentTurn,
        streamChat,
        terminalTargetIdentity,
        type ChumpApiTarget,
    } from "$lib/chump/api";
    import type {
        ChatAttachment,
        ChumpHealth,
        ChumpState,
        ChumpStatus,
        DelegatedSessionActivity,
        SessionSummary,
        StoredMessage,
    } from "$lib/chump/types";
    import {
        formatCtxLabel,
        type ModelChoice,
    } from "$lib/models";
    import {
        createLocalServiceProjectSession,
        listLocalServiceProjects,
        normalizeLocalServiceConnection,
        pickLocalServiceProjectDirectory,
        registerLocalServiceProject,
        type LocalServiceConnection,
        type LocalServiceProject,
    } from "$lib/chump/local-service-api";
    import {
        clearPendingLocalServiceHandoff,
        consumeLocalServiceHandoff,
        parsePendingLocalServiceHandoff,
        parsePendingLocalServiceHandoffEvent,
        PENDING_LOCAL_SERVICE_HANDOFF_EVENT,
        PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY,
        readPendingLocalServiceHandoff,
    } from "$lib/chump/local-service-handoff";
    import {
        readLocalServiceConnection,
        rememberLocalServiceConnection,
    } from "$lib/chump/local-service-connection-store";
    import {
        getLoopbackPermissionState,
        loopbackPermissionMessage,
    } from "$lib/chump/loopback-permission";
    import {
        readRecentProjectAccess,
        recordProjectAccess,
        sortProjectsByRecent,
        type ProjectAccessMap,
    } from "$lib/chump/recent-projects";

    let { data }: { data: any } = $props();
    const initialServerUrl = () => data?.initialServerUrl ?? "";
    const initialSessionId = () => data?.initialSessionId ?? "";

    let serverUrl = $state(initialServerUrl());
    let sessionInput = $state(initialSessionId());
    let activeSessionId = $state(initialSessionId());
    let health = $state<ChumpHealth | null>(null);
    let status = $state<ChumpStatus | null>(null);
    let sessionState = $state<ChumpState | null>(null);
    let workspacePane = $state<{
        collapse: () => void;
        expand: () => void;
    } | null>(null);
    let sessions = $state<SessionSummary[]>([]);
    let isWorkspaceCollapsed = $state(
        browser
            ? localStorage.getItem("workspace-panel-collapsed") === "true"
            : false,
    );
    let workspaceModalOpen = $state(false);
    let sessionPage = $state(1);
    let sessionTotalPages = $state(1);
    let sessionTotal = $state(0);
    let messages = $state<StoredMessage[]>([]);
    let steeringQueue = $state<SteeringQueueItem[]>([]);
    let composerText = $state("");
    let composerAttachments = $state<ChatAttachment[]>([]);
    let isConnecting = $state(false);
    let isSending = $state(false);
    let workingSessionIds = $state<string[]>([]);
    let delegatedActivities = $state<DelegatedSessionActivity[]>([]);
    let isCompacting = $state(false);
    let isLoadingSession = $state(false);
    let isSharing = $state(false);
    let connectionError = $state("");
    let transcriptElement = $state<HTMLDivElement | null>(null);
    let isAtBottom = $state(true);
    let transcriptScrollScheduled = false;
    let stopEvents: (() => void) | null = null;
    let lastEventId = 0;
    let loadToken = 0;
    let streamToken = 0;
    let activeRequest:
        | { sessionId: string; controller: AbortController }
        | null = null;
    let expandedBlocks = $state<Record<string, boolean>>({});
    let expandedReasoning = $state<Record<string, boolean>>({});
    let sidebarOpen = $state(false);
    let connectModalOpen = $state(false);
    let qrScannerOpen = $state(false);
    let qrScannerError = $state("");
    let qrVideoElement = $state<HTMLVideoElement | null>(null);
    let modelPickerOpen = $state(false);
    let projectPickerRequest = $state(0);
    let isDesktopViewport = $state(false);
    let toasts = $state<
        Array<{
            id: number;
            message: string;
            type?: "default" | "success" | "error";
        }>
    >([]);
    let toastId = 0;

    const workspaceChangesSummary = $derived(
        summarizeWorkspaceChanges(sessionState),
    );

    const workspaceChangesForTopBar = $derived.by(() => {
        if (!sessionState) return null;
        if (isDesktopViewport) {
            if (!isWorkspaceCollapsed) return null;
            return {
                ...workspaceChangesSummary,
                isCollapsed: true,
            };
        }
        if (sidebarOpen || workspaceChangesSummary.totalChanges === 0) {
            return null;
        }
        return {
            ...workspaceChangesSummary,
            isCollapsed: false,
        };
    });
    let modelSearchQuery = $state("");

    function setSessionWorking(sessionId: string, working: boolean): void {
        if (!sessionId) return;
        const isTracked = workingSessionIds.includes(sessionId);
        if (working && !isTracked) {
            workingSessionIds = [...workingSessionIds, sessionId];
        } else if (!working && isTracked) {
            workingSessionIds = workingSessionIds.filter(
                (trackedSessionId) => trackedSessionId !== sessionId,
            );
        }
    }
    let availableModels = $state<ModelChoice[]>([]);
    let contextUsageLabel = $state<string | null>(null);
    let serverToken = $state("");
    let connectServerUrlDraft = $state(initialServerUrl());
    let connectServerTokenDraft = $state("");
    let connectSessionIdDraft = $state(initialSessionId());
    let projects = $state<LocalServiceProject[]>([]);
    let activeProjectId = $state("");
    let projectAccessMap = $state<ProjectAccessMap>(
        browser ? readRecentProjectAccess(localStorage) : {},
    );
    const sortedProjects = $derived(
        sortProjectsByRecent(projects, projectAccessMap),
    );
    let isLoadingProject = $state(false);
    let isRegisteringProject = $state(false);
    let isPickingProjectDirectory = $state(false);

    let isDraggingSidebar = $state(false);
    let sidebarDragOffset = $state(0);

    const transcript = $derived(buildTranscript(messages));
    const canConnect = $derived(connectServerUrlDraft.trim().length > 0);
    const apiTarget = $derived.by((): ChumpApiTarget | null => {
        if (activeProjectId.trim() && serverUrl.trim() && serverToken.trim()) {
            return {
                kind: "service",
                serviceUrl: serverUrl,
                token: serverToken,
                projectId: activeProjectId,
            };
        }
        return serverUrl.trim()
            ? { kind: "direct", serverUrl }
            : null;
    });
    const workspaceTargetKey = $derived(
        apiTarget ? terminalTargetIdentity(apiTarget) : "disconnected",
    );
    // Terminal and browser tabs belong to the workspace, not one session.
    // Keep their pane mounted while a different session hydrates.
    const showWorkspace = $derived(Boolean(sessionState || isLoadingSession));
    const canSend = $derived(
        Boolean(
            apiTarget &&
                !isLoadingSession &&
                (composerText.trim().length > 0 ||
                    composerAttachments.length > 0),
        ),
    );
    const filteredModels = $derived(
        availableModels.filter(
            (model) =>
                model.label
                    .toLowerCase()
                    .includes(modelSearchQuery.toLowerCase()) ||
                model.description
                    .toLowerCase()
                    .includes(modelSearchQuery.toLowerCase()),
        ),
    );
    const groupedModels = $derived.by((): ModelGroup[] => {
        const groups: ModelGroup[] = [];
        const map: Record<string, number> = {};

        for (const model of filteredModels) {
            if (map[model.provider] === undefined) {
                map[model.provider] = groups.length;
                groups.push({ provider: model.provider, models: [] });
            }
            groups[map[model.provider]]!.models.push(model);
        }

        return groups;
    });
    const currentModel = $derived(
        status ? `${status.provider}/${status.model}` : "",
    );
    const displayWorkspace = $derived(
        shortenWorkspacePath(status?.workspace_root ?? health?.workspace_root ?? ""),
    );
    const currentGitBranch = $derived(
        status?.git_branch ?? health?.git_branch ?? "",
    );
    const reasoningInfo = $derived.by(() => {
        const source = status?.reasoning ?? health?.reasoning;
        if (!source || typeof source !== "object") return null;
        return {
            effort: typeof source.effort === "string" ? source.effort : null,
            budget: typeof source.budget === "number" ? source.budget : null,
        };
    });
    const dragOffset = $derived(
        sidebarDragOffset,
    );
    const sidebarTranslate = $derived(
        isDraggingSidebar
            ? Math.min(
                  0,
                  Math.max(
                      -240,
                      (sidebarOpen ? 0 : -240) + dragOffset,
                  ),
              )
            : sidebarOpen
              ? 0
              : -240,
    );
    const sidebarProgress = $derived((sidebarTranslate + 240) / 240);

    const sessionControllerState: SessionControllerState = {
        get serverUrl() {
            return serverUrl;
        },
        set serverUrl(value: string) {
            serverUrl = value;
        },
        get apiTarget() {
            return apiTarget;
        },
        get sessionInput() {
            return sessionInput;
        },
        set sessionInput(value: string) {
            sessionInput = value;
        },
        get activeSessionId() {
            return activeSessionId;
        },
        set activeSessionId(value: string) {
            activeSessionId = value;
        },
        get health() {
            return health;
        },
        set health(value: ChumpHealth | null) {
            health = value;
        },
        get status() {
            return status;
        },
        set status(value: ChumpStatus | null) {
            status = value;
        },
        get sessionState() {
            return sessionState;
        },
        set sessionState(value: ChumpState | null) {
            sessionState = value;
        },
        get sessions() {
            return sessions;
        },
        set sessions(value: SessionSummary[]) {
            sessions = value;
        },
        get sessionPage() {
            return sessionPage;
        },
        set sessionPage(value: number) {
            sessionPage = value;
        },
        get sessionTotalPages() {
            return sessionTotalPages;
        },
        set sessionTotalPages(value: number) {
            sessionTotalPages = value;
        },
        get sessionTotal() {
            return sessionTotal;
        },
        set sessionTotal(value: number) {
            sessionTotal = value;
        },
        get messages() {
            return messages;
        },
        set messages(value: StoredMessage[]) {
            messages = value;
        },
        get steeringQueue() {
            return steeringQueue;
        },
        set steeringQueue(value: SteeringQueueItem[]) {
            steeringQueue = value;
        },
        get isConnecting() {
            return isConnecting;
        },
        set isConnecting(value: boolean) {
            isConnecting = value;
        },
        get isSending() {
            return isSending;
        },
        set isSending(value: boolean) {
            isSending = value;
            setSessionWorking(activeSessionId, value);
        },
        get isCompacting() {
            return isCompacting;
        },
        set isCompacting(value: boolean) {
            isCompacting = value;
        },
        get isLoadingSession() {
            return isLoadingSession;
        },
        set isLoadingSession(value: boolean) {
            isLoadingSession = value;
        },
        get connectionError() {
            return connectionError;
        },
        set connectionError(value: string) {
            connectionError = value;
        },
        get lastEventId() {
            return lastEventId;
        },
        set lastEventId(value: number) {
            lastEventId = value;
        },
        get loadToken() {
            return loadToken;
        },
        set loadToken(value: number) {
            loadToken = value;
        },
        get streamToken() {
            return streamToken;
        },
        set streamToken(value: number) {
            streamToken = value;
        },
        get stopEvents() {
            return stopEvents;
        },
        set stopEvents(value: (() => void) | null) {
            stopEvents = value;
        },
        get availableModels() {
            return availableModels;
        },
        set availableModels(value: ModelChoice[]) {
            availableModels = value;
        },
        get delegatedActivities() {
            return delegatedActivities;
        },
        set delegatedActivities(value: DelegatedSessionActivity[]) {
            delegatedActivities = value;
        },
    };

    function pushToast(
        message: string,
        type: "default" | "success" | "error" = "default",
    ) {
        if (toasts.some((t) => t.message === message)) {
            return;
        }
        toastId += 1;
        const id = toastId;
        toasts = [...toasts, { id, message, type }];
        setTimeout(() => {
            toasts = toasts.filter((toast) => toast.id !== id);
        }, 3000);
    }

    function toggleBlock(id: string) {
        expandedBlocks[id] = !expandedBlocks[id];
    }

    function toggleReasoning(id: string, defaultExpanded = false) {
        expandedReasoning[id] = !(expandedReasoning[id] ?? defaultExpanded);
    }

    async function shareSession(): Promise<void> {
        const target = apiTarget;
        const sessionId = activeSessionId.trim();
        if (!target || !sessionId) {
            pushToast("Open a session to share it", "error");
            return;
        }
        if (isSharing) return;
        isSharing = true;
        try {
            const { messages: storedMessages } = await getMessages(target, sessionId);
            if (!storedMessages || storedMessages.length === 0) {
                pushToast("This session has no messages to share", "error");
                return;
            }
            const activeSession = sessions.find(
                (session) => session.id === sessionId,
            );
            const title = activeSession
                ? sessionTitle(activeSession)
                : sessionId.slice(0, 12);
            const response = await fetch("/api/shared-sessions", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title, messages: storedMessages }),
            });
            const result = (await response
                .json()
                .catch(() => null)) as {
                url?: string;
                error?: string;
            } | null;
            if (!response.ok || !result?.url) {
                pushToast(
                    result?.error ?? `Sharing failed (${response.status})`,
                    "error",
                );
                return;
            }
            const shareUrl = new URL(result.url, window.location.origin).toString();
            await navigator.clipboard.writeText(shareUrl);
            pushToast("Share link copied to clipboard", "success");
        } catch (error) {
            pushToast(toErrorMessage(error), "error");
        } finally {
            isSharing = false;
        }
    }

    function toggleSidebar() {
        sidebarOpen = !sidebarOpen;
    }

    function openProjectPicker(): void {
        projectPickerRequest += 1;
    }

    function handleWorkspaceCollapsed(collapsed: boolean): void {
        isWorkspaceCollapsed = collapsed;
        if (collapsed) {
            workspacePane?.collapse();
        } else {
            workspacePane?.expand();
        }
    }

    function toggleWorkspaceCollapse(): void {
        isWorkspaceCollapsed = !isWorkspaceCollapsed;
        if (browser) {
            localStorage.setItem(
                "workspace-panel-collapsed",
                String(isWorkspaceCollapsed),
            );
        }
        if (isWorkspaceCollapsed) {
            workspacePane?.collapse();
        } else {
            workspacePane?.expand();
        }
    }

    function handleToggleWorkspace(): void {
        if (isDesktopViewport) {
            toggleWorkspaceCollapse();
        } else {
            workspaceModalOpen = true;
        }
    }

    function closeSidebar() {
        sidebarOpen = false;
    }

    function handleSidebarSwipeStateChange(nextState: SidebarSwipeState) {
        sidebarOpen = nextState.open;
        isDraggingSidebar = nextState.isDragging;
        sidebarDragOffset = nextState.dragOffset;
    }

    function syncConnectDraftsFromActive(): void {
        connectServerUrlDraft = serverUrl;
        connectServerTokenDraft = serverToken;
        connectSessionIdDraft = activeSessionId || sessionInput;
    }

    function openConnectModal() {
        syncConnectDraftsFromActive();
        connectModalOpen = true;
    }

    function closeConnectModal() {
        connectModalOpen = false;
        stopQrScanner();
    }

    function openModelPicker() {
        modelPickerOpen = true;
        modelSearchQuery = "";
    }

    function closeModelPicker() {
        modelPickerOpen = false;
        modelSearchQuery = "";
    }

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

    $effect(() => {
        if (!browser) {
            return;
        }

        const params = new URLSearchParams();
        if (serverUrl.trim() && !activeProjectId.trim()) {
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
        if (!browser || !activeProjectId.trim() || !activeSessionId.trim()) {
            return;
        }
        sessionStorage.setItem(
            projectSessionStorageKey(activeProjectId),
            activeSessionId,
        );
    });

    $effect(() => {
        const element = transcriptElement;
        if (!element) {
            return;
        }

        const handleScroll = () => {
            const threshold = 50;
            isAtBottom =
                element.scrollHeight - element.scrollTop - element.clientHeight <=
                threshold;
        };

        element.addEventListener("scroll", handleScroll);
        return () => element.removeEventListener("scroll", handleScroll);
    });

    async function submitPrompt(): Promise<void> {
        const trimmedText = composerText.trim();
        const attachments = composerAttachments;
        const message =
            trimmedText ||
            (attachments.length > 0 ? "See attached image." : "");
        const target = apiTarget;
        if ((!message && attachments.length === 0) || !target) {
            return;
        }

        if (attachments.length === 0 && trimmedText.startsWith("/")) {
            const [command, ...parts] = trimmedText.slice(1).split(/\s+/);
            if (command) {
                composerText = "";
                if (command.startsWith("skill:")) {
                    await runCommand(
                        "skill",
                        [command.slice("skill:".length), ...parts].join(" "),
                    );
                } else {
                    await runCommand(command, parts.join(" "));
                }
                return;
            }
        }

        await submitResolvedPrompt(
            target,
            message,
            attachments,
            undefined,
            trimmedText,
        );
    }

    async function submitResolvedPrompt(
        target: ChumpApiTarget,
        message: string,
        attachments: ChatAttachment[],
        displayMessage?: string,
        restoreText = displayMessage ?? message,
    ): Promise<void> {
        const sessionId = await sessionController.ensureActiveSession();
        if (!sessionId) {
            return;
        }

        connectionError = "";
        composerText = "";
        composerAttachments = [];
        if (isSending) {
            try {
                await steerCurrentTurn(
                    target,
                    sessionId,
                    message,
                    attachments,
                    displayMessage,
                );
            } catch (error) {
                composerText = restoreText;
                composerAttachments = attachments;
                connectionError = toErrorMessage(error);
            }
            return;
        }

        isSending = true;
        setSessionWorking(sessionId, true);
        const request = {
            sessionId,
            controller: new AbortController(),
        };
        activeRequest = request;

        try {
            await streamChat(
                target,
                sessionId,
                message,
                attachments,
                request.controller.signal,
                displayMessage,
            );
        } catch (error) {
            if (!request.controller.signal.aborted && activeSessionId === sessionId) {
                connectionError = toErrorMessage(error);
            }
        } finally {
            sessionController.finishPresentationForSession(sessionId);
            setSessionWorking(sessionId, false);
            if (!request.controller.signal.aborted && activeSessionId === sessionId) {
                isSending = false;
            }
            if (activeRequest === request) {
                activeRequest = null;
            }
        }
    }

    async function deleteSteering(index: number): Promise<void> {
        const target = apiTarget;
        if (!target || !activeSessionId) {
            return;
        }

        connectionError = "";

        try {
            await cancelSteering(target, activeSessionId, index);
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
        const target = apiTarget;
        if (!target || !activeSessionId) {
            return;
        }

        connectionError = "";

        try {
            const request = activeRequest;
            if (request !== null && request.sessionId === activeSessionId) {
                request.controller.abort();
            }
            await abortCurrentTurn(target, activeSessionId);
        } catch (error) {
            connectionError = toErrorMessage(error);
        }
    }

    function handleCommand(command: string, args: string): Promise<void> | void {
        if (command === "__open_model_picker") {
            openModelPicker();
            return;
        }

        return runCommand(command, args);
    }

    async function runCommand(command: string, args: string): Promise<void> {
        const target = apiTarget;
        if (!target || (!activeSessionId && command !== "skill")) {
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
                    status = await setModel(
                        target,
                        activeSessionId,
                        provider,
                        model,
                    );
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
                    status = await setReasoning(target, activeSessionId, args);
                    pushToast(`Thinking set to ${args}`, "success");
                    break;
                }
                case "clear": {
                    await clearMessages(target, activeSessionId);
                    await sessionController.refreshSession(activeSessionId);
                    pushToast("Chat cleared", "success");
                    break;
                }
                case "compact": {
                    isCompacting = true;
                    try {
                        const result = await compactMessages(target, activeSessionId);
                        await sessionController.refreshSession(activeSessionId);
                        if (result.status === "ok") {
                            pushToast(
                                `Compacted ${result.messages_before ?? "?"} -> ${result.messages_after ?? "?"} messages`,
                                "success",
                            );
                        } else {
                            pushToast(
                                `Compaction skipped: ${result.reason ?? result.status}`,
                                "default",
                            );
                        }
                    } finally {
                        isCompacting = false;
                    }
                    break;
                }
                case "skill": {
                    const [name, ...argumentParts] = args
                        .trim()
                        .split(/\s+/);
                    if (!name) {
                        pushToast("Usage: /skill:name [args]", "error");
                        return;
                    }
                    const sessionId =
                        activeSessionId ||
                        (await sessionController.ensureActiveSession());
                    if (!sessionId) return;

                    const skillArgs = argumentParts.join(" ");
                    const loaded = await loadSkill(
                        target,
                        sessionId,
                        name,
                        skillArgs,
                    );
                    const displayMessage = `/skill:${loaded.name}${
                        skillArgs ? ` ${skillArgs}` : ""
                    }`;
                    await submitResolvedPrompt(
                        target,
                        loaded.prompt,
                        [],
                        displayMessage,
                        displayMessage,
                    );
                    break;
                }
                case "new": {
                    await sessionController.createFreshSession();
                    pushToast("New session started", "success");
                    break;
                }
            }
        } catch (error) {
            pushToast(toErrorMessage(error), "error");
        }
    }

    async function scrollTranscriptToEnd(): Promise<void> {
        // Streaming presentation can advance once per frame. Coalesce the
        // resulting layout reads/writes so autoscroll does not become another
        // source of jitter or compete with Markdown rendering.
        if (transcriptScrollScheduled) return;
        transcriptScrollScheduled = true;
        await tick();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        transcriptScrollScheduled = false;
        const element = transcriptElement;
        if (!element) return;
        element.scrollTo({
            top: element.scrollHeight,
            behavior: "auto",
        });
    }

    const qrScanner = createQrScannerController({
        onScan(value) {
            const next = applyScannedConnectValue(value, {
                serverUrl: connectServerUrlDraft || serverUrl,
                sessionId:
                    connectSessionIdDraft || activeSessionId || sessionInput,
            });
            connectServerUrlDraft = next.serverUrl;
            connectSessionIdDraft = next.sessionId;
            stopQrScanner();
        },
        onError(message) {
            qrScannerError = message;
        },
    });

    async function startQrScanner(): Promise<void> {
        qrScannerOpen = true;
        qrScannerError = "";
        await tick();

        if (!qrVideoElement) {
            qrScannerError = "Scanner video is not ready.";
            qrScannerOpen = false;
            return;
        }

        await qrScanner.start(qrVideoElement);
    }

    function stopQrScanner(): void {
        qrScannerOpen = false;
        qrScannerError = "";
        qrScanner.stop(qrVideoElement);
    }

    const sessionController = createSessionController(sessionControllerState, {
        closeConnectModal,
        scrollTranscriptToEnd,
    });

    function applyConnection(connection: LocalServiceConnection): void {
        serverUrl = connection.url;
        serverToken = connection.token;
    }

    function clearActiveProjectState(options: { clearStoredSession?: boolean } = {}) {
        const previousProjectId = activeProjectId.trim();
        activeProjectId = "";
        activeSessionId = "";
        sessionInput = "";
        if (!browser) {
            return;
        }
        sessionStorage.removeItem("chump:active-project");
        if (options.clearStoredSession && previousProjectId) {
            sessionStorage.removeItem(projectSessionStorageKey(previousProjectId));
        }
    }

    function rememberCurrentConnection(): void {
        if (!browser || !serverUrl.trim() || !serverToken.trim()) return;
        rememberLocalServiceConnection(
            data.user.id,
            {
                url: serverUrl.trim(),
                token: serverToken.trim(),
            },
            sessionStorage,
            localStorage,
        );
    }

    async function connectDirectly(options: {
        serverUrl?: string;
        preferredSessionId?: string;
    } = {}): Promise<void> {
        const nextServerUrl = normalizeServerUrl(
            options.serverUrl ?? (connectServerUrlDraft || serverUrl),
        );
        if (!nextServerUrl) {
            return;
        }

        isConnecting = true;
        connectionError = "";
        try {
            await Promise.all([
                getHealth({ kind: "direct", serverUrl: nextServerUrl }),
                getSessions({ kind: "direct", serverUrl: nextServerUrl }),
            ]);
            serverUrl = nextServerUrl;
            serverToken = "";
            projects = [];
            clearActiveProjectState();
            await sessionController.connectToServer({
                preferredSessionId: options.preferredSessionId,
            });
        } catch (error) {
            connectionError = toErrorMessage(error);
            connectModalOpen = true;
        } finally {
            isConnecting = false;
        }
    }

    async function connectToLocalService(options: {
        connection?: LocalServiceConnection;
        preferredSessionId?: string;
    } = {}): Promise<void> {
        isConnecting = true;
        connectionError = "";
        try {
            const connection = normalizeLocalServiceConnection(
                options.connection ?? {
                    url: connectServerUrlDraft || serverUrl,
                    token: connectServerTokenDraft || serverToken,
                },
            );
            const nextProjects = await listLocalServiceProjects(connection);
            applyConnection(connection);
            projects = nextProjects;
            if (browser) {
                rememberCurrentConnection();
                clearPendingLocalServiceHandoff(localStorage);
            }

            const requestedProjectId = connection.projectId?.trim() ?? "";
            const sortedCandidateProjects = sortProjectsByRecent(nextProjects, projectAccessMap);
            const preferredProjectId = nextProjects.some(
                (project) => project.id === requestedProjectId,
            )
                ? requestedProjectId
                : sortedCandidateProjects.some((project) => project.id === activeProjectId)
                  ? activeProjectId
                  : (sortedCandidateProjects[0]?.id ?? "");
            if (preferredProjectId) {
                await selectProject(preferredProjectId, {
                    preferredSessionId: options.preferredSessionId,
                });
            } else {
                clearActiveProjectState({ clearStoredSession: true });
                sessionController.clearSessionView();
                health = null;
                sessions = [];
            }
            closeConnectModal();
        } catch (error) {
            const permissionMessage = browser
                ? loopbackPermissionMessage(
                      await getLoopbackPermissionState(),
                  )
                : null;
            connectionError = permissionMessage ?? toErrorMessage(error);
            connectModalOpen = true;
        } finally {
            isConnecting = false;
        }
    }

    async function connectToSavedLocalService(): Promise<void> {
        const permissionMessage = loopbackPermissionMessage(
            await getLoopbackPermissionState(),
        );
        if (permissionMessage) {
            connectionError = permissionMessage;
            connectModalOpen = true;
            return;
        }
        await connectToLocalService({
            connection: {
                url: serverUrl,
                token: serverToken,
            },
        });
    }

    async function connectWithCurrentSettings(): Promise<void> {
        if (connectServerTokenDraft.trim()) {
            await connectToLocalService({
                preferredSessionId: connectSessionIdDraft,
            });
            return;
        }
        await connectDirectly({ preferredSessionId: connectSessionIdDraft });
    }

    async function registerProject(input: {
        workspacePath: string;
        name?: string;
    }): Promise<void> {
        if (!serverUrl || !serverToken) return;
        isRegisteringProject = true;
        connectionError = "";
        try {
            const connection = {
                url: serverUrl,
                token: serverToken,
            };
            const project = await registerLocalServiceProject(connection, {
                ...input,
                approved: true,
            });
            projects = await listLocalServiceProjects(connection);
            await selectProject(project.id);
        } catch (error) {
            connectionError = toErrorMessage(error);
            throw error;
        } finally {
            isRegisteringProject = false;
        }
    }

    async function pickProjectDirectory(): Promise<string | null> {
        if (!serverUrl || !serverToken || isPickingProjectDirectory) {
            return null;
        }
        isPickingProjectDirectory = true;
        connectionError = "";
        try {
            return await pickLocalServiceProjectDirectory({
                url: serverUrl,
                token: serverToken,
            });
        } catch (error) {
            connectionError = toErrorMessage(error);
            return null;
        } finally {
            isPickingProjectDirectory = false;
        }
    }

    async function openProjectFromPicker(): Promise<void> {
        const workspacePath = await pickProjectDirectory();
        if (
            !workspacePath ||
            !confirm(`Allow Chump to access and register ${workspacePath}?`)
        ) {
            return;
        }
        await registerProject({ workspacePath });
    }

    async function selectProject(
        projectId: string,
        options: { preferredSessionId?: string } = {},
    ): Promise<void> {
        if (!projectId || !serverUrl || !serverToken) {
            return;
        }
        isLoadingProject = true;
        connectionError = "";
        sessionController.clearSessionView();
        sessions = [];
        workingSessionIds = [];
        activeSessionId = "";
        sessionInput = "";
        health = null;
        try {
            activeProjectId = projectId;
            let preferredSessionId = options.preferredSessionId?.trim() || "";
            if (browser) {
                sessionStorage.setItem("chump:active-project", projectId);
                projectAccessMap = recordProjectAccess(localStorage, projectId);
                preferredSessionId ||=
                    sessionStorage.getItem(projectSessionStorageKey(projectId)) ?? "";
            }
            activeSessionId = preferredSessionId;
            sessionInput = preferredSessionId;
            await sessionController.connectToServer({
                preferredSessionId,
            });
        } catch (error) {
            connectionError = toErrorMessage(error);
        } finally {
            isLoadingProject = false;
        }
    }

    function projectSessionStorageKey(projectId: string): string {
        return `chump:project:${projectId}:active-session`;
    }

    async function createProjectSession(): Promise<void> {
        if (!activeProjectId || !serverUrl || !serverToken) {
            await sessionController.createFreshSession();
            return;
        }
        try {
            const created = await createLocalServiceProjectSession(
                { url: serverUrl, token: serverToken },
                activeProjectId,
            );
            sessionController.ensureSessionListed(created.sessionId);
            await sessionController.selectSession(created.sessionId);
        } catch (error) {
            connectionError = toErrorMessage(error);
        }
    }

    onMount(() => {
        const desktopViewport = window.matchMedia("(min-width: 768px)");
        const syncDesktopViewport = () => {
            isDesktopViewport = desktopViewport.matches;
        };
        syncDesktopViewport();
        desktopViewport.addEventListener("change", syncDesktopViewport);

        if (desktopViewport.matches) {
            sidebarOpen = true;
        }
        const handleOpenProjectShortcut = (event: KeyboardEvent) => {
            if (
                event.key.toLowerCase() !== "o" ||
                (!event.metaKey && !event.ctrlKey) ||
                event.altKey ||
                event.shiftKey
            ) {
                return;
            }
            event.preventDefault();
            void openProjectFromPicker();
        };
        window.addEventListener("keydown", handleOpenProjectShortcut);

        const handleToggleSidebarShortcut = (event: KeyboardEvent) => {
            if (
                event.key.toLowerCase() === "b" &&
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                !event.shiftKey
            ) {
                event.preventDefault();
                toggleSidebar();
            }
        };
        window.addEventListener("keydown", handleToggleSidebarShortcut);

        const connectPendingLocalServiceHandoff = (
            connection: LocalServiceConnection,
        ) => {
            void connectToLocalService({ connection });
        };

        const handlePendingLocalServiceHandoff = (event: StorageEvent) => {
            if (
                event.key !== PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY ||
                !event.newValue
            ) {
                return;
            }
            const connection = parsePendingLocalServiceHandoff(event.newValue);
            if (!connection) return;

            connectPendingLocalServiceHandoff(connection);
        };

        const handleCurrentDocumentLocalServiceHandoff = (event: Event) => {
            const connection = parsePendingLocalServiceHandoffEvent(event);
            if (!connection) return;

            connectPendingLocalServiceHandoff(connection);
        };
        window.addEventListener("storage", handlePendingLocalServiceHandoff);
        window.addEventListener(
            PENDING_LOCAL_SERVICE_HANDOFF_EVENT,
            handleCurrentDocumentLocalServiceHandoff,
        );

        const handoff = consumeLocalServiceHandoff(
            window.location.href,
            sessionStorage,
            (url) => window.history.replaceState({}, "", url),
        );
        const savedConnection =
            handoff ??
            readPendingLocalServiceHandoff(localStorage) ??
            readLocalServiceConnection(
                data.user.id,
                sessionStorage,
                localStorage,
            );
        if (savedConnection && !serverUrl.trim()) {
            applyConnection(savedConnection);
            rememberCurrentConnection();
        }
        if (serverUrl.trim()) {
            void connectDirectly();
        } else if (savedConnection) {
            activeProjectId =
                sessionStorage.getItem("chump:active-project") ?? "";
            void connectToSavedLocalService();
        } else {
            openConnectModal();
        }

        return () => {
            desktopViewport.removeEventListener("change", syncDesktopViewport);
            window.removeEventListener("keydown", handleOpenProjectShortcut);
            window.removeEventListener("keydown", handleToggleSidebarShortcut);
            window.removeEventListener("storage", handlePendingLocalServiceHandoff);
            window.removeEventListener(
                PENDING_LOCAL_SERVICE_HANDOFF_EVENT,
                handleCurrentDocumentLocalServiceHandoff,
            );
            sessionController.destroy();
            stopQrScanner();
            activeRequest?.controller.abort();
        };
    });
</script>

<svelte:head>
    <title>chump web</title>
</svelte:head>

<div
    class="relative flex h-[100dvh] min-h-0 w-full overflow-hidden bg-bg-surface font-sans text-text-main selection:bg-accent-bg selection:text-text-inverse"
>
    <div
        class="hidden md:flex flex-col h-[100dvh] shrink-0 transition-[width,opacity] duration-200 ease-in-out {sidebarOpen
            ? 'w-64 lg:w-72 border-r border-border-default'
            : 'w-0 overflow-hidden border-none opacity-0'}"
    >
        <SessionsSidebar
            {sessions}
            {sessionPage}
            {sessionTotalPages}
            {activeSessionId}
            bind:sessionInput
            {health}
            {serverUrl}
            {workingSessionIds}
            projects={sortedProjects}
            {activeProjectId}
            {isLoadingProject}
            {isRegisteringProject}
            {isPickingProjectDirectory}
            onSelectProject={(projectId) => void selectProject(projectId)}
            onRegisterProject={registerProject}
            onPickProjectDirectory={pickProjectDirectory}
            onOpenProjectPicker={openProjectPicker}
            onCreateSession={() => void createProjectSession()}
            onOpenSession={() => void sessionController.openTypedSession()}
            onSelectSession={(id) => void sessionController.selectSession(id)}
            onLoadMore={() => sessionController.loadMoreSessions()}
            {sessionTitle}
            open={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            user={data?.user}
        />
    </div>

    {#if sidebarOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="md:hidden fixed inset-0 z-40 bg-[var(--bg-overlay)] backdrop-blur-xs flex"
            role="dialog"
            aria-modal="true"
        >
            <div class="relative w-72 max-w-[80vw] h-full flex flex-col bg-bg-surface-alt border-r border-border-default">
                <SessionsSidebar
                    {sessions}
                    {sessionPage}
                    {sessionTotalPages}
                    {activeSessionId}
                    bind:sessionInput
                    {health}
                    {serverUrl}
                    {workingSessionIds}
                    projects={sortedProjects}
                    {activeProjectId}
                    {isLoadingProject}
                    {isRegisteringProject}
                    {isPickingProjectDirectory}
                    onSelectProject={(projectId) => {
                        closeSidebar();
                        void selectProject(projectId);
                    }}
                    onRegisterProject={registerProject}
                    onPickProjectDirectory={pickProjectDirectory}
                    onOpenProjectPicker={() => {
                        closeSidebar();
                        openProjectPicker();
                    }}
                    onCreateSession={() => {
                        closeSidebar();
                        void createProjectSession();
                    }}
                    onOpenSession={() => {
                        closeSidebar();
                        void sessionController.openTypedSession();
                    }}
                    onSelectSession={(id) => {
                        closeSidebar();
                        void sessionController.selectSession(id);
                    }}
                    onLoadMore={() => sessionController.loadMoreSessions()}
                    {sessionTitle}
                    open={sidebarOpen}
                    onToggleSidebar={toggleSidebar}
                    user={data?.user}
                />
            </div>
            <button
                type="button"
                class="flex-1 h-full cursor-default"
                onclick={closeSidebar}
                aria-label="Close backdrop"
            ></button>
        </div>
    {/if}

    {#snippet chatPane()}
    <main class="relative flex h-[100dvh] min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg-surface">
        <div
            class="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-bg-surface via-bg-surface/80 to-transparent z-10 pointer-events-none"
        ></div>
        <ChatTopBar
            {sidebarOpen}
            onToggleSidebar={toggleSidebar}
            canShare={Boolean(apiTarget && activeSessionId)}
            {isSharing}
            onShare={() => void shareSession()}
            workspaceChanges={workspaceChangesForTopBar}
            onToggleWorkspace={handleToggleWorkspace}
        />

        <TranscriptPane
            {transcript}
            bind:transcriptElement
            {isSending}
            {isConnecting}
            {expandedBlocks}
            {expandedReasoning}
            {isLoadingSession}
            onToggleBlock={toggleBlock}
            onToggleReasoning={toggleReasoning}
            {reasoningSummary}
            {health}
            {activeSessionId}
            {apiTarget}
            onOpenConnectModal={openConnectModal}
        />

        {#if connectionError && !connectModalOpen}
            <div
                class="pointer-events-none absolute left-1/2 z-20 w-full max-w-4xl -translate-x-1/2 px-4 md:px-8 {health
                    ? 'bottom-24 md:bottom-28'
                    : 'bottom-4'}"
            >
                <div class="pointer-events-auto bg-bg-toast-err border border-error/30 text-error rounded-[9px] px-3.5 py-2.5 text-[13px] flex items-start gap-2.5 animate-toast-in">
                    <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div class="flex-1 leading-normal">
                        <span class="font-bold">Error:</span> {toErrorMessage(connectionError)}
                    </div>
                    <button
                        type="button"
                        class="text-error opacity-60 hover:opacity-100 transition-opacity shrink-0 cursor-pointer"
                        onclick={() => { connectionError = ""; }}
                        aria-label="Dismiss error"
                    >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        {/if}

        {#if health}
            <ChatComposer
                bind:composerText
                {serverUrl}
                {apiTarget}
                bind:composerAttachments
                {canSend}
                {isSending}
                {isCompacting}
                models={availableModels}
                skills={health.skills}
                {isLoadingSession}
                {currentModel}
                workspaceRoot={displayWorkspace}
                gitBranch={currentGitBranch}
                {reasoningInfo}
                {contextUsageLabel}
                {steeringQueue}
                {delegatedActivities}
                onSelectSession={(id) => void sessionController.selectSession(id)}
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
    {/snippet}

    {#snippet workspaceStatePane()}
        {#await import("$lib/WorkspaceState.svelte") then { default: WorkspaceState }}
            {#key workspaceTargetKey}
                <WorkspaceState
                    state={sessionState}
                    target={apiTarget}
                    {sidebarOpen}
                    bind:isCollapsed={isWorkspaceCollapsed}
                    bind:modalOpen={workspaceModalOpen}
                    onCollapsedChange={handleWorkspaceCollapsed}
                />
            {/key}
        {/await}
    {/snippet}

    {#if showWorkspace && isDesktopViewport}
        <PaneGroup direction="horizontal" class="min-h-0 min-w-0 flex-1">
            <Pane defaultSize={58} minSize={25}>
                {@render chatPane()}
            </Pane>
            <PaneResizer class="workspace-pane-resizer hidden md:block" />
            <Pane
                bind:this={workspacePane}
                defaultSize={42}
                minSize={25}
                collapsible
                collapsedSize={0}
                onCollapse={() => handleWorkspaceCollapsed(true)}
                onExpand={() => handleWorkspaceCollapsed(false)}
            >
                {@render workspaceStatePane()}
            </Pane>
        </PaneGroup>
    {:else}
        {@render chatPane()}
        {#if showWorkspace}
            {@render workspaceStatePane()}
        {/if}
    {/if}
</div>

<ConnectServerModal
    open={connectModalOpen}
    bind:serverUrl={connectServerUrlDraft}
    bind:serverToken={connectServerTokenDraft}
    {canConnect}
    {isConnecting}
    {connectionError}
    {qrScannerOpen}
    {qrScannerError}
    bind:qrVideoElement
    onClose={closeConnectModal}
    onConnect={() => void connectWithCurrentSettings()}
    onStartQrScanner={() => void startQrScanner()}
    onStopQrScanner={stopQrScanner}
/>

<Toasts bind:toasts />

<ModelPickerModal
    open={modelPickerOpen}
    {groupedModels}
    {currentModel}
    bind:modelSearchQuery
    {shortenModel}
    onClose={closeModelPicker}
    onSelectModel={(provider, model) => {
        void handleCommand("model", `${provider}/${model}`);
    }}
/>

<CommandPalette
    projects={sortedProjects}
    {activeProjectId}
    onSelectProject={(projectId) => void selectProject(projectId)}
    onOpenProjectRegistration={() => void openProjectFromPicker()}
    models={availableModels}
    currentModel={currentModel}
    currentThinking={reasoningInfo?.effort ?? "none"}
    onCommand={handleCommand}
    onToggleSidebar={toggleSidebar}
    onOpenConnectModal={openConnectModal}
    openProjectPickerRequest={projectPickerRequest}
/>

<style>
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

    @keyframes toast-in {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    .animate-toast-in {
        animation: toast-in 0.2s ease-out forwards;
    }

    :global(.workspace-pane-resizer) {
        position: relative;
        z-index: 20;
        width: 1px;
        flex-shrink: 0;
        background: var(--border-subtle);
        cursor: col-resize;
    }

    :global(.workspace-pane-resizer::after) {
        content: "";
        position: absolute;
        inset: 0 -4px;
    }

    :global(.workspace-pane-resizer:hover),
    :global(.workspace-pane-resizer[data-active]) {
        background: var(--text-highlight);
    }
</style>
