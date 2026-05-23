import type { ModelChoice } from "$lib/models";

export type Suggestion = {
    label: string;
    command: string;
    description: string;
    kind: "root" | "model" | "command";
};

const ROOT_COMMANDS: Suggestion[] = [
    {
        label: "/model",
        command: "/model ",
        description: "choose provider and model",
        kind: "root",
    },
    {
        label: "/thinking",
        command: "/thinking ",
        description: "choose reasoning level",
        kind: "root",
    },
    {
        label: "/clear",
        command: "/clear",
        description: "clear messages for current session",
        kind: "command",
    },
    {
        label: "/compact",
        command: "/compact",
        description: "summarize old context and keep recent messages",
        kind: "command",
    },
    {
        label: "/new",
        command: "/new",
        description: "start a fresh session",
        kind: "command",
    },
];

const THINKING_PRESETS: Suggestion[] = [
    {
        label: "none",
        command: "/thinking none",
        description: "disable thinking",
        kind: "command",
    },
    {
        label: "low",
        command: "/thinking low",
        description: "small thinking budget",
        kind: "command",
    },
    {
        label: "high",
        command: "/thinking high",
        description: "larger thinking budget",
        kind: "command",
    },
    {
        label: "xhigh",
        command: "/thinking xhigh",
        description: "maximum thinking budget",
        kind: "command",
    },
];

export function buildComposerSuggestions(
    composerText: string,
    models: ModelChoice[],
    currentProvider: string,
): Suggestion[] {
    if (!composerText.startsWith("/")) {
        return [];
    }

    const trimmed = composerText.trim();

    if (/^\/model(?:\s|$)/.test(trimmed)) {
        const query = trimmed.slice("/model".length).trim().toLowerCase();
        return models
            .filter(
                (model) =>
                    model.provider === currentProvider &&
                    (!query ||
                        model.label.toLowerCase().includes(query) ||
                        model.description.toLowerCase().includes(query)),
            )
            .map((model) => ({
                label: model.label,
                command: `/model ${model.label}`,
                description: model.description,
                kind: "model" as const,
            }));
    }

    if (/^\/thinking(?:\s|$)/.test(trimmed)) {
        const query = trimmed.slice("/thinking".length).trim().toLowerCase();
        return THINKING_PRESETS.filter(
            (item) => !query || item.label.includes(query),
        );
    }

    const hits = ROOT_COMMANDS.filter((command) =>
        command.label.startsWith(trimmed),
    );
    return hits.length > 0 ? hits : trimmed === "/" ? ROOT_COMMANDS : [];
}
