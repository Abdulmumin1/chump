<script lang="ts">
	let {
		composerText = $bindable(),
		activeSessionId,
		canSteer,
		canSend,
		isSending,
		onSend,
		onSteer,
		onKeydown
	} = $props<{
		composerText: string;
		activeSessionId: string;
		canSteer: boolean;
		canSend: boolean;
		isSending: boolean;
		onSend: () => void;
		onSteer: () => void;
		onKeydown: (event: KeyboardEvent) => void;
	}>();
</script>

<div class="w-full px-4 md:px-8 pb-6 pt-2 bg-[#1c1c1e]">
	<div class="max-w-5xl mx-auto bg-[#242426] border border-[#313133] rounded-[8px] flex flex-col focus-within:border-[#4d4d4d] transition-colors shadow-lg">
		<textarea
			bind:value={composerText}
			rows="2"
			placeholder="Message the agent..."
			onkeydown={onKeydown}
			class="w-full bg-transparent border-none rounded-t-[8px] px-4 py-3 text-[14px] text-[#cccccc] focus:outline-none resize-none min-h-[60px] max-h-[300px] placeholder:text-[#6a6a6a]"
		></textarea>

		<div class="flex justify-between items-center px-3 py-2 border-t border-[#313133] rounded-b-[8px]">
			<div class="flex items-center gap-2">
				{#if activeSessionId && composerText.trim()}
					<button class="px-3 py-1 text-[12px] bg-[#333333] hover:bg-[#404040] text-[#cccccc] rounded-[4px] transition-colors disabled:opacity-50" onclick={onSteer} disabled={!canSteer}>Steer</button>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<span class="text-[12px] font-medium text-[#6a6a6a] mr-2 tracking-wide">⌘ Enter</span>
				<button aria-label="Send message" class="w-8 h-8 flex items-center justify-center bg-[#2b2b2b] text-[#858585] hover:bg-[#3b3b3b] hover:text-[#cccccc] rounded-[6px] transition-colors disabled:opacity-50" onclick={onSend} disabled={!canSend || isSending}>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
				</button>
			</div>
		</div>
	</div>
</div>
