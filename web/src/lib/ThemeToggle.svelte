<script lang="ts">
    import { browser } from "$app/environment";

    function getInitialTheme(): "dark" | "light" {
        if (browser) {
            const saved = localStorage.getItem("theme");
            if (saved === "dark" || saved === "light") return saved;
        }
        return "light";
    }

    let theme = $state<"dark" | "light">(getInitialTheme());

    function toggle() {
        theme = theme === "light" ? "dark" : "light";
        if (browser) {
            localStorage.setItem("theme", theme);
            if (theme === "dark") {
                document.documentElement.classList.add("dark");
            } else {
                document.documentElement.classList.remove("dark");
            }
        }
    }
</script>

<button
    type="button"
    aria-label="Toggle theme"
    class="w-fit flex items-center justify-center gap-2 p-1 text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated rounded-full px-2"
    onclick={toggle}
>
    {#if theme === "light"}
        <svg
            class="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
            ></path></svg
        >
    {:else}
        <svg
            class="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
            ></path></svg
        >
    {/if}
</button>
