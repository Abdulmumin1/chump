<script lang="ts">
	const tabData = [
		{ title: 'CLI', desc: 'Code with your team, instantly.' },
		{ title: 'WEB', desc: 'Native web experience.' },
		{ title: 'MOBILE', desc: 'Take it with you.' },
		{ title: 'COLLABORATIVE', desc: 'Multiplayer by design.' }
	];
</script>

<div class="min-h-screen bg-[#0a0a0a] overflow-auto p-12 flex flex-col items-center gap-16 font-sans text-text-main selection:bg-bg-elevated">
	
	<div class="text-center space-y-2">
		<h1 class="text-[#f4f4f5] text-3xl font-bold font-serif uppercase tracking-wider">Launch Assets</h1>
		<p class="text-[#858585] font-mono text-sm">Resize your browser or zoom out to capture full frames. Take screenshots of the bordered areas.</p>
	</div>

	<!-- 1. Product Hunt Gallery Main (1270 x 760) -->
	<div class="flex flex-col gap-2">
		<span class="text-[#858585] font-mono text-sm">Main Gallery Image (1270x760)</span>
		<div class="w-[1270px] h-[760px] bg-bg-body border border-[#28282a] shadow-2xl relative overflow-hidden flex flex-col box-border">
			<!-- Header -->
			<div class="absolute top-10 w-full flex justify-center z-50 font-mono text-xs tracking-[0.15em] items-center space-x-6 text-text-secondary">
				<div class="px-4 py-2 rounded-full border border-border-default text-text-main">A COLLABORATIVE CODING AGENT</div>
			</div>

			<!-- Center Logo & Title -->
			<div class="flex-1 flex flex-col items-center justify-center relative mt-10">
				<div class="flex flex-row items-center justify-center w-full relative z-10 mb-8">
					<h1 class="text-[8rem] font-serif tracking-tighter uppercase whitespace-nowrap text-text-inverse flex items-center justify-center leading-none" style="font-family: 'Times New Roman', Times, serif;">
						Chump
					</h1>

					<div class="flex items-center ml-8">
						<div class="relative flex items-center justify-center w-32 h-32">
							<div class="absolute inset-0 rounded-full flex flex-col justify-evenly overflow-hidden border border-border-default">
								{#each Array(7) as _, i}
									<div class="w-full h-[2px] bg-text-inverse opacity-20"></div>
								{/each}
							</div>
							<span class="text-lg font-mono font-bold bg-bg-body px-2 z-10 tracking-tighter text-text-inverse">
								v1.0
							</span>
						</div>
					</div>
				</div>

				<div class="text-xl md:text-2xl font-mono text-text-tertiary tracking-tight text-center max-w-2xl px-6 leading-relaxed">
					Code with your team, <span class="text-text-main font-semibold">instantly</span>. Switch between Web, CLI, and Mobile.
				</div>
			</div>

			<!-- Bottom abstract elements or features -->
			<div class="absolute bottom-12 w-full flex justify-center gap-12 px-12">
				{#each tabData as tab, i}
					<div class="flex flex-col items-center gap-2">
						<div class="font-mono text-sm tracking-wider text-text-main border-b border-border-default pb-1">{tab.title}</div>
						<div class="text-text-tertiary text-xs max-w-[200px] text-center">{tab.desc}</div>
					</div>
				{/each}
			</div>

			<!-- Decorative UI frames -->
			<div class="absolute left-8 top-1/2 -translate-y-1/2 w-16 h-64 border border-border-default rounded-full flex flex-col justify-between py-6 items-center opacity-40">
				<div class="w-2 h-2 rounded-full bg-text-tertiary"></div>
				<div class="w-2 h-2 rounded-full bg-text-tertiary"></div>
				<div class="w-2 h-2 rounded-full bg-text-tertiary"></div>
			</div>
			<div class="absolute right-8 top-1/2 -translate-y-1/2 w-16 h-64 border border-border-default rounded-full flex flex-col justify-between py-6 items-center opacity-40">
				<div class="w-2 h-2 rounded-full bg-text-tertiary"></div>
				<div class="w-[1px] h-32 bg-text-tertiary"></div>
				<div class="w-2 h-2 rounded-full bg-text-tertiary"></div>
			</div>
		</div>
	</div>

	<!-- 2. Feature Showcase Gallery (1270 x 760) -->
	<div class="flex flex-col gap-2">
		<span class="text-[#858585] font-mono text-sm">Feature Showcase (1270x760)</span>
		<div class="w-[1270px] h-[760px] bg-bg-body border border-[#28282a] shadow-2xl relative overflow-hidden flex flex-col box-border p-16">
			<h2 class="text-5xl font-serif text-text-inverse uppercase tracking-tight mb-4" style="font-family: 'Times New Roman', Times, serif;">Multiplayer by Design</h2>
			<p class="text-2xl font-mono text-text-tertiary mb-16 max-w-3xl leading-relaxed">Share sessions via secure tunnels. You, your teammates, and the AI agent all typing and debugging in the same environment.</p>

			<div class="grid grid-cols-2 gap-8 flex-1">
				<!-- Terminal Mock -->
				<div class="bg-bg-surface border border-border-default rounded-xl p-6 flex flex-col shadow-sm">
					<div class="flex gap-2 mb-6">
						<div class="w-3 h-3 rounded-full bg-border-hover"></div>
						<div class="w-3 h-3 rounded-full bg-border-hover"></div>
						<div class="w-3 h-3 rounded-full bg-border-hover"></div>
					</div>
					<div class="font-mono text-sm text-text-secondary space-y-4">
						<div class="flex gap-4"><span class="text-accent">chump$</span><span>Connecting to tunnel...</span></div>
						<div class="flex gap-4"><span class="text-accent">chump$</span><span class="text-success">Session shared! Link copied to clipboard.</span></div>
						<div class="flex gap-4"><span class="text-accent">chump$</span><span class="text-text-main animate-pulse">Waiting for teammates...</span></div>
						<div class="flex gap-4 mt-8 pt-4 border-t border-border-subtle"><span class="text-warning">Agent:</span><span> "I've started refactoring the auth module. Review my changes?"</span></div>
					</div>
				</div>

				<!-- Mobile/Web Mock -->
				<div class="bg-bg-surface border border-border-default rounded-xl p-6 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div class="absolute -right-12 -bottom-12 w-64 h-64 border border-border-default rounded-full flex flex-col justify-evenly overflow-hidden opacity-10">
						{#each Array(10) as _, i}
							<div class="w-full h-[1px] bg-text-inverse"></div>
						{/each}
					</div>
					<div class="font-mono text-sm tracking-widest text-text-tertiary uppercase">Native Clients</div>
					<div class="space-y-6 z-10">
						<div class="p-4 border border-border-default rounded-lg bg-bg-body flex justify-between items-center">
							<span class="font-mono text-text-main">Web Interface</span>
							<div class="w-2 h-2 rounded-full bg-success"></div>
						</div>
						<div class="p-4 border border-border-default rounded-lg bg-bg-body flex justify-between items-center">
							<span class="font-mono text-text-main">CLI App</span>
							<div class="w-2 h-2 rounded-full bg-success"></div>
						</div>
						<div class="p-4 border border-border-default rounded-lg bg-bg-body flex justify-between items-center">
							<span class="font-mono text-text-main">Mobile View</span>
							<div class="w-2 h-2 rounded-full bg-success"></div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- 3. Logo/Avatar (240 x 240) -->
	<div class="flex gap-16">
		<div class="flex flex-col gap-2">
			<span class="text-[#858585] font-mono text-sm">Product Hunt Logo (240x240)</span>
			<div class="w-[240px] h-[240px] bg-bg-body border border-[#28282a] shadow-2xl flex items-center justify-center relative overflow-hidden">
				<div class="absolute inset-4 rounded-full flex flex-col justify-evenly overflow-hidden border border-border-default">
					{#each Array(12) as _, i}
						<div class="w-full h-[2px] bg-text-inverse opacity-20"></div>
					{/each}
				</div>
				<span class="text-6xl font-serif tracking-tighter uppercase text-text-inverse z-10 bg-bg-body px-2" style="font-family: 'Times New Roman', Times, serif;">
					C
				</span>
			</div>
		</div>

		<div class="flex flex-col gap-2">
			<span class="text-[#858585] font-mono text-sm">Square Graphic (600x600)</span>
			<div class="w-[600px] h-[600px] bg-bg-body border border-[#28282a] shadow-2xl flex flex-col items-center justify-center relative overflow-hidden">
				<h1 class="text-7xl font-serif tracking-tighter uppercase whitespace-nowrap text-text-inverse mb-8" style="font-family: 'Times New Roman', Times, serif;">
					Chump
				</h1>
				<div class="relative flex items-center justify-center w-48 h-48 mb-8">
					<div class="absolute inset-0 rounded-full flex flex-col justify-evenly overflow-hidden border border-border-default">
						{#each Array(9) as _, i}
							<div class="w-full h-[2px] bg-text-inverse opacity-20"></div>
						{/each}
					</div>
				</div>
				<div class="font-mono text-text-tertiary tracking-widest text-sm uppercase">Collaborative Coding</div>
			</div>
		</div>
	</div>
</div>
