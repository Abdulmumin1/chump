<script lang="ts">
	let { selectedTab = 'CLI' } = $props();
</script>

<div class="relative w-[280px] h-[360px] md:w-[320px] md:h-[410px] flex flex-col items-center transition-transform duration-700 hover:scale-[1.02] group">
	<!-- Mac Body -->
	<div class="w-full h-[90%] bg-[#ccd2b8] rounded-t-xl rounded-b shadow-[0_20px_50px_rgba(123,138,63,0.15)] flex flex-col p-4 md:p-5 relative z-10" style="box-shadow: inset 1px 2px 4px rgba(255,255,255,0.6), inset -2px -4px 6px rgba(0,0,0,0.05), 0 20px 40px rgba(123,138,63,0.2);">
		
		<!-- Screen Bezel -->
		<div class="w-full h-[55%] relative mt-1">
			<!-- Bezel sloped frame using borders -->
			<div class="absolute inset-0 border-t-[18px] border-b-[24px] border-l-[22px] border-r-[22px] rounded-[14px]" 
				 style="border-top-color: #b5be9c; border-bottom-color: #dce0cf; border-left-color: #c2c9ab; border-right-color: #c2c9ab;">
			</div>
			
			<!-- The CRT Screen -->
			<div class="absolute top-[18px] bottom-[24px] left-[22px] right-[22px] bg-[#7b8a3f] rounded-lg shadow-[inset_0_0_25px_rgba(0,0,0,0.3)] flex flex-col items-center justify-center overflow-hidden z-10 font-mono text-[8px] sm:text-[10px] text-[#e8ecd8] p-2 sm:p-3">
				<div class="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-gradient-to-br from-white/10 to-transparent rotate-45 transform origin-center pointer-events-none z-0"></div>
				
				<!-- Dynamic Screen Content -->
				<div class="relative z-10 w-full h-full flex flex-col transition-all duration-500">
					{#if selectedTab === 'CLI'}
						<div class="mt-1">> chump start</div>
						<div class="mt-1 opacity-70">Agent initialized...</div>
						<div class="mt-1 opacity-70 animate-pulse">_</div>
					{:else if selectedTab === 'WEB'}
						<div class="w-full h-full border border-current/20 rounded flex flex-col overflow-hidden bg-current/10 shadow-sm">
							<div class="h-2 sm:h-3 border-b border-current/20 flex items-center px-1 space-x-0.5 bg-current/10">
								<div class="w-1 h-1 rounded-full bg-current/40"></div>
								<div class="w-1 h-1 rounded-full bg-current/40"></div>
								<div class="w-1 h-1 rounded-full bg-current/40"></div>
							</div>
							<div class="flex-grow flex p-1 space-x-1">
								<div class="w-1/4 h-full border-r border-current/20"></div>
								<div class="flex-grow h-full bg-current/5 rounded-sm"></div>
							</div>
						</div>
					{:else if selectedTab === 'MOBILE'}
						<div class="w-full h-full flex items-center justify-center">
							<div class="h-[95%] w-[45%] border-2 border-current/30 rounded-md flex flex-col p-1 bg-current/10 shadow-sm relative">
								<div class="w-1/3 h-0.5 mx-auto bg-current/40 rounded-full mt-0.5"></div>
								<div class="mt-2 space-y-1.5 flex-grow">
									<div class="w-3/4 h-1 bg-current/30 rounded"></div>
									<div class="w-1/2 h-1 bg-current/30 rounded"></div>
								</div>
								<div class="w-full h-2 sm:h-3 bg-current/20 rounded mt-auto flex items-center justify-center">
									<div class="w-1/2 h-0.5 bg-current/40 rounded"></div>
								</div>
							</div>
						</div>
					{:else if selectedTab === 'COLLABORATIVE'}
						<div class="flex flex-col space-y-2 mt-1 w-full relative">
							<div class="w-full h-3 sm:h-4 bg-current/10 border border-current/20 rounded flex items-center px-1 shadow-sm">
								<div class="w-1.5 h-1.5 bg-current/80 rounded-full animate-ping mr-1"></div>
								<div class="w-[60%] h-0.5 bg-current/40 rounded"></div>
							</div>
							<div class="w-[90%] h-3 sm:h-4 bg-current/10 border border-current/20 rounded flex items-center px-1 ml-auto shadow-sm">
								<div class="w-1.5 h-1.5 bg-current/60 rounded-full mr-1"></div>
								<div class="w-1/2 h-0.5 bg-current/40 rounded"></div>
							</div>
						</div>
					{:else if selectedTab === 'SERVER'}
						<div class="mt-1 opacity-70 text-[6px] sm:text-[8px] font-mono">[2024-05-16] INFO: bound to :3000</div>
						<div class="mt-1 opacity-70 text-[6px] sm:text-[8px] font-mono">[2024-05-16] INFO: Tunnel active</div>
						<div class="mt-1 text-[6px] sm:text-[8px] font-bold font-mono">READY: Accepting RPCs</div>
						<div class="mt-auto flex space-x-1 w-full justify-between items-end pb-1 h-8 opacity-60">
							<div class="w-full bg-current/40 rounded-t h-[30%]"></div>
							<div class="w-full bg-current/40 rounded-t h-[60%]"></div>
							<div class="w-full bg-current/40 rounded-t h-[40%]"></div>
							<div class="w-full bg-current/40 rounded-t h-[80%]"></div>
							<div class="w-full bg-current/40 rounded-t h-[50%]"></div>
							<div class="w-full bg-current/40 rounded-t h-[90%]"></div>
							<div class="w-full bg-current/40 rounded-t h-[70%]"></div>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Vents -->
		<div class="w-full mt-6 px-1 flex flex-col space-y-[10px]">
			<!-- Vent 1 -->
			<div class="w-full h-[6px] relative flex items-center">
				<div class="absolute inset-0 bg-[#b5be9c] rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]"></div>
				<div class="absolute right-[12%] w-[40%] h-full bg-[#5a662d] shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
				<div class="absolute right-[4%] w-[3.5px] h-[3.5px] bg-[#5a662d] rounded-full shadow-[inset_0_1px_1px_rgba(0,0,0,0.5)]"></div>
			</div>
			<!-- Vent 2 -->
			<div class="w-full h-[6px] relative">
				<div class="absolute inset-0 bg-[#b5be9c] rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]"></div>
			</div>
			<!-- Vent 3 -->
			<div class="w-full h-[6px] relative">
				<div class="absolute inset-0 bg-[#b5be9c] rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]"></div>
			</div>
			<!-- Vent 4 -->
			<div class="w-full h-[6px] relative flex items-center">
				<div class="absolute inset-0 bg-[#b5be9c] rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]"></div>
				<div class="absolute right-[12%] w-[40%] h-full bg-[#5a662d] shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"></div>
				<div class="absolute right-[4%] w-[3.5px] h-[3.5px] bg-[#5a662d] rounded-full shadow-[inset_0_1px_1px_rgba(0,0,0,0.5)]"></div>
			</div>
		</div>

		<!-- Bottom Logos -->
		<div class="absolute bottom-4 left-5 w-4 h-4 text-[#7b8a3f]">
			<svg viewBox="0 0 384 512" class="w-full h-full fill-current"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
		</div>
		<div class="absolute bottom-4 right-5 text-[#8a9a4a] text-[11px] font-serif font-medium tracking-tight">
			Macintosh SE
		</div>
	</div>

	<!-- Base / Vertical Ribs -->
	<div class="w-[94%] h-[10%] bg-[#c2c9ab] rounded-b-md shadow-md flex mt-[-1px] z-0 overflow-hidden relative" style="box-shadow: inset 0 4px 6px rgba(0,0,0,0.1);">
		<!-- Brightness Icon Placeholder -->
		<div class="absolute left-3 top-1/2 -translate-y-1/2 text-[#7b8a3f] opacity-60 w-3 h-3 z-10 bg-[#c2c9ab] pl-0.5">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
		</div>
		<!-- Ribs -->
		<div class="absolute inset-0 flex justify-between px-1">
			{#each Array(50) as _}
				<div class="h-full w-[1px] bg-[#a8b38d] opacity-50"></div>
			{/each}
		</div>
	</div>
</div>