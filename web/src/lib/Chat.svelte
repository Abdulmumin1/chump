<script lang="ts">
    import { browser } from "$app/environment";
    import { onMount, tick } from "svelte";
    import SessionsSidebar from "$lib/SessionsSidebar.svelte";
    import TranscriptPane from "$lib/TranscriptPane.svelte";
    import ChatComposer from "$lib/ChatComposer.svelte";
    import Toasts from "$lib/Toasts.svelte";
    import WorkspaceState from "$lib/WorkspaceState.svelte";
    import ChatTopBar from "$lib/chat/ChatTopBar.svelte";
    import ConnectServerModal from "$lib/chat/ConnectServerModal.svelte";
    import ModelPickerModal from "$lib/chat/ModelPickerModal.svelte";
    import CommandPalette from "$lib/chat/CommandPalette.svelte";
    import { sidebarSwipe, type SidebarSwipeState } from "$lib/chat/sidebar-swipe";
    import {
        shortenModel,
        shortenWorkspacePath,
        formatDate,
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
        setModel,
        setReasoning,
        sessionTitle,
        steerCurrentTurn,
        streamChat,
        type ChumpApiTarget,
    } from "$lib/chump/api";
    import type {
        ChatAttachment,
        ChumpHealth,
        ChumpState,
        ChumpStatus,
        SessionSummary,
        StoredMessage,
    } from "$lib/chump/types";
    import {
        formatCtxLabel,
        type ModelChoice,
    } from "$lib/models";
    import {
        createDaemonProjectSession,
        discoverLocalDaemon,
        getDaemonProjectRuntime,
        listDaemonProjects,
        normalizeDaemonConnection,
        startDaemonProject,
        stopDaemonProject,
        type DaemonProject,
        type DaemonRuntime,
    } from "$lib/chump/daemon-api";

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
    let steeringQueue = $state<SteeringQueueItem[]>([]);
    let composerText = $state("");
    let composerAttachments = $state<ChatAttachment[]>([]);
    let isConnecting = $state(false);
    let isSending = $state(false);
    let isCompacting = $state(false);
    let isLoadingSession = $state(false);
    let connectionError = $state("");
    let transcriptElement = $state<HTMLDivElement | null>(null);
    let isAtBottom = $state(true);
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
    let contextUsageLabel = $state<string | null>(null);
    let daemonUrl = $state("");
    let daemonToken = $state("");
    let projects = $state<DaemonProject[]>([]);
    let activeProjectId = $state("");
    let isLoadingProject = $state(false);
    let projectRuntimes = $state<Record<string, DaemonRuntime>>({});
    let runtimeActionProjectId = $state("");

    let isDraggingSidebar = $state(false);
    let sidebarDragOffset = $state(0);

    const currentProvider = $derived(status ? status.provider : "");
    const transcript = $derived(buildTranscript(messages));
    const canConnect = $derived(serverUrl.trim().length > 0);
    const apiTarget = $derived.by((): ChumpApiTarget | null => {
        if (activeProjectId && daemonUrl && daemonToken) {
            return {
                kind: "daemon",
                daemonUrl,
                token: daemonToken,
                projectId: activeProjectId,
            };
        }
        return serverUrl
            ? { kind: "direct", serverUrl }
            : null;
    });
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

    function toggleSidebar() {
        sidebarOpen = !sidebarOpen;
    }

    function closeSidebar() {
        sidebarOpen = false;
    }

    function handleSidebarSwipeStateChange(nextState: SidebarSwipeState) {
        sidebarOpen = nextState.open;
        isDraggingSidebar = nextState.isDragging;
        sidebarDragOffset = nextState.dragOffset;
    }

    function openConnectModal() {
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
        if (serverUrl.trim() && !activeProjectId) {
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
        if (!browser || !activeProjectId || !activeSessionId) {
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
                await runCommand(command, parts.join(" "));
                return;
            }
        }

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
                );
            } catch (error) {
                composerText = trimmedText;
                composerAttachments = attachments;
                connectionError = toErrorMessage(error);
            }
            return;
        }

        isSending = true;
        activeRequestController = new AbortController();

        try {
            await streamChat(
                target,
                sessionId,
                message,
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
            activeRequestController?.abort();
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
        if (!target || !activeSessionId) {
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
                    await sessionController.refreshSessionSnapshot(activeSessionId);
                    pushToast("Chat cleared", "success");
                    break;
                }
                case "compact": {
                    isCompacting = true;
                    try {
                        const result = await compactMessages(target, activeSessionId);
                        await sessionController.refreshSessionSnapshot(activeSessionId);
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
        await tick();
        transcriptElement?.scrollTo({
            top: transcriptElement.scrollHeight,
            behavior: "smooth",
        });
    }

    const qrScanner = createQrScannerController({
        onScan(value) {
            const next = applyScannedConnectValue(value, {
                serverUrl,
                sessionId: activeSessionId || sessionInput,
            });
            serverUrl = next.serverUrl;
            if (next.sessionId) {
                sessionInput = next.sessionId;
                activeSessionId = next.sessionId;
            }
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

    async function connectToDaemon(): Promise<void> {
        isConnecting = true;
        connectionError = "";
        try {
            const connection = normalizeDaemonConnection({
                url: daemonUrl,
                token: daemonToken,
            });
            const nextProjects = await listDaemonProjects(connection);
            daemonUrl = connection.url;
            daemonToken = connection.token;
            projects = nextProjects;
            await refreshProjectRuntimes(connection, nextProjects);
            if (browser) {
                sessionStorage.setItem("chump:daemon-url", daemonUrl);
                sessionStorage.setItem("chump:daemon-token", daemonToken);
            }
            const preferredProjectId =
                nextProjects.some((project) => project.id === activeProjectId)
                    ? activeProjectId
                    : (nextProjects[0]?.id ?? "");
            if (preferredProjectId) {
                await selectProject(preferredProjectId);
            }
            closeConnectModal();
        } catch (error) {
            connectionError = toErrorMessage(error);
        } finally {
            isConnecting = false;
        }
    }

    async function refreshProjectRuntimes(
        connection = { url: daemonUrl, token: daemonToken },
        targetProjects = projects,
    ): Promise<void> {
        const results = await Promise.allSettled(
            targetProjects.map((project) =>
                getDaemonProjectRuntime(connection, project.id),
            ),
        );
        projectRuntimes = Object.fromEntries(
            results.flatMap((result, index) =>
                result.status === "fulfilled"
                    ? [[targetProjects[index]!.id, result.value]]
                    : [],
            ),
        );
    }

    async function startProject(projectId: string): Promise<void> {
        if (!daemonUrl || !daemonToken) return;
        runtimeActionProjectId = projectId;
        connectionError = "";
        try {
            const runtime = await startDaemonProject(
                { url: daemonUrl, token: daemonToken },
                projectId,
            );
            projectRuntimes = { ...projectRuntimes, [projectId]: runtime };
            if (projectId === activeProjectId) {
                await sessionController.connectToServer();
            }
        } catch (error) {
            connectionError = toErrorMessage(error);
        } finally {
            runtimeActionProjectId = "";
        }
    }

    async function stopProject(projectId: string): Promise<void> {
        const project = projects.find((item) => item.id === projectId);
        if (
            !daemonUrl ||
            !daemonToken ||
            !confirm(`Stop ${project?.name ?? "this project"}? Active runs will be interrupted.`)
        ) {
            return;
        }
        runtimeActionProjectId = projectId;
        connectionError = "";
        try {
            const runtime = await stopDaemonProject(
                { url: daemonUrl, token: daemonToken },
                projectId,
            );
            projectRuntimes = { ...projectRuntimes, [projectId]: runtime };
            if (projectId === activeProjectId) {
                sessionController.clearSessionView();
                health = null;
                sessions = [];
            }
        } catch (error) {
            connectionError = toErrorMessage(error);
        } finally {
            runtimeActionProjectId = "";
        }
    }

    async function selectProject(projectId: string): Promise<void> {
        if (!projectId || !daemonUrl || !daemonToken) {
            return;
        }
        isLoadingProject = true;
        connectionError = "";
        sessionController.clearSessionView();
        sessions = [];
        activeSessionId = "";
        sessionInput = "";
        health = null;
        try {
            activeProjectId = projectId;
            serverUrl = daemonUrl;
            if (browser) {
                sessionStorage.setItem("chump:active-project", projectId);
                const previousSessionId = sessionStorage.getItem(
                    projectSessionStorageKey(projectId),
                );
                activeSessionId = previousSessionId ?? "";
                sessionInput = previousSessionId ?? "";
            }
            await sessionController.connectToServer();
        } catch (error) {
            connectionError = toErrorMessage(error);
        } finally {
            isLoadingProject = false;
        }
    }

    function projectSessionStorageKey(projectId: string): string {
        return `chump:project:${projectId}:active-session`;
    }

    async function connectDirectly(): Promise<void> {
        activeProjectId = "";
        projects = [];
        if (browser) {
            sessionStorage.removeItem("chump:active-project");
        }
        await sessionController.connectToServer();
    }

    async function createProjectSession(): Promise<void> {
        if (!activeProjectId || !daemonUrl || !daemonToken) {
            await sessionController.createFreshSession();
            return;
        }
        try {
            const created = await createDaemonProjectSession(
                { url: daemonUrl, token: daemonToken },
                activeProjectId,
            );
            sessionController.ensureSessionListed(created.sessionId);
            await sessionController.selectSession(created.sessionId);
        } catch (error) {
            connectionError = toErrorMessage(error);
        }
    }

    onMount(() => {
        daemonUrl = sessionStorage.getItem("chump:daemon-url") ?? "";
        daemonToken = sessionStorage.getItem("chump:daemon-token") ?? "";
        activeProjectId =
            sessionStorage.getItem("chump:active-project") ?? "";
        if (daemonUrl && daemonToken) {
            void connectToDaemon();
        } else {
            void discoverLocalDaemon()
                .then((connection) => {
                    if (connection) {
                        daemonUrl = connection.url;
                        daemonToken = connection.token;
                        return connectToDaemon();
                    }
                    if (serverUrl.trim()) {
                        return connectDirectly();
                    }
                })
                .catch((error) => {
                    connectionError = toErrorMessage(error);
                });
        }

        return () => {
            sessionController.destroy();
            stopQrScanner();
            activeRequestController?.abort();
        };
    });
</script>

<svelte:head>
    <title>chump web</title>
</svelte:head>

<div
    class="flex h-[100dvh] bg-bg-surface text-text-main font-sans overflow-hidden selection:bg-accent-bg selection:text-text-inverse relative"
    use:sidebarSwipe={{
        open: sidebarOpen,
        onStateChange: handleSidebarSwipeStateChange,
    }}
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
        {isLoadingSession}
        {projects}
        {activeProjectId}
        {isLoadingProject}
        {projectRuntimes}
        {runtimeActionProjectId}
        onSelectProject={(projectId) => void selectProject(projectId)}
        onStartProject={(projectId) => void startProject(projectId)}
        onStopProject={(projectId) => void stopProject(projectId)}
        onCreateSession={() => void createProjectSession()}
        onOpenSession={() => void sessionController.openTypedSession()}
        onSelectSession={(id) => {
            closeSidebar();
            void sessionController.selectSession(id);
        }}
        onOpenConnectModal={openConnectModal}
        onConnect={() => void connectDirectly()}
        {sessionTitle}
        {formatDate}
        open={sidebarOpen}
        {dragOffset}
        isDragging={isDraggingSidebar}
    />

    <main
        class="flex-1 flex flex-col bg-bg-surface relative min-w-0 h-[100dvh]"
        class:transition-all={!isDraggingSidebar}
        class:duration-200={!isDraggingSidebar}
        class:ease-out={!isDraggingSidebar}
        style:transform="translateX({sidebarProgress * 40}px)"
        style:overflow={sidebarProgress > 0 ? "hidden" : ""}
        style:border-radius="{sidebarProgress * 12}px"
        style:box-shadow={sidebarProgress > 0
            ? "0 0 0 1px var(--border-subtle)"
            : ""}
    >
        <div
            class="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-bg-surface via-bg-surface/80 to-transparent z-10 pointer-events-none"
        ></div>

        <ChatTopBar
            {activeSessionId}
            onToggleSidebar={toggleSidebar}
            onCreateSession={() => void createProjectSession()}
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
            onOpenConnectModal={openConnectModal}
        />

        {#if connectionError && !connectModalOpen}
            <div class="max-w-4xl mx-auto w-full px-4 md:px-8 mb-4">
                <div class="bg-bg-toast-err border border-error/30 text-error rounded-[9px] px-3.5 py-2.5 text-[13px] flex items-start gap-2.5 animate-toast-in">
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
                {isLoadingSession}
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

    {#if sessionState}
        <WorkspaceState state={sessionState} {sidebarOpen} />
    {/if}
</div>

<ConnectServerModal
    open={connectModalOpen}
    bind:serverUrl
    bind:daemonUrl
    bind:daemonToken
    {canConnect}
    {isConnecting}
    {connectionError}
    {qrScannerOpen}
    {qrScannerError}
    bind:qrVideoElement
    onClose={closeConnectModal}
    onConnect={() => void connectDirectly()}
    onConnectDaemon={() => void connectToDaemon()}
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
    models={availableModels}
    currentModel={currentModel}
    currentThinking={reasoningInfo?.effort ?? "none"}
    onCommand={handleCommand}
    onToggleSidebar={toggleSidebar}
    onOpenConnectModal={openConnectModal}
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
</style>
