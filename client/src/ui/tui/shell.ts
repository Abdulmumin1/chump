import {
  type AutocompleteProvider,
  Container,
  ProcessTerminal,
  type Component,
  TUI,
} from "@earendil-works/pi-tui";

import type {
  FileSearchResult,
  PromptSubmission,
  SessionSummary,
  SlashCommandMenuContext,
} from "../../core/types.ts";
import {
  createTuiMarkdownTheme,
  renderError,
  renderEscHint,
  renderQueueHint,
  renderQueuedMessage,
  renderTuiAccent,
  renderTuiBorder,
  renderTuiDim,
  renderTuiMuted,
} from "../render.ts";
import { setTerminalOutputSink } from "../terminal.ts";
import type { StatusDisplay } from "../status.ts";
import {
  ChumpAutocompleteProvider,
  ExtensibleAutocompleteProvider,
} from "./autocomplete.ts";
import {
  MutableLines,
  SessionFooter,
  TranscriptGap,
  TuiTranscript,
} from "./components.ts";
import { ChumpEditor } from "./editor.ts";
import {
  type ChumpTuiExtensionApi,
  type ChumpTuiExtensionCleanup,
  type ChumpTuiKeyHandler,
  type ChumpTuiOutputTransform,
  type ChumpTuiSlot,
  resolveTuiExtensions,
} from "./extensions.ts";

export type PiPromptReader = {
  read: () => Promise<PromptSubmission | null>;
  close: () => void;
  popQueuedDisplay: () => void;
  removeQueuedDisplay: (content: string) => void;
  setQueuedDisplay: (submissions: PromptSubmission[]) => void;
  setQueuedLinePopHandler: (handler: (() => void) | null) => void;
  setModelSuggestions: (models: SlashCommandMenuContext["models"]) => void;
  setSkillSuggestions: (skills: SlashCommandMenuContext["skills"]) => void;
  setAbortHandler: (handler: (() => void) | null) => void;
  setSessionSuggestions: (sessions: SessionSummary[]) => void;
  setSessionSuggestionLoader: (
    loader: (() => Promise<SessionSummary[]>) | null,
  ) => void;
  setStatus: (status: StatusDisplay) => void;
  setFooter: (footer: string | null) => void;
  setRuleBadge: (badge: string | null) => void;
  setFileSearch: (
    search: ((query: string) => Promise<FileSearchResult[]>) | null,
  ) => void;
};

export function createPiPromptReader(): PiPromptReader {
  return new PiTuiShell();
}

class PiTuiShell implements PiPromptReader {
  private readonly tui = new TUI(new ProcessTerminal());
  private readonly slots: Record<ChumpTuiSlot, Container> = {
    header: new Container(),
    beforeInput: new Container(),
    afterInput: new Container(),
    footer: new Container(),
  };
  private readonly transcript = new TuiTranscript(createTuiMarkdownTheme());
  private readonly queue = new MutableLines();
  private readonly status = new MutableLines();
  private readonly footer = new SessionFooter(renderTuiDim);
  private readonly keyHandlers: ChumpTuiKeyHandler[] = [];
  private readonly autocompleteProviders: AutocompleteProvider[] = [];
  private readonly outputTransforms: ChumpTuiOutputTransform[] = [];
  private readonly autocomplete = new ChumpAutocompleteProvider();
  private readonly editor = new ChumpEditor(
    this.tui,
    {
      borderColor: renderTuiBorder,
      selectList: {
        selectedPrefix: renderTuiAccent,
        selectedText: renderTuiAccent,
        description: renderTuiMuted,
        scrollInfo: renderTuiMuted,
        noMatch: renderTuiMuted,
      },
    },
    this.keyHandlers,
  );
  private readonly pendingSubmissions: PromptSubmission[] = [];
  private readonly cleanup: ChumpTuiExtensionCleanup[] = [];
  private readonly extensionReady: Promise<void>;
  private queuedDisplay: PromptSubmission[] = [];
  private pendingResolve: ((submission: PromptSubmission | null) => void) | null = null;
  private popQueuedLine: (() => void) | null = null;
  private abortHandler: (() => void) | null = null;
  private statusLines: readonly string[] = [];
  private escapeHint = false;
  private slashContext: SlashCommandMenuContext = {
    sessions: [],
    models: [],
    skills: [],
  };
  private inputEnded = false;
  private closed = false;

  constructor() {
    this.autocompleteProviders.push(this.autocomplete);
    this.refreshAutocomplete();
    this.editor.onSubmit = (text) => {
      if (this.autocomplete.shouldOpenPicker(text)) {
        this.editor.openPicker(text);
        return;
      }
      if (this.autocomplete.consumeFillCompletion(text)) {
        this.editor.restoreFillCompletion(text);
        return;
      }
      const submission = buildSubmission(
        text,
        this.editor.takeSubmittedAttachments(),
      );
      if (!submission.text.trim() && submission.attachments.length === 0) {
        return;
      }
      this.editor.addToHistory(submission.text);
      this.submit(submission);
    };
    this.editor.onExit = () => this.finish(null);
    this.editor.onAbort = () => this.abortHandler?.();
    this.editor.onEscapeHint = (active) => {
      this.escapeHint = active;
      this.syncStatus();
    };
    this.editor.onPopQueued = () => {
      const queued = this.queuedDisplay.at(-1) ?? null;
      if (!queued) {
        return null;
      }
      this.popQueuedLine?.();
      this.queuedDisplay.pop();
      this.syncQueue();
      return queued;
    };

    this.tui.addChild(this.slots.header);
    this.tui.addChild(this.transcript);
    this.tui.addChild(new TranscriptGap(this.transcript));
    this.tui.addChild(this.queue);
    this.tui.addChild(this.status);
    this.tui.addChild(this.slots.beforeInput);
    this.tui.addChild(this.editor);
    this.tui.addChild(this.slots.afterInput);
    this.tui.addChild(this.slots.footer);
    this.tui.addChild(this.footer);
    this.tui.setFocus(this.editor);
    this.tui.start();
    setTerminalOutputSink(this);
    this.extensionReady = this.initializeExtensions();
  }

  write = (value: string): void => {
    const transformed = this.transformOutput(value);
    if (!transformed) {
      return;
    }
    this.transcript.append(transformed);
    this.tui.requestRender();
  };

  clear = (): void => {
    this.transcript.clear();
    this.tui.requestRender(true);
  };

  createMarkdownStream = () => this.transcript.createMarkdownStream(
    (value) => this.transformOutput(value),
    () => this.tui.requestRender(),
  );

  async read(): Promise<PromptSubmission | null> {
    await this.extensionReady;
    if (this.closed || this.inputEnded) {
      return null;
    }
    const queued = this.pendingSubmissions.shift();
    if (queued) {
      return queued;
    }
    return await new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve?.(null);
    setTerminalOutputSink(null);
    for (const dispose of this.cleanup.reverse()) {
      void dispose();
    }
    this.tui.stop();
  }

  popQueuedDisplay(): void {
    this.queuedDisplay.shift();
    this.syncQueue();
  }

  removeQueuedDisplay(content: string): void {
    const normalized = content.trim();
    const index = this.queuedDisplay.findIndex(
      (submission) => submission.text.trim() === normalized,
    );
    if (index !== -1) {
      this.queuedDisplay.splice(index, 1);
      this.syncQueue();
    }
  }

  setQueuedDisplay(submissions: PromptSubmission[]): void {
    this.queuedDisplay = [...submissions];
    this.syncQueue();
  }

  setQueuedLinePopHandler(handler: (() => void) | null): void {
    this.popQueuedLine = handler;
  }

  setModelSuggestions(models: SlashCommandMenuContext["models"]): void {
    this.slashContext = { ...this.slashContext, models };
    this.syncAutocompleteContext();
  }

  setSkillSuggestions(skills: SlashCommandMenuContext["skills"]): void {
    this.slashContext = { ...this.slashContext, skills };
    this.syncAutocompleteContext();
  }

  setAbortHandler(handler: (() => void) | null): void {
    this.abortHandler = handler;
    this.editor.onAbort = handler ? () => handler() : undefined;
    if (!handler) {
      this.escapeHint = false;
      this.syncStatus();
    }
  }

  setSessionSuggestions(sessions: SessionSummary[]): void {
    this.slashContext = { ...this.slashContext, sessions };
    this.autocomplete.setSessionSuggestions(sessions);
    this.refreshAutocomplete();
  }

  setSessionSuggestionLoader(
    loader: (() => Promise<SessionSummary[]>) | null,
  ): void {
    this.autocomplete.setSessionSuggestionLoader(loader);
    this.refreshAutocomplete();
  }

  setStatus(status: StatusDisplay): void {
    this.statusLines = status === null
      ? []
      : typeof status === "string"
        ? [status]
        : [...status];
    this.syncStatus();
  }

  setFooter(footer: string | null): void {
    this.footer.setFooter(footer);
    this.tui.requestRender();
  }

  setRuleBadge(badge: string | null): void {
    this.footer.setContext(badge);
    this.tui.requestRender();
  }

  setFileSearch(
    search: ((query: string) => Promise<FileSearchResult[]>) | null,
  ): void {
    this.autocomplete.setFileSearch(search);
    this.refreshAutocomplete();
  }

  private submit(submission: PromptSubmission): void {
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    if (resolve) {
      resolve(submission);
      return;
    }
    this.pendingSubmissions.push(submission);
  }

  private finish(submission: PromptSubmission | null): void {
    if (submission) {
      this.submit(submission);
      return;
    }
    this.inputEnded = true;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    if (resolve) {
      resolve(null);
      return;
    }
  }

  private syncQueue(): void {
    const lines = this.queuedDisplay.map((submission) =>
      renderQueuedMessage(formatSubmissionPreview(submission))
    );
    if (lines.length > 0) {
      lines.push(renderQueueHint());
    }
    this.queue.set(lines);
    this.tui.requestRender();
  }

  private syncStatus(): void {
    const lines = [...this.statusLines];
    if (this.escapeHint) {
      if (lines.length === 0) {
        lines.push(renderEscHint());
      } else {
        lines[0] = `${lines[0]}  ${renderEscHint()}`;
      }
    }
    this.status.set(lines);
    this.tui.requestRender();
  }

  private syncAutocompleteContext(): void {
    this.autocomplete.setCommandContext({
      models: this.slashContext.models,
      skills: this.slashContext.skills,
    });
    this.refreshAutocomplete();
  }

  private refreshAutocomplete(): void {
    this.editor.setAutocompleteProvider(
      new ExtensibleAutocompleteProvider(this.autocompleteProviders),
    );
    this.tui.requestRender();
  }

  private async initializeExtensions(): Promise<void> {
    try {
      const extensions = await resolveTuiExtensions();
      for (const { id, extension } of extensions) {
        try {
          const cleanup = await extension(this.createExtensionApi());
          if (cleanup) {
            this.cleanup.push(cleanup);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.write(`${renderError(`TUI extension ${id}: ${message}`)}\n`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.write(`${renderError(`TUI extension: ${message}`)}\n`);
    }
  }

  private createExtensionApi(): ChumpTuiExtensionApi {
    return {
      tui: this.tui,
      theme: {
        accent: renderTuiAccent,
        muted: renderTuiMuted,
        error: renderError,
      },
      addComponent: (slot, component) => this.addComponent(slot, component),
      addKeyHandler: (handler) => this.addKeyHandler(handler),
      addAutocompleteProvider: (provider) =>
        this.addAutocompleteProvider(provider),
      addOutputTransform: (transform) => this.addOutputTransform(transform),
      requestRender: () => this.tui.requestRender(),
    };
  }

  private addComponent(slot: ChumpTuiSlot, component: Component): () => void {
    const container = this.slots[slot];
    container.addChild(component);
    this.tui.requestRender();
    return () => {
      container.removeChild(component);
      this.tui.requestRender();
    };
  }

  private addKeyHandler(handler: ChumpTuiKeyHandler): () => void {
    this.keyHandlers.push(handler);
    return () => removeValue(this.keyHandlers, handler);
  }

  private addAutocompleteProvider(
    provider: AutocompleteProvider,
  ): () => void {
    this.autocompleteProviders.unshift(provider);
    this.refreshAutocomplete();
    return () => {
      removeValue(this.autocompleteProviders, provider);
      this.refreshAutocomplete();
    };
  }

  private addOutputTransform(transform: ChumpTuiOutputTransform): () => void {
    this.outputTransforms.push(transform);
    return () => removeValue(this.outputTransforms, transform);
  }

  private transformOutput(value: string): string {
    return this.outputTransforms.reduce(
      (current, transform) => transform(current),
      value,
    );
  }
}

function removeValue<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index !== -1) {
    values.splice(index, 1);
  }
}

function buildSubmission(
  text: string,
  attachments: PromptSubmission["attachments"],
): PromptSubmission {
  return {
    text: text.replace(/[ \t]+\n/g, "\n").replace(/\s+$/u, ""),
    attachments,
  };
}

function formatSubmissionPreview(submission: PromptSubmission): string {
  let text = submission.text;
  for (const attachment of submission.attachments) {
    if (attachment.type === "text") {
      text = text.replace(attachment.text, attachment.label);
    }
    if (attachment.type === "image" && !text.includes(attachment.label)) {
      text = `${text.trimEnd()} ${attachment.label}`.trim();
    }
  }
  const imageCount = submission.attachments.filter(
    (attachment) => attachment.type === "image",
  ).length;
  return [text, imageCount > 0 ? `${imageCount} image${imageCount === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(" ");
}
