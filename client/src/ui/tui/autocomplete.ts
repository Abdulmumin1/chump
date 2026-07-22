import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

import { completeSlashCommand } from "../../app/commands.ts";
import type {
  FileSearchResult,
  SessionSummary,
  SlashCommandMenuContext,
} from "../../core/types.ts";

type CompletionResult = {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
};

const PICKER_COMMANDS = new Set([
  "/model",
  "/session",
  "/share",
  "/thinking",
  "/mcps",
  "/mcp",
]);

export class ChumpAutocompleteProvider implements AutocompleteProvider {
  readonly triggerCharacters = ["@"];
  private context: SlashCommandMenuContext = {
    sessions: [],
    models: [],
    skills: [],
    mcps: [],
  };
  private fileSearch: ((query: string) => Promise<FileSearchResult[]>) | null = null;
  private sessionSuggestionLoader: (() => Promise<SessionSummary[]>) | null = null;
  private sessionSuggestionsComplete = false;
  private sessionSuggestionLoad: Promise<SessionSummary[]> | null = null;
  private sessionSuggestionGeneration = 0;
  private readonly completionActions = new WeakMap<
    AutocompleteItem,
    "submit" | "fill"
  >();
  private lastFillCompletion: string | null = null;

  setContext(context: SlashCommandMenuContext): void {
    this.context = context;
  }

  setCommandContext(
    context: Pick<SlashCommandMenuContext, "models" | "skills"> &
      Partial<Pick<SlashCommandMenuContext, "mcps">>,
  ): void {
    this.context = { ...this.context, ...context };
  }

  setMcpSuggestions(mcps: SlashCommandMenuContext["mcps"]): void {
    this.context = { ...this.context, mcps };
  }

  setSessionSuggestions(sessions: SessionSummary[]): void {
    this.context = { ...this.context, sessions };
    this.sessionSuggestionsComplete = false;
    this.sessionSuggestionLoad = null;
    this.sessionSuggestionGeneration += 1;
  }

  setSessionSuggestionLoader(
    loader: (() => Promise<SessionSummary[]>) | null,
  ): void {
    this.sessionSuggestionLoader = loader;
    this.sessionSuggestionsComplete = loader === null;
    this.sessionSuggestionLoad = null;
    this.sessionSuggestionGeneration += 1;
  }

  setFileSearch(
    search: ((query: string) => Promise<FileSearchResult[]>) | null,
  ): void {
    this.fileSearch = search;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const currentLine = lines[cursorLine] ?? "";
    const beforeCursor = currentLine.slice(0, cursorCol);

    if (cursorLine === 0 && beforeCursor.startsWith("/")) {
      if (/^\/session\s/u.test(beforeCursor)) {
        await this.loadSessionSuggestions();
        if (options.signal.aborted) {
          return null;
        }
      }
      const [, prefix, suggestions] = completeSlashCommand(
        beforeCursor,
        this.context,
      );
      if (suggestions.length === 0) {
        return null;
      }
      const items = suggestions.map((suggestion) => {
        const item = {
          value: suggestion.command,
          label: suggestion.label,
          description: suggestion.description,
        };
        this.completionActions.set(item, suggestion.action);
        return item;
      });
      return {
        prefix,
        items,
      };
    }

    const mention = findFileMention(beforeCursor);
    if (!mention || !this.fileSearch) {
      return null;
    }
    const files = await this.fileSearch(mention.query);
    if (options.signal.aborted || files.length === 0) {
      return null;
    }
    return {
      prefix: mention.prefix,
      items: files.map((file) => ({
        value: `@${file.path}`,
        label: file.path,
        description: file.name === file.path ? undefined : file.name,
      })),
    };
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): CompletionResult {
    const nextLines = [...lines];
    const currentLine = nextLines[cursorLine] ?? "";
    const start = Math.max(0, cursorCol - prefix.length);
    const appendSpace = item.value.startsWith("@") || item.value.endsWith(" ");
    const replacement = appendSpace && !item.value.endsWith(" ")
      ? `${item.value} `
      : item.value;
    this.lastFillCompletion = this.completionActions.get(item) === "fill"
      ? replacement.trimEnd()
      : null;
    nextLines[cursorLine] =
      currentLine.slice(0, start) + replacement + currentLine.slice(cursorCol);
    return {
      lines: nextLines,
      cursorLine,
      cursorCol: start + replacement.length,
    };
  }

  consumeFillCompletion(value: string): boolean {
    const isFill = this.lastFillCompletion !== null &&
      value.trimEnd() === this.lastFillCompletion;
    this.lastFillCompletion = null;
    return isFill;
  }

  shouldOpenPicker(value: string): boolean {
    const shouldOpen = PICKER_COMMANDS.has(value.trim());
    if (shouldOpen) {
      this.lastFillCompletion = null;
    }
    return shouldOpen;
  }

  shouldTriggerFileCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean {
    const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
    return /^\/(?:model|session|share|thinking|mcps|mcp)\s/u.test(beforeCursor) ||
      findFileMention(beforeCursor) !== null;
  }

  private async loadSessionSuggestions(): Promise<void> {
    if (this.sessionSuggestionsComplete || !this.sessionSuggestionLoader) {
      return;
    }
    const generation = this.sessionSuggestionGeneration;
    this.sessionSuggestionLoad ??= this.sessionSuggestionLoader();
    try {
      const sessions = await this.sessionSuggestionLoad;
      if (generation !== this.sessionSuggestionGeneration) {
        return;
      }
      this.context = { ...this.context, sessions };
      this.sessionSuggestionsComplete = true;
    } catch {
      if (generation === this.sessionSuggestionGeneration) {
        this.sessionSuggestionLoad = null;
      }
    }
  }
}

export class ExtensibleAutocompleteProvider implements AutocompleteProvider {
  get triggerCharacters(): string[] {
    const values = this.providers.flatMap(
      (provider) => provider.triggerCharacters ?? [],
    );
    return [...new Set(values)];
  }

  private readonly owners = new WeakMap<AutocompleteItem, AutocompleteProvider>();
  private readonly providers: AutocompleteProvider[];

  constructor(providers: AutocompleteProvider[]) {
    this.providers = providers;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    for (const provider of this.providers) {
      const suggestions = await provider.getSuggestions(
        lines,
        cursorLine,
        cursorCol,
        options,
      );
      if (!suggestions?.items.length) {
        continue;
      }
      for (const item of suggestions.items) {
        this.owners.set(item, provider);
      }
      return suggestions;
    }
    return null;
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): CompletionResult {
    const provider = this.owners.get(item) ?? this.providers[0];
    if (!provider) {
      return { lines, cursorLine, cursorCol };
    }
    return provider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  shouldTriggerFileCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean {
    return this.providers.some(
      (provider) => provider.shouldTriggerFileCompletion?.(
        lines,
        cursorLine,
        cursorCol,
      ) === true,
    );
  }
}

function findFileMention(
  beforeCursor: string,
): { prefix: string; query: string } | null {
  const match = beforeCursor.match(/(?:^|\s)(@[^\s@]*)$/u);
  const prefix = match?.[1];
  if (!prefix) {
    return null;
  }
  return { prefix, query: prefix.slice(1) };
}
