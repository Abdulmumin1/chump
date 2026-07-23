<script lang="ts">
	import { removeToast, toastStore, type ToastItem } from '$lib/toast-store.svelte';

	let {
		toasts = $bindable()
	}: {
		toasts?: ToastItem[];
	} = $props();

	const activeToasts = $derived(toasts ?? toastStore.items);

	function remove(id: number) {
		if (toasts) {
			toasts = toasts.filter((t) => t.id !== id);
		} else {
			removeToast(id);
		}
	}
</script>

<div class="fixed top-4 left-1/2 -translate-x-1/2 md:top-auto md:bottom-4 md:left-auto md:right-4 md:translate-x-0 z-50 flex flex-col items-center md:items-end gap-2 pointer-events-none" aria-live="polite">
	{#each activeToasts as toast (toast.id)}
		<button
			onclick={() => remove(toast.id)}
			class="pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-full border text-[13px] font-medium transition-all duration-300 opacity-0 animate-toast-in whitespace-nowrap max-w-[90vw] overflow-hidden text-ellipsis shadow-lg
				{toast.type === 'error' ? 'bg-bg-toast-err border-error/25 text-error' : 
				 toast.type === 'success' ? 'bg-bg-toast-ok border-success/25 text-text-success' : 
				 'bg-bg-surface border-border-default text-text-secondary'}"
			type="button"
		>
			{#if toast.type === 'success'}
				<svg class="w-4 h-4 text-text-success shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
				</svg>
			{:else if toast.type === 'error'}
				<svg class="w-4 h-4 text-error shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
				</svg>
			{:else}
				<svg class="w-4 h-4 text-text-secondary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
				</svg>
			{/if}
			<span class="truncate">{toast.message}</span>
			<svg class="w-3.5 h-3.5 opacity-40 hover:opacity-100 transition-opacity ml-1.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
		</button>
	{/each}
</div>

<style>
	@keyframes toast-in-top {
		from { opacity: 0; transform: translateY(-16px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes toast-in-bottom {
		from { opacity: 0; transform: translateY(-16px); }
		to { opacity: 1; transform: translateY(0); }
	}
	.animate-toast-in {
		animation: toast-in-top 0.28s cubic-bezier(0.21, 1.02, 0.43, 1.01) forwards;
	}
	@media (min-width: 768px) {
		.animate-toast-in {
			animation: toast-in-bottom 0.28s cubic-bezier(0.21, 1.02, 0.43, 1.01) forwards;
		}
	}
</style>
