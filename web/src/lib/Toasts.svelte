<script lang="ts">
	let {
		toasts = $bindable()
	} = $props<{
		toasts: Array<{
			id: number;
			message: string;
			type?: 'default' | 'success' | 'error';
		}>;
	}>();

	function remove(id: number) {
		toasts = toasts.filter((t: { id: number }) => t.id !== id);
	}
</script>

<div class="fixed bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0 z-50 flex flex-col gap-2 pointer-events-none">
	{#each toasts as toast (toast.id)}
		<button
			onclick={() => remove(toast.id)}
			class="pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-[13px] transition-all duration-200 opacity-0 animate-toast-in
				{toast.type === 'error' ? 'bg-[#331a1a] border-[#f48771]/30 text-[#f48771]' : 
				 toast.type === 'success' ? 'bg-[#1a331a] border-[#7ee787]/30 text-[#7ee787]' : 
				 'bg-[#242426] border-[#313133] text-[#cccccc]'}"
			type="button"
		>
			<span>{toast.message}</span>
			<svg class="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
		</button>
	{/each}
</div>

<style>
	@keyframes toast-in {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}
	.animate-toast-in {
		animation: toast-in 0.2s ease-out forwards;
	}
</style>
