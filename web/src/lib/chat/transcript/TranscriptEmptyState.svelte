<script lang="ts">
    import BrailleSpinner from "$lib/BrailleSpinner.svelte";
    import PixelGridShader from "$lib/PixelGridShader.svelte";
    import type { ChumpHealth } from "$lib/chump/types";

    let {
        health = null,
        activeSessionId = "",
        isConnecting = false,
        onOpenConnectModal,
        isLoadingSession = false,
    } = $props<{
        health?: ChumpHealth | null;
        activeSessionId?: string;
        isConnecting?: boolean;
        onOpenConnectModal?: () => void;
        isLoadingSession?: boolean;
    }>();
</script>

{#if !health}
    <div
        class="absolute bottom-0 left-0 right-0 h-[33%] w-full z-0 overflow-hidden select-none"
        style="mask-image: linear-gradient(to top, black 40%, transparent 100%); -webkit-mask-image: linear-gradient(to top, black 40%, transparent 100%);"
    >
        <PixelGridShader
            shape="wave"
            matrix="bayer8"
            pxSize={3}
            speed={0.1}
            amplitude={0.16}
            frequency={0.7}
            colorFg="#e4f222"
            flipped={true}
        />
    </div>
{/if}

<div
    class="flex flex-col items-center justify-center min-h-[50vh] text-center px-4 mt-8 relative z-10"
>
    <img src="/favicon.svg" alt="Chump logo" class="w-24 h-24 mb-6 select-none" />
    {#if !health}
        <h1 class="text-[18px] md:text-[20px] font-medium text-text-main mb-2">
            Co' Connect to a server
        </h1>
        <p class="text-[14px] text-text-tertiary max-w-md mb-6 leading-relaxed">
            Connect to your local or remote chump server to start building.
        </p>
        {#if onOpenConnectModal}
            <button
                class="button-primary flex items-center justify-center gap-2 min-w-[120px] cursor-pointer"
                onclick={onOpenConnectModal}
                disabled={isConnecting}
            >
                {#if isConnecting}
                    <BrailleSpinner class="font-mono text-[14px]" />
                    Connecting...
                {:else}
                    Connect now
                {/if}
            </button>
        {/if}
    {:else if !activeSessionId}
        <h1 class="text-[18px] md:text-[20px] font-medium text-text-main mb-2">
            Start a session
        </h1>
        <p class="text-[14px] text-text-tertiary max-w-md">
            Type your first message below, or create a new session to get started.
        </p>
    {:else if isLoadingSession}
        <h1 class="text-[18px] md:text-[20px] font-medium text-text-main mb-2 flex items-center gap-2 justify-center">
            <BrailleSpinner class="font-mono text-[18px] text-text-highlight" />
            Loading session...
        </h1>
        <p class="text-[14px] text-text-tertiary max-w-md">
            Restoring context and fetching messages from the server.
        </p>
    {:else}
        <h1 class="text-[18px] md:text-[20px] font-medium text-text-main mb-2">
            Wh' What are we building?
        </h1>
        <p class="text-[14px] text-text-tertiary max-w-md">
            I'm ready. Describe a task or ask a question.
        </p>
    {/if}
</div>
