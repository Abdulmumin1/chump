<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import SessionsSidebar from '$lib/SessionsSidebar.svelte';
	import TranscriptPane from '$lib/TranscriptPane.svelte';
	import ChatComposer from '$lib/ChatComposer.svelte';
	import Toasts from '$lib/Toasts.svelte';

	import {
		abortCurrentTurn,
		clearMessages,
		createSessionId,
		getEventLog,
		getHealth,
		getMessages,
		getSessions,
		getState,
		getStatus,
		loadSkill,
		normalizeServerUrl,
		openEventStream,
		sessionTitle,
		setModel,
		steerCurrentTurn,
		streamChat
	} from '$lib/chump/api';
	import type {
		ChumpHealth,
		ChumpState,
		ChumpStatus,
		MessagePart,
		SessionSummary,
		StoredEvent,
		StoredMessage,
		SseEvent
	} from '$lib/chump/types';

	type TranscriptBlock = {
		kind: 'text' | 'tool-call' | 'tool-result' | 'image';
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
		tone: 'default' | 'error' | 'muted';
	};

	let { data }: { data: any } = $props();
	const initialServerUrl = () => data?.initialServerUrl ?? '';
	const initialSessionId = () => data?.initialSessionId ?? '';
	const detectedServerUrl = () => data?.detectedServerUrl;

	let serverUrl = $state(initialServerUrl());
	let sessionInput = $state(initialSessionId());
	let activeSessionId = $state(initialSessionId());
	let health = $state<ChumpHealth | null>(null);
	let status = $state<ChumpStatus | null>(null);
	let sessionState = $state<ChumpState | null>(null);
	let sessions = $state<SessionSummary[]>([]);
	let messages = $state<StoredMessage[]>([]);
	let eventLog = $state<StoredEvent[]>([]);
	let activity = $state<ActivityItem[]>([]);
	let reasoningText = $state('');
	let liveAssistantText = $state('');
	let composerText = $state('');
	let isConnecting = $state(false);
	let isLoadingSession = $state(false);
	let isSending = $state(false);
	let connectionError = $state('');
	let actionNotice = $state('');
	let transcriptElement = $state<HTMLDivElement | null>(null);
	let stopEvents: (() => void) | null = null;
	let lastEventId = 0;
	let loadToken = 0;
	let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
	let sessionsTimer: ReturnType<typeof setTimeout> | null = null;
	let activeRequestController: AbortController | null = null;
	let expandedBlocks = $state<Record<string, boolean>>({});
	let expandedReasoning = $state<Record<string, boolean>>({});
	let sidebarOpen = $state(false);
	let connectModalOpen = $state(false);
	let modelPickerOpen = $state(false);
	let toasts = $state<Array<{ id: number; message: string; type?: 'default' | 'success' | 'error' }>>([]);
	let toastId = 0;

	function pushToast(message: string, type: 'default' | 'success' | 'error' = 'default') {
		toastId += 1;
		const id = toastId;
		toasts = [...toasts, { id, message, type }];
		setTimeout(() => {
			toasts = toasts.filter((t) => t.id !== id);
		}, 3000);
	}

	const MODEL_PRESETS = [
		{ label: 'openai/gpt-5.4', provider: 'openai', model: 'gpt-5.4' },
		{ label: 'openai/gpt-5.4-mini', provider: 'openai', model: 'gpt-5.4-mini' },
		{ label: 'openai/gpt-5.3-codex', provider: 'openai', model: 'gpt-5.3-codex' },
		{ label: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
		{ label: 'google/gemini-2.5-pro', provider: 'google', model: 'gemini-2.5-pro' },
		{ label: 'google/gemini-2.5-flash', provider: 'google', model: 'gemini-2.5-flash' },
		{ label: 'workers_ai/@cf/moonshotai/kimi-k2.6', provider: 'workers_ai', model: '@cf/moonshotai/kimi-k2.6' },
		{ label: 'workers_ai/@cf/moonshotai/kimi-k2.5', provider: 'workers_ai', model: '@cf/moonshotai/kimi-k2.5' }
	];

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
	function openConnectModal() {
		connectModalOpen = true;
		closeSidebar();
	}
	function closeConnectModal() {
		connectModalOpen = false;
	}
	function openModelPicker() {
		modelPickerOpen = true;
	}
	function closeModelPicker() {
		modelPickerOpen = false;
	}

	let selectedSession = $derived(sessions.find((session) => session.id === activeSessionId) ?? null);
	let transcript = $derived(buildTranscript(messages, liveAssistantText, eventLog));
	let canConnect = $derived(serverUrl.trim().length > 0);
	let canSend = $derived(Boolean(serverUrl && composerText.trim().length > 0));
	let canSteer = $derived(Boolean(serverUrl && activeSessionId && composerText.trim().length > 0));

	let currentModel = $derived(health ? `${health.provider}/${health.model}` : '');
	let currentSkills = $derived(health?.skills ?? []);
	let displayWorkspace = $derived(shortenWorkspacePath(health?.workspace_root ?? ''));

	function shortenWorkspacePath(path: string): string {
		if (!path) return '';
		// Try to detect home directory prefix patterns
		const homePatterns = [
			/^\/Users\/[^/]+/,
			/^\/home\/[^/]+/,
			/^~/
		];
		for (const pattern of homePatterns) {
			const match = path.match(pattern);
			if (match) {
				return '~' + path.slice(match[0].length);
			}
		}
		return path;
	}

	$effect(() => {
		if (!browser) {
			return;
		}

		const params = new URLSearchParams();
		if (serverUrl.trim()) {
			params.set('server', serverUrl.trim());
		}
		if (activeSessionId.trim()) {
			params.set('session', activeSessionId.trim());
		}

		const query = params.toString();
		const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
		window.history.replaceState({}, '', nextUrl);
	});

	onMount(() => {
		if (serverUrl.trim()) {
			void connectToServer();
		}

		return () => {
			stopEvents?.();
			stopEvents = null;
			clearTimeoutIfNeeded(snapshotTimer);
			clearTimeoutIfNeeded(sessionsTimer);
			activeRequestController?.abort();
		};
	});

	async function connectToServer(options: { selectFirstSession?: boolean } = {}): Promise<void> {
		const targetUrl = normalizeServerUrl(serverUrl);
		if (!targetUrl) {
			return;
		}

		serverUrl = targetUrl;
		isConnecting = true;
		connectionError = '';
		actionNotice = '';

		try {
			const [nextHealth, nextSessionsResponse] = await Promise.all([
				getHealth(targetUrl),
				getSessions(targetUrl)
			]);

			health = nextHealth;
			sessions = nextSessionsResponse.sessions;

			const preferredSessionId =
				activeSessionId.trim() ||
				sessionInput.trim() ||
				(options.selectFirstSession === false ? '' : nextSessionsResponse.sessions[0]?.id ?? '');

			if (preferredSessionId) {
				await selectSession(preferredSessionId);
			} else {
				clearSessionView();
			}
		} catch (error) {
			connectionError = toErrorMessage(error);
			clearSessionView();
		} finally {
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

	async function selectSession(sessionId: string): Promise<void> {
		const nextSessionId = sessionId.trim();
		if (!nextSessionId || !serverUrl) {
			return;
		}

		activeSessionId = nextSessionId;
		sessionInput = nextSessionId;
		liveAssistantText = '';
		reasoningText = '';
		messages = [];
		eventLog = [];
		activity = [];
		stopEvents?.();
		stopEvents = null;
		await refreshSessionSnapshot(nextSessionId);
		openSessionStream(nextSessionId);
	}

	async function refreshSessionSnapshot(sessionId: string): Promise<void> {
		if (!serverUrl || !sessionId) {
			return;
		}

		const currentToken = ++loadToken;
		isLoadingSession = true;
		connectionError = '';

		try {
			const [nextStatus, nextState, nextMessages, nextEventLog] = await Promise.all([
				getStatus(serverUrl, sessionId),
				getState(serverUrl, sessionId),
				getMessages(serverUrl, sessionId),
				getEventLog(serverUrl, sessionId)
			]);

			if (currentToken !== loadToken || activeSessionId !== sessionId) {
				return;
			}

			status = nextStatus;
			sessionState = nextState.state;
			messages = nextMessages.messages;
			eventLog = nextEventLog.events;
			lastEventId = nextEventLog.events.at(-1)?.id ?? lastEventId;
			activity = buildActivity(nextEventLog.events);
			reasoningText = extractReasoning(nextEventLog.events);

			if (liveAssistantText.trim()) {
				const lastAssistant = findLastAssistantText(nextMessages.messages);
				if (lastAssistant && lastAssistant.endsWith(liveAssistantText)) {
					liveAssistantText = '';
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

	function openSessionStream(sessionId: string): void {
		if (!serverUrl) {
			return;
		}

		stopEvents = openEventStream(
			serverUrl,
			sessionId,
			{
				onEvent: (event) => {
					void handleAgentEvent(event);
				},
				onError: (error) => {
					connectionError = error.message;
				}
			},
			{ lastEventId }
		);
	}

	async function handleAgentEvent(event: SseEvent): Promise<void> {
		if (event.id) {
			const parsed = Number(event.id);
			if (Number.isFinite(parsed)) {
				lastEventId = parsed;
			}
		}

		const payload = parseJson(event.data);

		if (event.event === 'assistant_text') {
			const chunk = asString(payload?.content);
			if (chunk) {
				liveAssistantText += chunk;
				await scrollTranscriptToEnd();
			}
			scheduleSnapshotRefresh(700);
			return;
		}

		if (event.event === 'state' && payload?.state && typeof payload.state === 'object') {
			sessionState = payload.state as ChumpState;
		}

		if (event.event === 'reasoning') {
			applyReasoningDelta(payload);
		}

		const nextItem = formatActivityItem(lastEventId, event.event, payload);
		if (nextItem) {
			activity = trimTail([...activity, nextItem], 80);
		}

		if (payload) {
			eventLog = trimTail(
				[
					...eventLog,
					{
						id: lastEventId,
						type: event.event,
						data: payload
					}
				],
				400
			);
		}

		if (event.event === 'user_message') {
			liveAssistantText = '';
		}

		scheduleSnapshotRefresh(event.event === 'user_message' ? 150 : 700);
		scheduleSessionsRefresh();
	}

	async function submitPrompt(): Promise<void> {
		const text = composerText.trim();
		if (!text || !serverUrl) {
			return;
		}

		const sessionId = await ensureActiveSession();
		if (!sessionId) {
			return;
		}

		composerText = '';
		isSending = true;
		actionNotice = '';
		activeRequestController = new AbortController();

		try {
			await streamChat(serverUrl, sessionId, text, activeRequestController.signal);
			scheduleSnapshotRefresh(120);
			scheduleSessionsRefresh();
		} catch (error) {
			if (!activeRequestController.signal.aborted) {
				connectionError = toErrorMessage(error);
			}
		} finally {
			isSending = false;
			activeRequestController = null;
		}
	}

	async function sendSteering(): Promise<void> {
		const text = composerText.trim();
		if (!text || !serverUrl) {
			return;
		}

		const sessionId = await ensureActiveSession();
		if (!sessionId) {
			return;
		}

		try {
			const result = await steerCurrentTurn(serverUrl, sessionId, text);
			composerText = '';
			actionNotice = result.status;
			scheduleSnapshotRefresh(120);
		} catch (error) {
			connectionError = toErrorMessage(error);
		}
	}

	async function abortTurn(): Promise<void> {
		if (!serverUrl || !activeSessionId) {
			return;
		}

		try {
			activeRequestController?.abort();
			const result = await abortCurrentTurn(serverUrl, activeSessionId);
			actionNotice = result.status;
			scheduleSnapshotRefresh(120);
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
		await selectSession(newSessionId);
		return newSessionId;
	}

	function clearSessionView(): void {
		stopEvents?.();
		stopEvents = null;
		status = null;
		sessionState = null;
		messages = [];
		eventLog = [];
		activity = [];
		reasoningText = '';
		liveAssistantText = '';
		lastEventId = 0;
		if (!sessions.some((session) => session.id === activeSessionId)) {
			activeSessionId = '';
		}
	}

	function scheduleSnapshotRefresh(delayMs = 700): void {
		clearTimeoutIfNeeded(snapshotTimer);
		const sessionId = activeSessionId;
		if (!sessionId) {
			return;
		}

		snapshotTimer = setTimeout(() => {
			snapshotTimer = null;
			void refreshSessionSnapshot(sessionId);
		}, delayMs);
	}

	function scheduleSessionsRefresh(delayMs = 500): void {
		clearTimeoutIfNeeded(sessionsTimer);
		sessionsTimer = setTimeout(() => {
			sessionsTimer = null;
			void refreshSessionsList();
		}, delayMs);
	}

	function handleComposerKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void submitPrompt();
		}
	}

	async function handleCommand(command: string, args: string): Promise<void> {
		if (command === '__open_model_picker') {
			openModelPicker();
			return;
		}

		if (!serverUrl || !activeSessionId) {
			pushToast('Not connected', 'error');
			return;
		}

		try {
			switch (command) {
				case 'model': {
					const separator = args.indexOf('/');
					if (separator <= 0 || separator === args.length - 1) {
						pushToast('Usage: model provider/model', 'error');
						return;
					}
					const provider = args.slice(0, separator);
					const model = args.slice(separator + 1);
					const result = await setModel(serverUrl, activeSessionId, provider, model);
					status = result;
					closeModelPicker();
					pushToast(`Switched to ${provider}/${model}`, 'success');
					break;
				}
				case 'skill': {
					const result = await loadSkill(serverUrl, activeSessionId, args);
					pushToast(`Loaded skill: ${result.name}`, 'success');
					break;
				}
				case 'clear': {
					const result = await clearMessages(serverUrl, activeSessionId);
					await refreshSessionSnapshot(activeSessionId);
					pushToast('Chat cleared', 'success');
					break;
				}
				case 'new': {
					await createFreshSession();
					pushToast('New session started', 'success');
					break;
				}
			}
		} catch (error) {
			pushToast(toErrorMessage(error), 'error');
		}
	}

	async function scrollTranscriptToEnd(): Promise<void> {
		await tick();
		transcriptElement?.scrollTo({ top: transcriptElement.scrollHeight, behavior: 'smooth' });
	}

	function applyReasoningDelta(payload: Record<string, unknown> | null): void {
		if (!payload) {
			return;
		}

		const fragment = asString(payload.text);
		if (!fragment) {
			return;
		}

		reasoningText = clipTail(`${reasoningText}${fragment}`, 1200);
	}

	function connectDetectedServer(): void {
		if (!detectedServerUrl()) {
			return;
		}

		serverUrl = detectedServerUrl() ?? '';
		void connectToServer();
	}

	function parseJson(value: string): Record<string, unknown> | null {
		try {
			const parsed = JSON.parse(value) as unknown;
			return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
		} catch {
			return null;
		}
	}

	function asString(value: unknown): string {
		return typeof value === 'string' ? value : '';
	}

	function asRecord(value: unknown): Record<string, unknown> | null {
		return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
	}

	function asArgsRecord(value: unknown): Record<string, unknown> {
		const direct = asRecord(value);
		if (direct) {
			return direct;
		}

		if (typeof value === 'string') {
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

	function buildTranscript(source: StoredMessage[], liveText: string, events: StoredEvent[]): TranscriptMessage[] {
		if (hasExactTranscript(events)) {
			return buildTranscriptFromEvents(events);
		}

		const items: TranscriptMessage[] = [];

		for (let i = 0; i < source.length; i++) {
			const message = source[i];
			let blocks = formatMessageBlocks(message.content);

			if (message.role === 'tool' || message.role === 'user') {
				let allMerged = true;
				for (const block of blocks) {
					if (block.kind === 'tool-result' && block.toolCallId) {
						let found = false;
						for (const item of items) {
							for (const parentBlock of item.blocks) {
								if (parentBlock.kind === 'tool-call' && parentBlock.toolCallId === block.toolCallId) {
									parentBlock.result = block.result;
									parentBlock.error = block.error;
									parentBlock.hasResult = true;
									found = true;
									break;
								}
							}
							if (found) break;
						}
						if (!found) allMerged = false;
						else block.hasResult = true; // Mark as merged
					} else {
						allMerged = false;
					}
				}
				
				blocks = blocks.filter(b => !b.hasResult);
				if (blocks.length === 0 && allMerged) continue;
			}

			items.push({
				id: `${i}-${message.role}`,
				role: message.role,
				label: formatRole(message.role),
				blocks: blocks
			});
		}

		if (liveText.trim()) {
			items.push({
				id: `live-${liveText.length}`,
				role: 'assistant',
				label: 'Assistant',
				blocks: [{ kind: 'text', text: liveText }],
				live: true
			});
		}

		return items;
	}

	function buildTranscriptFromEvents(events: StoredEvent[]): TranscriptMessage[] {
		const items: TranscriptMessage[] = [];
		let assistantBuffer = '';
		let reasoningBuffer = '';
		let sequence = 0;

		const flushReasoning = () => {
			const text = cleanReasoningText(reasoningBuffer);
			if (!text) {
				reasoningBuffer = '';
				return;
			}

			items.push({
				id: `reasoning-${sequence++}`,
				role: 'reasoning',
				label: 'Reasoning',
				blocks: [{ kind: 'text', text }]
			});
			reasoningBuffer = '';
		};

		const flushAssistant = () => {
			const text = assistantBuffer.trim();
			if (!text) {
				assistantBuffer = '';
				return;
			}

			items.push({
				id: `assistant-${sequence++}`,
				role: 'assistant',
				label: 'Assistant',
				blocks: [{ kind: 'text', text }]
			});
			assistantBuffer = '';
		};

		for (const event of events) {
			if (event.type !== 'assistant_text') {
				flushAssistant();
			}

			switch (event.type) {
				case 'user_message': {
					flushReasoning();
					const text = asString(event.data.content).trim();
					if (!text) break;
					items.push({
						id: `user-${sequence++}`,
						role: 'user',
						label: 'You',
						blocks: [{ kind: 'text', text }]
					});
					break;
				}
				case 'reasoning': {
					reasoningBuffer = mergeReasoningText(reasoningBuffer, asString(event.data.text));
					break;
				}
				case 'assistant_text': {
					flushReasoning();
					assistantBuffer += asString(event.data.content);
					break;
				}
				case 'tool_call': {
					flushReasoning();
					const block = formatEventToolCall(event.data);
					if (block) {
						items.push({
							id: `tool-call-${sequence++}`,
							role: 'assistant',
							label: 'Assistant',
							blocks: [block]
						});
					}
					break;
				}
				case 'tool_result': {
					flushReasoning();
					mergeToolResultIntoTranscript(items, event.data);
					break;
				}
			}
		}

		flushAssistant();
		flushReasoning();
		return items;
	}

	function hasExactTranscript(events: StoredEvent[]): boolean {
		return events.some((event) => event.type === 'user_message' || event.type === 'assistant_text');
	}

	function formatEventToolCall(payload: Record<string, unknown>): TranscriptBlock | null {
		const toolName = asString(payload.name) || asString(payload.tool) || 'tool';
		const args = asArgsRecord(payload.args ?? payload.payload ?? {});
		let headerTitle = toolName;
		let isDiff = false;
		let diffContent = '';

		if (toolName === 'bash' || toolName === 'execute_command') {
			const cmd = asString(args.command) || asString(args.cmd) || '';
			if (cmd) headerTitle = `$ ${cmd}`;
		} else if (toolName === 'read_file' || toolName === 'view_file') {
			const file = asString(args.file_path) || asString(args.path) || '';
			if (file) headerTitle = file.split('/').pop() || file;
		} else if (toolName === 'edit_file' || toolName === 'apply_patch' || toolName === 'write_file' || toolName === 'create_file') {
			const file = asString(args.file_path) || asString(args.path) || '';
			if (file) headerTitle = file.split('/').pop() || file;
		}

		if (
			typeof args.patch === 'string' ||
			typeof args.patchText === 'string' ||
			typeof args.patch_text === 'string' ||
			typeof args.diff === 'string' ||
			typeof args.file_diff === 'string'
		) {
			isDiff = true;
			diffContent = (args.patch || args.patchText || args.patch_text || args.diff || args.file_diff) as string;
		} else if (typeof args.content === 'string' && (toolName === 'write_file' || toolName === 'create_file')) {
			isDiff = true;
			diffContent = `+++ ${headerTitle}\n@@ -0,0 +1 @@\n` + args.content.split('\n').map((l) => `+${l}`).join('\n');
		}

		return {
			kind: 'tool-call',
			text: `${toolName}\n${stringifyValue(args)}`,
			toolName: headerTitle,
			originalToolName: toolName,
			args,
			isDiff,
			diffContent
		};
	}

	function mergeToolResultIntoTranscript(items: TranscriptMessage[], payload: Record<string, unknown>): void {
		const toolName = asString(payload.tool_name) || asString(payload.tool) || asString(payload.name);
		for (let index = items.length - 1; index >= 0; index -= 1) {
			const item = items[index];
			for (const block of item.blocks) {
				if (block.kind === 'tool-call' && block.originalToolName === toolName && !block.hasResult) {
					block.result = payload.preview ?? payload.error ?? payload.result ?? payload.output;
					block.metadata = asRecord(payload.metadata) ?? undefined;
					block.error = payload.is_error === true || payload.ok === false || payload.status === 'error';
					block.hasResult = true;
					return;
				}
			}
		}

		items.push({
			id: `tool-result-fallback-${items.length}`,
			role: 'assistant',
			label: 'Assistant',
			blocks: [
				{
					kind: 'tool-result',
					text: stringifyValue(payload.preview ?? payload.error ?? payload.result ?? payload.output),
					error: payload.is_error === true || payload.ok === false || payload.status === 'error',
					result: payload.preview ?? payload.error ?? payload.result ?? payload.output,
					originalToolName: toolName
				}
			]
		});
	}

	function mergeReasoningText(existing: string, incoming: string): string {
		const normalized = normalizeReasoningChunk(incoming, existing.length === 0);
		if (!normalized.trim()) {
			return existing;
		}
		const appended = appendNovelSuffix(existing, normalized);
		if (!appended) {
			return existing;
		}
		return existing + appended;
	}

	function normalizeReasoningChunk(value: string, trimStart: boolean): string {
		const normalized = value
			.replace(/\r\n?/g, '\n')
			.replace(/[^\S\n]+/g, ' ')
			.replace(/ *\n */g, '\n');
		return trimStart ? normalized.trimStart() : normalized;
	}

	function appendNovelSuffix(existing: string, incoming: string): string {
		if (!incoming) return '';
		if (!existing) return incoming;
		if (existing.endsWith(incoming)) return '';
		if (incoming.startsWith(existing)) return incoming.slice(existing.length);

		const tail = existing.slice(-Math.min(existing.length, incoming.length, 1024));
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
			.replace(/\r\n?/g, '\n')
			.replace(/[^\S\n]+/g, ' ')
			.replace(/ *\n */g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		if (!normalized) return '';

		return normalized
			.split('\n')
			.map((line) => dedupeAdjacentWords(line))
			.join('\n');
	}

	function dedupeAdjacentWords(value: string): string {
		const words = value.split(' ');
		const cleaned: string[] = [];
		for (const word of words) {
			const previous = cleaned[cleaned.length - 1];
			if (previous && stripWord(previous) === stripWord(word)) {
				continue;
			}
			cleaned.push(word);
		}
		return cleaned.join(' ');
	}

	function stripWord(value: string): string {
		return value.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '');
	}

	function reasoningSummary(text: string): string {
		const words = text.trim().split(/\s+/).filter(Boolean).length;
		const seconds = Math.max(1, Math.round(words / 35));
		return `Thought for ${seconds} second${seconds === 1 ? '' : 's'}`;
	}

	function formatMessageBlocks(content: StoredMessage['content']): TranscriptBlock[] {
		if (typeof content === 'string') {
			return [{ kind: 'text', text: content }];
		}

		const blocks: TranscriptBlock[] = [];
		for (const part of content as MessagePart[]) {
			const candidate = part as Record<string, unknown>;
			const kind = typeof candidate.type === 'string' ? candidate.type : '';

			if (kind === 'text') {
				blocks.push({ kind: 'text', text: asString(candidate.text) });
				continue;
			}
			if (kind === 'tool_call') {
				const toolCall = asRecord(candidate.tool_call);
				const args = asArgsRecord(toolCall?.arguments ?? {});
				const toolName = asString(toolCall?.name) || 'tool';
				
				let isDiff = false;
				let diffContent = '';
				let headerTitle = toolName;

				if (toolName === 'bash' || toolName === 'execute_command') {
					const cmd = asString(args?.command) || asString(args?.cmd) || '';
					if (cmd) headerTitle = `$ ${cmd}`;
				} else if (toolName === 'read_file' || toolName === 'view_file') {
					const file = asString(args?.file_path) || asString(args?.path) || '';
					if (file) headerTitle = file.split('/').pop() || file;
				} else if (toolName === 'edit_file' || toolName === 'apply_patch' || toolName === 'write_file' || toolName === 'create_file') {
					const file = asString(args?.file_path) || asString(args?.path) || '';
					if (file) headerTitle = file.split('/').pop() || file;
				}

				if (
					args &&
					(
						typeof args.patch === 'string' ||
						typeof args.patchText === 'string' ||
						typeof args.patch_text === 'string' ||
						typeof args.diff === 'string' ||
						typeof args.file_diff === 'string'
					)
				) {
					isDiff = true;
					diffContent = (args.patch || args.patchText || args.patch_text || args.diff || args.file_diff) as string;
				} else if (args && typeof args.content === 'string' && (toolName === 'write_file' || toolName === 'create_file')) {
					isDiff = true;
					diffContent = `+++ ${headerTitle}\n@@ -0,0 +1 @@\n` + args.content.split('\n').map(l => `+${l}`).join('\n');
				}

				blocks.push({
					kind: 'tool-call',
					text: `${toolName}\n${stringifyValue(args)}`,
					toolCallId: asString(toolCall?.id),
					toolName: headerTitle,
					originalToolName: toolName,
					args: args ?? undefined,
					isDiff,
					diffContent
				});
				continue;
			}
			if (kind === 'tool_result') {
				const toolResult = asRecord(candidate.tool_result);
				blocks.push({
					kind: 'tool-result',
					toolCallId: asString(toolResult?.tool_call_id),
					text: stringifyValue(toolResult?.result),
					error: toolResult?.is_error === true,
					result: toolResult?.result
				});
				continue;
			}
			if (kind === 'image') {
				const mediaType = asString(candidate.media_type);
				blocks.push({ kind: 'image', text: mediaType ? `image · ${mediaType}` : 'image' });
				continue;
			}
			blocks.push({ kind: 'text', text: stringifyValue(part) });
		}

		return blocks.length > 0 ? blocks : [{ kind: 'text', text: '' }];
	}

	function buildActivity(events: StoredEvent[]): ActivityItem[] {
		return trimTail(
			events
				.map((event) => formatActivityItem(event.id, event.type, event.data))
				.filter((item): item is ActivityItem => item !== null),
			80
		);
	}

	function formatActivityItem(
		id: number,
		type: string,
		payload: Record<string, unknown> | null
	): ActivityItem | null {
		if (!payload) {
			return null;
		}

		if (type === 'user_message') {
			const content = asString(payload.content);
			return {
				id: `${id}`,
				label: payload.steered === true ? 'Steer' : 'User',
				detail: content || 'message',
				tone: 'default'
			};
		}

		if (type === 'tool_call') {
			const name = asString(payload.name) || asString(payload.tool) || 'tool';
			const detail = stringifyValue(payload.args ?? payload.payload ?? {});
			return { id: `${id}`, label: `Tool · ${name}`, detail, tone: 'default' };
		}

		if (type === 'tool_result') {
			const name = asString(payload.tool_name) || asString(payload.tool) || 'tool';
			const detail = stringifyValue(payload.preview ?? payload.error ?? payload.result ?? payload.output ?? 'done');
			const isError = payload.is_error === true || payload.ok === false || payload.status === 'error';
			return { id: `${id}`, label: `Result · ${name}`, detail, tone: isError ? 'error' : 'muted' };
		}

		if (type === 'status') {
			const phase = asString(payload.phase) || 'status';
			const step = payload.step;
			return {
				id: `${id}`,
				label: 'Status',
				detail: typeof step === 'number' ? `${phase} · step ${step}` : phase,
				tone: 'muted'
			};
		}

		return null;
	}

	function extractReasoning(events: StoredEvent[]): string {
		let text = '';
		for (const event of events) {
			if (event.type !== 'reasoning') {
				continue;
			}
			const fragment = asString(event.data.text);
			if (fragment) {
				text = clipTail(`${text}${fragment}`, 1200);
			}
		}
		return text;
	}

	function findLastAssistantText(source: StoredMessage[]): string {
		for (let index = source.length - 1; index >= 0; index -= 1) {
			const message = source[index];
			if (message.role !== 'assistant') {
				continue;
			}
			const blocks = formatMessageBlocks(message.content)
				.filter((block) => block.kind === 'text')
				.map((block) => block.text)
				.join('\n');
			if (blocks.trim()) {
				return blocks;
			}
		}
		return '';
	}

	function formatRole(role: string): string {
		if (role === 'assistant') {
			return 'Assistant';
		}
		if (role === 'user') {
			return 'You';
		}
		if (role === 'tool') {
			return 'Tool';
		}
		return role.charAt(0).toUpperCase() + role.slice(1);
	}

	function formatDate(value: number | null): string {
		if (!value) {
			return '—';
		}
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(value * 1000);
	}

	function stringifyValue(value: unknown): string {
		if (typeof value === 'string') {
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

	function clipTail(value: string, size: number): string {
		return value.length <= size ? value : value.slice(value.length - size);
	}

	function clearTimeoutIfNeeded(timer: ReturnType<typeof setTimeout> | null): void {
		if (timer) {
			clearTimeout(timer);
		}
	}
</script>

<svelte:head>
	<title>chump web</title>
</svelte:head>

<div class="flex h-[100dvh] bg-[#1c1c1e] text-[#d4d4d4] font-sans overflow-hidden selection:bg-[#3a4515] selection:text-white relative">
	<!-- Mobile overlay -->
	{#if sidebarOpen}
		<button class="fixed inset-0 bg-black/50 z-20 md:hidden" onclick={closeSidebar} aria-label="Close sidebar"></button>
	{/if}

	<SessionsSidebar
		sessions={sessions}
		activeSessionId={activeSessionId}
		bind:sessionInput
		health={health}
		serverUrl={serverUrl}
		isConnecting={isConnecting}
		canConnect={canConnect}
		onCreateSession={() => void createFreshSession()}
		onOpenSession={() => void openTypedSession()}
		onSelectSession={(id) => { closeSidebar(); void selectSession(id); }}
		onOpenConnectModal={openConnectModal}
		onConnect={() => void connectToServer()}
		{sessionTitle}
		{formatDate}
		open={sidebarOpen}
	/>

	<!-- Center: Chat/Editor Area -->
	<main class="flex-1 flex flex-col bg-[#1c1c1e] relative min-w-0">
		<!-- Header Tabs -->
		<div class="flex items-center border-b border-[#2b2b2d] bg-[#18181a] overflow-x-auto hide-scrollbar">
			<div class="flex-1 flex items-center px-3 md:px-4 py-2 gap-3 min-w-0">
				<button class="md:hidden text-[#858585] hover:text-[#cccccc] transition-colors flex-shrink-0" onclick={toggleSidebar} aria-label="Toggle sidebar">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
				</button>
				<span class="truncate text-[#cccccc] text-[13px]">{selectedSession ? sessionTitle(selectedSession) : 'No Session'}</span>
			</div>

			<div class="flex items-center gap-2 px-2 md:px-4 flex-shrink-0">
				<button aria-label="Create new session" class="w-7 h-7 flex items-center justify-center text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e] rounded-[6px] transition-colors" onclick={() => void createFreshSession()}>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4"></path></svg>
				</button>
				{#if isSending}
					<button class="px-2 md:px-4 py-1 bg-[#4d4d4d] hover:bg-[#5a5a5a] text-white rounded-[4px] transition-colors text-[11px] md:text-[12px]" onclick={() => void abortTurn()}>Abort</button>
				{/if}
			</div>
		</div>

		<TranscriptPane
			{transcript}
			bind:transcriptElement
			{isSending}
			{expandedBlocks}
			{expandedReasoning}
			onToggleBlock={toggleBlock}
			onToggleReasoning={toggleReasoning}
			{reasoningSummary}
		/>

		<ChatComposer
			bind:composerText
			{activeSessionId}
			{canSteer}
			{canSend}
			{isSending}
			skills={currentSkills}
			currentModel={currentModel}
			workspaceRoot={displayWorkspace}
			onSend={() => void submitPrompt()}
			onSteer={() => void sendSteering()}
			onCommand={handleCommand}
		/>
	</main>
</div>

<!-- Connect Modal -->
{#if connectModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
		<div class="bg-[#1c1c1e] border border-[#313133] rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-4 py-3 border-b border-[#313133]">
				<span class="text-[14px] font-medium text-[#cccccc]">Connect to Server</span>
				<button class="text-[#858585] hover:text-[#cccccc] transition-colors" onclick={closeConnectModal} aria-label="Close">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
				</button>
			</div>
			<div class="p-4 space-y-4">
			<div>
				<label for="connect-url" class="block text-[11px] font-mono text-[#858585] mb-1.5 uppercase tracking-wider">Server URL</label>
				<input
					id="connect-url"
					bind:value={serverUrl}
					placeholder="http://127.0.0.1:8080"
					onkeydown={(e) => e.key === 'Enter' && canConnect && !isConnecting && (void connectToServer(), closeConnectModal())}
					class="w-full bg-[#252526] border border-[#313133] focus:border-[#b8dd35] focus:outline-none rounded-lg px-3 py-2.5 text-[13px] text-[#cccccc] placeholder:text-[#6a6a6a]"
				/>
			</div>
				{#if connectionError}
					<div class="text-[12px] text-[#f48771]">{connectionError}</div>
				{/if}
				<button
					onclick={() => { void connectToServer(); closeConnectModal(); }}
					disabled={!canConnect || isConnecting}
					class="w-full py-2.5 bg-[#b8dd35] hover:bg-[#c4e63f] disabled:opacity-40 disabled:hover:bg-[#b8dd35] text-[#18181a] font-medium rounded-lg transition-colors text-[13px]"
				>
					{isConnecting ? 'Connecting...' : 'Connect'}
				</button>
			</div>
		</div>
	</div>
{/if}

<Toasts bind:toasts />

<!-- Model Picker Modal -->
{#if modelPickerOpen}
	<div class="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
		<div class="bg-[#1c1c1e] border border-[#313133] rounded-t-xl md:rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden max-h-[80vh]">
			<div class="flex items-center justify-between px-4 py-3 border-b border-[#313133]">
				<span class="text-[14px] font-medium text-[#cccccc]">Switch Model</span>
				<button class="text-[#858585] hover:text-[#cccccc] transition-colors" onclick={closeModelPicker} aria-label="Close">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
				</button>
			</div>
			<div class="overflow-y-auto py-1">
				{#each MODEL_PRESETS as m (m.label)}
					<button
						onclick={() => handleCommand('model', `${m.provider}/${m.model}`)}
						class="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-[#2a2d2e] transition-colors"
						type="button"
					>
						<div class="flex flex-col min-w-0">
							<span class="text-[13px] text-[#cccccc]">{m.label}</span>
						</div>
						{#if m.label === currentModel}
							<span class="text-[10px] px-1.5 py-0.5 rounded bg-[#3a4515] text-[#b8dd35] flex-shrink-0">active</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Hide scrollbar for tabs */
	.hide-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.hide-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	
	/* VS Code inspired custom scrollbar */
	::-webkit-scrollbar {
		width: 10px;
		height: 10px;
	}
	::-webkit-scrollbar-track {
		background: transparent;
	}
	::-webkit-scrollbar-thumb {
		background: #424242;
		border: 2px solid transparent;
		background-clip: padding-box;
	}
	::-webkit-scrollbar-thumb:hover {
		background: #4f4f4f;
		border: 2px solid transparent;
		background-clip: padding-box;
	}
</style>
