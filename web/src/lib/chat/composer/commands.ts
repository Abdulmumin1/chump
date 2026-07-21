import type { ModelChoice } from "$lib/models";

export type Suggestion = {
    label: string;
    command: string;
    description: string;
    kind: "root" | "model" | "skill" | "command";
};

export type SkillChoice = {
    name: string;
    description: string;
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
    skills: SkillChoice[] = [],
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
                    !query ||
                    model.label.toLowerCase().includes(query) ||
                    model.description.toLowerCase().includes(query),
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

    if (/^\/skill:/.test(trimmed) && !/\s/.test(trimmed)) {
        const query = trimmed.slice("/skill:".length).toLowerCase();
        return skills
            .filter(
                (skill) =>
                    !query || skill.name.toLowerCase().startsWith(query),
            )
            .map((skill) => ({
                label: `/skill:${skill.name}`,
                command: `/skill:${skill.name}`,
                description: skill.description,
                kind: "skill" as const,
            }));
    }

    const skillCommands = skills.map((skill) => ({
        label: `/skill:${skill.name}`,
        command: `/skill:${skill.name}`,
        description: skill.description,
        kind: "skill" as const,
    }));
    const rootCommands = ROOT_COMMANDS.filter((command) =>
        command.label.startsWith(trimmed),
    );
    const skillQuery = trimmed.slice(1);
    const matchingSkills = skillCommands.filter((command) =>
        matchesSkillQuery(command, skillQuery),
    );
    const hits = [...rootCommands, ...matchingSkills];
    return hits.length > 0
        ? hits
        : trimmed === "/"
          ? [...ROOT_COMMANDS, ...skillCommands]
          : [];
}

function matchesSkillQuery(
    skill: Pick<Suggestion, "label" | "description">,
    query: string,
): boolean {
    const terms = query.toLowerCase().split(/[\s:_-]+/).filter(Boolean);
    if (terms.length === 0) {
        return true;
    }
    const searchable = `${skill.label.slice("/skill:".length)} ${skill.description}`
        .toLowerCase()
        .replace(/[\s:_-]+/g, " ");
    return terms.every((term) => searchable.includes(term));
}
