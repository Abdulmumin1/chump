<script lang="ts">
	import { cubicOut, cubicIn } from 'svelte/easing';
	import { resolve } from '$app/paths';
	import MacintoshSE from './MacintoshSE.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let selectedTab = $state('CLI');
	const tabs = ['CLI', 'WEB', 'MOBILE', 'COLLABORATIVE', 'SERVER'];
	
	const tabData: Record<string, { title: string; desc: string }> = {
		'CLI': {
			title: 'Code with your team, instantly.',
			desc: 'A coding agent with first class support for collaborative coding. Seamlessly switch between web, CLI, and mobile clients.',
		},
		'WEB': {
			title: 'Native web experience.',
			desc: 'Access your agents from any browser. Full featured IDE capabilities, live previews, and instant sharing with no local setup.',
		},
		'MOBILE': {
			title: 'Take it with you.',
			desc: 'Stay connected to your sessions on the go. Review code, chat with the agent, and approve pull requests right from your pocket.',
		},
		'COLLABORATIVE': {
			title: 'Multiplayer by design.',
			desc: 'Share sessions via secure tunnels. You, your teammates, and the AI agent all typing and debugging in the same environment.',
		},
		'SERVER': {
			title: 'Self-hosted or Cloud.',
			desc: 'Run the backend in the foreground or connect to existing servers. Your code, your infrastructure, your rules.',
		}
	};

	const tabContent = $derived(tabData[selectedTab] || tabData['CLI']);

	// Svelte custom transitions for premium text swap animations
	const maskRevealIn = (node: Element, { duration = 760, delay = 0 }) => {
		return {
			duration,
			delay,
			easing: cubicOut, // approximates cubic-bezier(0.22, 1, 0.36, 1)
			css: (t: number, u: number) => `
				opacity: ${t};
				transform: translateY(${30 * u}px);
				filter: blur(${6 * u}px);
			`
		};
	};

	const maskRevealOut = (node: Element, { duration = 520, delay = 0 }) => {
		return {
			duration,
			delay,
			easing: cubicIn, // approximates cubic-bezier(0.64, 0, 0.78, 0)
			css: (t: number, u: number) => `
				opacity: ${t};
				transform: translateY(${-22 * u}px);
				filter: blur(${6 * u}px);
			`
		};
	};
</script>

<div class="h-[100dvh] w-full bg-bg-body text-text-main flex flex-col items-center justify-between font-sans overflow-hidden pt-16 sm:pt-8 pb-16 sm:pb-24 relative box-border">
	<!-- TOP NAV -->
	<nav class="absolute top-6 w-full flex justify-center sm:justify-end sm:pr-10 z-50 font-mono text-[10px] sm:text-xs tracking-[0.15em] items-center space-x-6">
		<a href="https://github.com/Abdulmumin1/chump" target="_blank" rel="noopener noreferrer" class="text-text-secondary hover:text-text-main transition-colors">GITHUB</a>
		{#if data.user}
			<a href={resolve('/account')} class="text-text-secondary hover:text-text-main transition-colors">ACCOUNT</a>
		{:else}
			<a href={resolve('/auth')} class="text-text-secondary hover:text-text-main transition-colors">SIGN IN</a>
		{/if}
		<a href={resolve('/c')} class="group relative flex items-center gap-2 text-text-secondary hover:text-text-main transition-colors">
			<span class="tracking-[0.2em]">CONNECT</span>
			<!-- Weird/Funky symbol: an asterisk that spins on hover, simulating a connection spark/terminal star -->
			<div class="relative w-4 h-4 flex items-center justify-center">
				<svg class="w-4 h-4 opacity-70 group-hover:opacity-100 transition-all duration-700 ease-in-out group-hover:rotate-180" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z" />
				</svg>
				<!-- Small radar/pulse effect behind the star that flares up on hover -->
				<div class="absolute inset-0 rounded-full border border-text-main opacity-0 group-hover:animate-[ping_1.5s_ease-out_infinite]"></div>
			</div>
		</a>
		<a href="https://github.com/Abdulmumin1/chump#prebuilt-binary-no-nodejs-install-needed" target="_blank" rel="noopener noreferrer" class="px-4 py-2 rounded-[8px] bg-accent text-text-on-accent font-medium hover:bg-accent-hover transition-colors duration-300">DOWNLOAD</a>
	</nav>

	<!-- HEADER -->
	<header class="w-full max-w-4xl px-4 flex flex-col items-center pt-2 sm:pt-4 relative flex-shrink-0">
		<div class="flex flex-row items-center justify-center w-full relative mb-[-0.25rem] md:mb-[-0.5rem] z-10">
			<h1 class="text-3xl sm:text-5xl md:text-7xl lg:text-[6rem] font-serif tracking-tighter uppercase whitespace-nowrap text-text-inverse flex items-center justify-center line-anim leading-none" style="font-family: 'Times New Roman', Times, serif; animation-delay: 0ms;">
				Chump
			</h1>

			<div class="flex items-center ml-3 sm:ml-5" aria-hidden="true">
				<div class="relative flex items-center justify-center w-10 h-10 sm:w-14 sm:h-14 md:w-20 md:h-20 lg:w-24 lg:h-24 transition-all duration-500 line-anim" style="animation-delay: 90ms;">
					<div class="absolute inset-0 rounded-full flex flex-col justify-evenly overflow-hidden border border-border-default">
						{#each Array(7) as _, index (index)}
							<div class="w-full h-[2px] bg-text-inverse opacity-20"></div>
						{/each}
					</div>
					<span class="text-[6px] sm:text-[8px] md:text-xs lg:text-sm font-mono font-bold bg-bg-body px-1 z-10 tracking-tighter text-text-inverse transition-all duration-300">
						{selectedTab}
					</span>
				</div>
			</div>
		</div>
		
		<h2 class="text-3xl sm:text-5xl md:text-7xl lg:text-[6rem] font-serif tracking-tighter uppercase text-center whitespace-nowrap text-text-inverse flex items-center justify-center line-anim mt-1 sm:mt-0 leading-none" style="font-family: 'Times New Roman', Times, serif; animation-delay: 180ms;">
			Coding Agent
		</h2>
	</header>

	<!-- CENTER ARTWORK -->
	<main class="flex-grow flex items-center justify-center w-full px-4 mt-6 sm:mt-10 mb-4 sm:mb-8 perspective-1000 overflow-hidden">
		<div class="animate-float">
			<MacintoshSE {selectedTab} />
		</div>
	</main>

	<!-- BOTTOM TEXT -->
	<section class="max-w-2xl w-full text-center px-4 mb-20 sm:mb-24 z-10 flex flex-col items-center relative min-h-[100px] sm:min-h-[90px] flex-shrink-0">
		<!-- Svelte handles crossfade overlap natively by mounting the new div before unmounting the old if they share the grid/absolute space -->
		{#key selectedTab}
			<div 
				aria-live="polite"
				class="absolute w-full px-6 flex flex-col items-center left-1/2 -translate-x-1/2"
			>
				<p 
					class="text-base sm:text-lg md:text-xl font-medium mb-2 sm:mb-3 tracking-tight text-text-inverse"
					in:maskRevealIn={{ duration: 760, delay: 380 }} 
					out:maskRevealOut={{ duration: 520, delay: 0 }}
				>{tabContent.title}</p>
				<p 
					class="text-xs sm:text-sm md:text-base text-text-secondary leading-relaxed font-sans max-w-lg mx-auto"
					in:maskRevealIn={{ duration: 760, delay: 470 }} 
					out:maskRevealOut={{ duration: 520, delay: 70 }}
				>
					{tabContent.desc}
				</p>
			</div>
		{/key}
	</section>

	<!-- FLOATING TOOLBAR -->
	<nav class="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 bg-bg-surface/80 backdrop-blur-md p-1.5 rounded-full border border-border-default z-50 overflow-x-auto max-w-[95vw] hide-scrollbar">
		<div class="flex items-center min-w-max">
			{#each tabs as tab (tab)}
				<button 
					role="tab"
					aria-selected={selectedTab === tab}
					onclick={() => selectedTab = tab}
					class="flex items-center space-x-2 px-4 py-2 rounded-full text-[10px] sm:text-xs font-mono tracking-[0.15em] transition-all duration-300
						{selectedTab === tab ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:bg-bg-hover hover:text-text-main'}"
				>
					<div class="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center bg-transparent shrink-0">
						{#if selectedTab === tab}
							<div class="w-2 h-2 rounded-full bg-current transition-all duration-300 scale-100"></div>
						{:else}
							<div class="w-2 h-2 rounded-full bg-current transition-all duration-300 scale-0"></div>
						{/if}
					</div>
					<span class="pt-0.5 whitespace-nowrap">{tab}</span>
				</button>
			{/each}
		</div>
	</nav>
</div>

<style>
	/* Hide scrollbar for the floating nav on small screens */
	.hide-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.hide-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}

	/* Custom animations */
	@keyframes float {
		0%, 100% {
			transform: translateY(0px) rotate(0deg);
		}
		50% {
			transform: translateY(-12px) rotate(0.5deg);
		}
	}
	.animate-float {
		animation: float 6s ease-in-out infinite;
	}

	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes mask-reveal-up {
		from {
			opacity: 0;
			transform: translateY(30px);
			filter: blur(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
			filter: blur(0);
		}
	}
	.line-anim {
		opacity: 0;
		animation: mask-reveal-up 760ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
		will-change: transform, opacity, filter;
	}
</style>
