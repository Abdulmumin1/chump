<script lang="ts">
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

    let {
        active = true,
        intervalMs = 80,
        class: className = "",
    } = $props<{
        active?: boolean;
        intervalMs?: number;
        class?: string;
    }>();

    let frame = $state(0);
    let timer: ReturnType<typeof setInterval> | null = null;

    $effect(() => {
        if (active) {
            frame = 0;
            timer = setInterval(() => {
                frame = (frame + 1) % frames.length;
            }, intervalMs);
        } else {
            if (timer) clearInterval(timer);
            timer = null;
        }

        return () => {
            if (timer) clearInterval(timer);
        };
    });
</script>

<span class={className} aria-hidden="true">{frames[frame]}</span>
