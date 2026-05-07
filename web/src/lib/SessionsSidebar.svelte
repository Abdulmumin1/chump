<script lang="ts">
	let {
		sessions,
		activeSessionId,
		sessionInput = $bindable(),
		health,
		onCreateSession,
		onOpenSession,
		onSelectSession,
		sessionTitle,
		formatDate,
		open = false
	} = $props<{
		sessions: Array<any>;
		activeSessionId: string;
		sessionInput: string;
		health: unknown;
		onCreateSession: () => void;
		onOpenSession: () => void;
		onSelectSession: (id: string) => void;
		sessionTitle: (session: any) => string;
		formatDate: (value: number | null) => string;
		open?: boolean;
	}>();
</script>

<aside class="{open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:static inset-y-0 left-0 w-[260px] flex flex-col bg-[#18181a] border-r border-[#2b2b2d] flex-shrink-0 z-30 transition-transform duration-200 ease-out">
	<div class="p-3 flex items-center justify-between border-b border-[#2b2b2d]">
		<div class="flex items-center gap-2">
			<span class="text-[13px] font-medium text-[#cccccc]">Home</span>
		</div>
		<button aria-label="Create new session" class="text-[#858585] hover:text-[#cccccc] transition-colors" onclick={onCreateSession} disabled={!health}>
			<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4"></path></svg>
		</button>
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
</aside>
