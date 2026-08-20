export type FontOption = {
    id: string;
    name: string;
    category: "Grotesque" | "Geometric" | "Tech" | "Editorial" | "System" | "Humanist";
    description: string;
    family: string;
    googleFontUrl?: string;
};

export const FONT_OPTIONS: FontOption[] = [
    {
        id: "system",
        name: "System Native",
        category: "System",
        description: "Default OS system UI font stack (SF Pro / Segoe UI / Roboto)",
        family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    {
        id: "new-title-local",
        name: "NewTitle (Local)",
        category: "Geometric",
        description: "Your downloaded NewTitle variable font",
        family: '"NewTitle Local", sans-serif',
    },
    {
        id: "supreme-local",
        name: "Supreme (Local)",
        category: "Geometric",
        description: "A clean, versatile sans-serif from your downloaded Fontshare font",
        family: '"Supreme Local", sans-serif',
    },
    {
        id: "clash-grotesk-local",
        name: "Clash Grotesk (Local)",
        category: "Grotesque",
        description: "Modern grotesque sans by Indian Type Foundry, self-hosted variable font",
        family: '"Clash Grotesk", sans-serif',
    },
    {
        id: "special-gothic",
        name: "Special Gothic",
        category: "Grotesque",
        description: "Bold, condensed display grotesque with heavy vintage industrial punch",
        family: '"Special Gothic", sans-serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Special+Gothic:wght@400..700&display=swap",
    },
    {
        id: "elms-sans",
        name: "Elms Sans",
        category: "Humanist",
        description: "Distinctive, high-contrast humanized sans with expressive character terminal cuts",
        family: '"Elms Sans", sans-serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Elms+Sans:ital,wght@0,400..700;1,400..700&display=swap",
    },
    {
        id: "plus-jakarta",
        name: "Plus Jakarta Sans",
        category: "Geometric",
        description: "Crisp, modern geometric sans engineered for high-density UIs",
        family: '"Plus Jakarta Sans", sans-serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400..700;1,400..700&display=swap",
    },
    {
        id: "instrument-sans",
        name: "Instrument Sans",
        category: "Grotesque",
        description: "Distinctive grotesque with subtle human calligraphic curves",
        family: '"Instrument Sans", sans-serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&display=swap",
    },
    {
        id: "bricolage",
        name: "Bricolage Grotesque",
        category: "Grotesque",
        description: "Expressive, quirky French grotesque with striking character",
        family: '"Bricolage Grotesque", sans-serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&display=swap",
    },
    {
        id: "space-grotesk",
        name: "Space Grotesk",
        category: "Tech",
        description: "Futuristic, techno-proportional grotesque with distinct geometric cuts",
        family: '"Space Grotesk", sans-serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400..700&display=swap",
    },
    {
        id: "outfit",
        name: "Outfit",
        category: "Geometric",
        description: "Clean, ultra-smooth geometric display and body typeface",
        family: '"Outfit", sans-serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Outfit:wght@400..700&display=swap",
    },
    {
        id: "dm-sans",
        name: "DM Sans",
        category: "Geometric",
        description: "Low-contrast, highly legible geometric sans with warm open counters",
        family: '"DM Sans", sans-serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&display=swap",
    },
    {
        id: "inter",
        name: "Inter",
        category: "Tech",
        description: "Battle-tested computer UI interface font with high x-height",
        family: '"Inter", sans-serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400..700;1,14..32,400..700&display=swap",
    },
    {
        id: "lora",
        name: "Lora Serif",
        category: "Editorial",
        description: "Contemporary, elegant calligraphic serif for a literary, magazine feel",
        family: '"Lora", serif',
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&display=swap",
    },
];

const loadedFontUrls = new Set<string>();

export function loadFontStylesheet(url: string) {
    if (!url || loadedFontUrls.has(url)) return;
    loadedFontUrls.add(url);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);
}

export function getActiveFontId(): string {
    if (typeof localStorage === "undefined") return "clash-grotesk-local";
    return localStorage.getItem("bodyFont") || "clash-grotesk-local";
}

export function setBodyFont(fontId: string): FontOption {
    const option = FONT_OPTIONS.find((f) => f.id === fontId) || FONT_OPTIONS[0];

    if (option.googleFontUrl) {
        loadFontStylesheet(option.googleFontUrl);
    }

    if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--body-font-family", option.family);
        document.documentElement.style.setProperty("--font-sans", option.family);
        document.body.style.setProperty("--body-font-family", option.family);
        document.body.style.setProperty("--font-sans", option.family);
        document.body.style.fontFamily = option.family;
        localStorage.setItem("bodyFont", option.id);
    }

    return option;
}

export function initBodyFont(): FontOption {
    const fontId = getActiveFontId();
    return setBodyFont(fontId);
}
