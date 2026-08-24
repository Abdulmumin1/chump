<script lang="ts">
	import { tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import BrailleSpinner from '$lib/BrailleSpinner.svelte';

	let {
		open = false,
		serverUrl = $bindable(),
		serverToken = $bindable(),
		canConnect,
		isConnecting,
		connectionError = '',
		qrScannerOpen = false,
		qrScannerError = '',
		qrVideoElement = $bindable(),
		onClose,
		onConnect,
		onStartQrScanner,
		onStopQrScanner
	} = $props<{
		open: boolean;
		serverUrl: string;
		serverToken: string;
		canConnect: boolean;
		isConnecting: boolean;
		connectionError?: string;
		qrScannerOpen?: boolean;
		qrScannerError?: string;
		qrVideoElement: HTMLVideoElement | null;
		onClose: () => void;
		onConnect: () => void | Promise<void>;
		onStartQrScanner: () => void | Promise<void>;
		onStopQrScanner: () => void;
	}>();

	let connectUrlInput = $state<HTMLInputElement | null>(null);
	const connectButtonLabel = $derived(
		serverToken.trim() ? 'Connect to local service' : 'Connect directly'
	);

	$effect(() => {
		if (!open) {
			return;
		}

		void tick().then(() => {
			connectUrlInput?.focus();
		});
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex h-full w-full items-center justify-center border-none bg-bg-overlay/60 p-4 backdrop-blur-[2px]"
		transition:fade={{ duration: 150 }}
		onclick={onClose}
	>
		<div
			class="flex w-full max-w-[320px] flex-col overflow-hidden rounded-lg border border-border-default bg-bg-surface shadow-2xl"
			transition:fly={{ y: 8, duration: 150 }}
			onclick={(event) => event.stopPropagation()}
		>
			<div class="space-y-1.5 p-1.5">
				<div class="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
					Chump server
				</div>
				<div class="space-y-1.5 rounded-md border border-border-subtle bg-bg-elevated p-1.5">
					<p class="px-0.5 text-[10px] leading-relaxed text-text-tertiary">
						Use one URL. Add a token for the shared local service, or leave it blank for a direct server.
					</p>
					<div class="px-0.5 text-[10px] font-medium text-text-secondary">
						Mode: {serverToken.trim() ? 'local service' : 'direct server'}
					</div>
					<label for="server-url-input" class="sr-only">Server URL</label>
					<input
						bind:this={connectUrlInput}
						id="server-url-input"
						bind:value={serverUrl}
						placeholder="http://127.0.0.1:38136"
						class="w-full rounded-sm border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-muted focus:outline-none"
						autocomplete="off"
						onkeydown={(event) =>
							event.key === 'Enter' &&
							canConnect &&
							!isConnecting &&
							(void onConnect())}
					/>
					<label for="server-token-input" class="sr-only">Token</label>
					<input
						id="server-token-input"
						bind:value={serverToken}
						placeholder="Token (optional)"
						type="password"
						class="w-full rounded-sm border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-muted focus:outline-none"
						autocomplete="off"
						onkeydown={(event) =>
							event.key === 'Enter' &&
							canConnect &&
							!isConnecting &&
							(void onConnect())}
					/>
					<button
						type="button"
						onclick={() => void onConnect()}
						disabled={!canConnect || isConnecting}
						class="flex h-7 w-full items-center justify-center rounded-sm bg-accent px-2.5 text-[11px] font-bold text-text-on-accent disabled:opacity-60"
					>
						{#if isConnecting}
							<BrailleSpinner class="font-mono text-[14px]" />
						{:else}
							{connectButtonLabel}
						{/if}
					</button>

					<div class="pt-1">
					<button
						onclick={() => void onStartQrScanner()}
						class="group flex w-full items-center justify-center gap-2 rounded-md border border-border-subtle bg-bg-elevated py-1.5 text-text-secondary transition-colors hover:bg-bg-hover active:scale-[0.98]"
					>
						<svg
							class="h-4 w-4 text-text-tertiary transition-colors group-hover:text-accent"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M3 7V5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"
							/>
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
				</div>

				{#if qrScannerOpen}
					<div class="relative aspect-square overflow-hidden rounded-md border border-border-default bg-black shadow-inner">
						<video
							bind:this={qrVideoElement}
							class="h-full w-full object-cover"
							playsinline
							muted
						></video>
						<button
							aria-label="Close QR scanner"
							onclick={onStopQrScanner}
							class="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white backdrop-blur-md hover:bg-black/60"
						>
							<svg
								class="h-4 w-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								aria-label="Close scanner"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					</div>
				{/if}

				{#if connectionError || qrScannerError}
					<div
						class="flex items-start gap-1.5 rounded-md border border-error/10 bg-error/5 px-2 py-1.5 text-[10px] text-error"
					>
						<svg class="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						{connectionError || qrScannerError}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
