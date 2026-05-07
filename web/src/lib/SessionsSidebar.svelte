<script lang="ts">
	let {
		sessions,
		activeSessionId,
		sessionInput = $bindable(),
		health,
		serverUrl = '',
		isConnecting = false,
		canConnect = false,
		onCreateSession,
		onOpenSession,
		onSelectSession,
		onOpenConnectModal,
		onConnect,
		sessionTitle,
		formatDate,
		open = false
	} = $props<{
		sessions: Array<any>;
		activeSessionId: string;
		sessionInput: string;
		health: unknown;
		serverUrl?: string;
		isConnecting?: boolean;
		canConnect?: boolean;
		onCreateSession: () => void;
		onOpenSession: () => void;
		onSelectSession: (id: string) => void;
		onOpenConnectModal: () => void;
		onConnect: () => void;
		sessionTitle: (session: any) => string;
		formatDate: (value: number | null) => string;
		open?: boolean;
	}>();

	let isConnected = $derived(!!health);
	let serverDisplay = $derived(() => {
		try {
			const url = new URL(serverUrl);
			return url.host;
		} catch {
			return serverUrl || '—';
		}
	});
</script>

<aside class="{open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:static inset-y-0 left-0 w-[260px] flex flex-col bg-[#18181a] border-r border-[#2b2b2d] flex-shrink-0 z-30 transition-transform duration-200 ease-out">
	<div class="p-3 flex items-center justify-between border-b border-[#2b2b2d]">
		<div class="flex items-center gap-2">
			<span class="text-[13px] font-medium text-[#cccccc]">Home</span>
		</div>
	</div>

	<div class="p-2 border-b border-[#2b2b2d]">
		<input bind:value={sessionInput} onkeydown={(e) => e.key === 'Enter' && onOpenSession()} placeholder="Open session ID..." class="w-full bg-[#252526] border border-transparent focus:border-[#b8dd35] focus:outline-none rounded-sm px-2 py-1 text-[12px] text-[#cccccc] placeholder:text-[#858585]" />
	</div>

	<div class="flex-1 overflow-y-auto py-2 space-y-0.5">
		{#if sessions.length === 0}
			<div class="px-4 py-2 text-[12px] text-[#858585]">No sessions found.</div>
		{:else}
			{#each sessions as session (session.id)}
				<button
					class="w-full text-left px-3 py-1.5 flex flex-col gap-0.5 group {session.id === activeSessionId ? 'bg-[#37373d] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'}"
					onclick={() => onSelectSession(session.id)}
				>
					<div class="flex justify-between items-center w-full">
						<span class="text-[13px] truncate pr-2 {session.id === activeSessionId ? 'font-medium' : ''}">{sessionTitle(session)}</span>
						{#if session.active || session.connections > 0}
							<span class="w-1.5 h-1.5 rounded-full bg-[#4CAF50] flex-shrink-0"></span>
						{/if}
					</div>
					<div class="flex justify-between items-center w-full text-[11px] {session.id === activeSessionId ? 'text-[#a9a9a9]' : 'text-[#858585]'}">
						<span class="truncate pr-2 opacity-80">{session.id.split('-')[0]}...</span>
						<span>{formatDate(session.updated_at ?? session.created_at).split(',')[0]}</span>
					</div>
				</button>
			{/each}
		{/if}
	</div>

	<!-- Sticky Footer: Connection status & controls -->
	<div class="border-t border-[#2b2b2d] bg-[#18181a] p-2 space-y-2">
		{#if isConnected}
			<div class="flex items-center gap-2 px-2 py-1">
				<span class="w-1.5 h-1.5 rounded-full bg-[#b8dd35] flex-shrink-0"></span>
				<span class="text-[11px] font-mono text-[#858585] truncate">{serverDisplay()}</span>
			</div>
		{:else}
			<button
				onclick={onOpenConnectModal}
				class="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#252526] hover:bg-[#2a2d2e] border border-[#313133] rounded-lg transition-colors text-[12px] text-[#cccccc]"
			>
				<svg class="w-3.5 h-3.5 text-[#858585]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
				<span>{isConnecting ? 'Connecting...' : 'Connect'}</span>
			</button>
		{/if}
	</div>
</aside>
