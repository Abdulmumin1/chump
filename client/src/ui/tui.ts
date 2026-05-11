/**
 * TUI wrapper using @earendil-works/pi-tui for the input editor.
 *
 * This module uses a hybrid approach:
 * - Scrollback/output goes directly to stdout (native terminal scrollback)
 * - Input box uses pi-tui's Editor component for proper editing
 * - The input box is rendered at the bottom of the visible terminal area
 *
 * This preserves the original chump behavior while fixing the input rendering issues.
 */

import process from "node:process";
import readline from "node:readline";
import { setActiveDraft, writeOutput } from "./terminal.ts";
import {
  TUI,
  ProcessTerminal,
  Editor,
  type Component,
  type EditorTheme,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type AutocompleteItem,
  matchesKey,
  visibleWidth,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type {
  ChatAttachment,
  ImageAttachment,
  PromptSubmission,
  SessionSummary,
  SlashCommandMenuContext,
} from "../core/types.ts";
import { completeSlashCommand } from "../app/commands.ts";
import { logClientEvent } from "../app/diagnostics.ts";
import {
  normalizePastedText,
  readClipboardImageAttachment,
  readClipboardText,
  readImageAttachment,
} from "./attachments.ts";
import {
  renderAccent,
  renderMuted,
  renderQueueHint,
  renderQueuedMessage,
} from "./render.ts";

// Editor theme for the input box
const editorTheme: EditorTheme = {
  borderColor: (str: string) => renderMuted(str),
  selectList: {
    selectedPrefix: (str: string) => renderAccent(str),
    selectedText: (str: string) => `\x1b[7m${str}\x1b[0m`,
    description: (str: string) => renderMuted(str),
    scrollInfo: (str: string) => renderMuted(str),
    noMatch: (str: string) => renderMuted(str),
  },
};

const LARGE_PASTE_CHARS = 8000;
const LARGE_PASTE_LINES = 3;

// CSI 2026 synchronized output sequences for atomic screen updates
const SYNC_START = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";

/**
 * Status line component for showing spinner, reasoning preview, etc.
 * Always reserves exactly 1 line to prevent layout shifts.
 * Uses terminal conceal attribute for visibility: hidden behavior.
 */
class StatusComponent implements Component {
  private statusLines: string[] = [];

  render(_width: number): string[] {
    if (this.statusLines.length === 0) {
      // Return a single concealed space character - takes up space but invisible
      // \x1b[8m is the "conceal" ANSI sequence (like visibility: hidden)
      return ["\x1b[8m \x1b[0m"];
    }
    return this.statusLines;
  }

  invalidate(): void {}

  setStatus(status: string | null): void {
    this.statusLines = status ? status.split("\n") : [];
    // Always ensure exactly 1 line is used
    if (this.statusLines.length === 0) {
      // Will be handled in render()
    } else if (this.statusLines.length > 1) {
      // Join multiple lines with spaces to stay on 1 line
      this.statusLines = [this.statusLines.join(" ")];
    }
  }

  getStatus(): string | null {
    return this.statusLines.length > 0 ? this.statusLines.join("\n") : null;
  }
}

/**
 * Queued messages component for showing steering queue
 */
class QueuedMessagesComponent implements Component {
  private queuedDisplay: PromptSubmission[] = [];

  render(_width: number): string[] {
    if (this.queuedDisplay.length === 0) {
      return [];
    }
    const lines: string[] = [];
    for (const queued of this.queuedDisplay) {
      lines.push(renderQueuedMessage(formatSubmissionPreview(queued)));
    }
    lines.push(renderQueueHint());
    return lines;
  }

  invalidate(): void {}

  setQueuedDisplay(submissions: PromptSubmission[]): void {
    this.queuedDisplay = [...submissions];
  }

  getQueuedDisplay(): PromptSubmission[] {
    return this.queuedDisplay;
  }

  popFirst(): PromptSubmission | null {
    return this.queuedDisplay.shift() ?? null;
  }

  popLast(): PromptSubmission | null {
    return this.queuedDisplay.pop() ?? null;
  }
}

/**
 * Footer component for showing model info, session ID, etc.
 */
class FooterComponent implements Component {
  private footer: string | null = null;

  render(width: number): string[] {
    if (!this.footer) {
      return [];
    }
    // Word wrap the footer to fit the terminal width
    return wrapText(this.footer, width);
  }

  invalidate(): void {}

  setFooter(footer: string | null): void {
    this.footer = footer;
  }
}

/**
 * Spacer component for adding blank lines
 */
class SpacerComponent implements Component {
  private visible = true;

  render(_width: number): string[] {
    return this.visible ? [""] : [];
  }

  invalidate(): void {}

  setVisible(visible: boolean): void {
    this.visible = visible;
  }
}

/**
 * Autocomplete provider that integrates with Chump's slash command system
 */
class SlashCommandAutocompleteProvider implements AutocompleteProvider {
  private context: SlashCommandMenuContext = { sessions: [], models: [], skills: [] };

  setContext(context: SlashCommandMenuContext): void {
    this.context = context;
  }

  getContext(): SlashCommandMenuContext {
    return this.context;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    _options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    // Only show suggestions for slash commands on a single line
    const text = lines.join("\n");
    if (lines.length > 1 || !text.startsWith("/")) {
      return null;
    }

    const [views, , suggestions] = completeSlashCommand(text, this.context);
    if (suggestions.length === 0) {
      return null;
    }

    return {
      prefix: text,
      items: suggestions.map((suggestion, index) => ({
        label: views[index]?.command ?? suggestion.command,
        description: views[index]?.description ?? "",
        value: suggestion.command,
      })),
    };
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    _prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    // Replace the entire line with the selected command
    return {
      lines: [item.value],
      cursorLine: 0,
      cursorCol: item.value.length,
    };
  }
}

export interface ChumpTUIOptions {
  onSubmit: (submission: PromptSubmission) => void;
  onAbort?: () => void;
}

/**
 * Main Chump TUI class that manages the terminal interface.
 * 
 * Uses a hybrid approach:
 * - Output goes directly to stdout (scrolls naturally)
 * - Input box is rendered using pi-tui's Editor at the bottom
 */
export class ChumpTUI {
  private terminal: ProcessTerminal;
  private tui: TUI;
  private status: StatusComponent;
  private queuedMessages: QueuedMessagesComponent;
  private spacer: SpacerComponent;
  private editor: Editor;
  private footer: FooterComponent;
  private onSubmitCallback: (submission: PromptSubmission) => void;
  private onAbort?: () => void;
  private started = false;
  private attachments: ChatAttachment[] = [];
  private nextImageNumber = 1;
  private autocompleteProvider: SlashCommandAutocompleteProvider;
  private popQueuedLineHandler: (() => void) | null = null;
  private abortHandler: (() => void) | null = null;
  private lastEscapeAt = 0;
  
  // Track the number of lines the input frame occupies
  private lastFrameHeight = 0;

  constructor(options: ChumpTUIOptions) {
    this.onSubmitCallback = options.onSubmit;
    this.onAbort = options.onAbort;

    // Create terminal and TUI
    this.terminal = new ProcessTerminal();
    this.tui = new TUI(this.terminal, true); // Show hardware cursor

    // Create components (no scrollback - that goes to stdout)
    this.status = new StatusComponent();
    this.queuedMessages = new QueuedMessagesComponent();
    this.spacer = new SpacerComponent();
    this.editor = new Editor(this.tui, editorTheme, { paddingX: 1 });
    this.footer = new FooterComponent();

    // Set up autocomplete provider
    this.autocompleteProvider = new SlashCommandAutocompleteProvider();
    this.editor.setAutocompleteProvider(this.autocompleteProvider);

    // Set up editor submit handler
    this.editor.onSubmit = (text: string) => {
      this.handleSubmit(text);
    };

    // Add components to TUI in order (top to bottom)
    // Note: No scrollback component - output goes directly to stdout
    this.tui.addChild(this.status);
    this.tui.addChild(this.queuedMessages);
    this.tui.addChild(this.spacer);
    this.tui.addChild(this.editor);
    this.tui.addChild(this.footer);

    // Focus the editor
    this.tui.setFocus(this.editor);

    // Add input listener for abort (Ctrl+C or double Escape) and queue pop
    this.tui.addInputListener((data) => {
      // Ctrl+C to abort
      if (matchesKey(data, "ctrl+c")) {
        if (this.abortHandler) {
          logClientEvent("abortShortcut", "ctrl+c");
          this.abortHandler();
          return { consume: true };
        }
        // If no abort handler, let it through (will close the app)
        return undefined;
      }

      // Double Escape to abort
      if (matchesKey(data, "escape")) {
        const now = Date.now();
        if (this.abortHandler && now - this.lastEscapeAt <= 600) {
          this.lastEscapeAt = 0;
          logClientEvent("abortShortcut", "double escape");
          this.abortHandler();
          return { consume: true };
        }
        this.lastEscapeAt = now;
        return { consume: true };
      }

      // Option+Up to pop queued message
      if (isPopQueuedSequence(data)) {
        const editorText = this.editor.getText();
        if (editorText.length === 0 && this.queuedMessages.getQueuedDisplay().length > 0) {
          const queuedLine = this.queuedMessages.popLast();
          if (queuedLine) {
            this.popQueuedLineHandler?.();
            this.editor.setText(queuedLine.text);
            this.attachments = [...queuedLine.attachments];
            this.tui.requestRender();
          }
        }
        return { consume: true };
      }

      // Ctrl+V to paste from clipboard
      if (matchesKey(data, "ctrl+v")) {
        void this.insertClipboard();
        return { consume: true };
      }

      return undefined;
    });
  }

  private handleSubmit(text: string): void {
    const submission = this.buildSubmission(text);
    this.attachments = [];
    this.nextImageNumber = 1;
    this.editor.addToHistory(text);
    this.onSubmitCallback(submission);
  }

  private buildSubmission(text: string): PromptSubmission {
    let cleanText = text;
    for (const attachment of this.attachments) {
      if (attachment.type === "text") {
        cleanText = cleanText.replace(attachment.label, attachment.text);
      }
    }
    return {
      text: cleanText.replace(/[ \t]+\n/g, "\n").replace(/\s+$/u, ""),
      attachments: [...this.attachments],
    };
  }

  private async insertClipboard(): Promise<boolean> {
    const image = await readClipboardImageAttachment().catch(() => null);
    if (image) {
      logClientEvent(
        "clipboardImage",
        `${image.mime} bytes=${Buffer.byteLength(image.data, "base64")}`,
      );
      this.insertImageAttachment(image);
      return true;
    }

    const text = await readClipboardText().catch(() => null);
    if (text) {
      logClientEvent("clipboardText", `chars=${text.length}`);
      await this.insertPaste(text);
      return true;
    }

    logClientEvent("clipboard", "empty");
    return false;
  }

  private async insertPaste(text: string): Promise<void> {
    const normalized = normalizePastedText(text);
    if (!normalized.trim()) {
      await this.insertClipboard();
      return;
    }
    const image = await readImageAttachment(normalized, process.cwd()).catch(() => null);
    if (image) {
      this.insertImageAttachment(image);
      return;
    }
    if (this.isLargePaste(normalized)) {
      this.insertTextAttachment(normalized);
      return;
    }
    this.editor.insertTextAtCursor(normalized);
  }

  private isLargePaste(value: string): boolean {
    if (value.length >= LARGE_PASTE_CHARS) {
      return true;
    }
    return value.split("\n").length >= LARGE_PASTE_LINES;
  }

  private insertImageAttachment(image: ImageAttachment): void {
    const label = `[Image ${this.nextImageNumber++}: ${image.filename}]`;
    this.attachments.push({ ...image, label });
    this.editor.insertTextAtCursor(`${label} `);
  }

  private insertTextAttachment(text: string): void {
    const lineCount = text.split("\n").length;
    const label = `[Pasted ~${lineCount} lines]`;
    this.attachments.push({ type: "text", label, text });
    this.editor.insertTextAtCursor(`${label} `);
  }

  /**
   * Build the clear sequence to remove the current input frame.
   * Moves cursor up by the frame height and clears to end of screen.
   */
  buildClear(): string {
    if (this.lastFrameHeight === 0) {
      return "\r\x1b[2K";
    }
    const moveUp = this.lastFrameHeight > 1 ? `\x1b[${this.lastFrameHeight - 1}A` : "";
    this.lastFrameHeight = 0;
    return `\r${moveUp}\x1b[J`;
  }

  /**
   * Build the redraw sequence for the input frame.
   * Renders all components and positions cursor correctly.
   */
  buildRedraw(): string {
    if (!this.started) {
      return "";
    }

    const width = this.terminal.columns;
    const lines: string[] = [];

    // Render each component
    lines.push(...this.status.render(width));
    lines.push(...this.queuedMessages.render(width));
    lines.push(...this.spacer.render(width));
    lines.push(...this.editor.render(width));
    lines.push(...this.footer.render(width));

    if (lines.length === 0) {
      return "";
    }

    this.lastFrameHeight = lines.length;

    // Mark a full redraw needed after this frame is written to the terminal.
    // This ensures pi-tui's differential rendering doesn't get confused.

    // Build the output with proper line handling
    const output: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        output.push("\n");
      }
      output.push("\r\x1b[2K");
      output.push(lines[i]);
    }

    return output.join("");
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.tui.start();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    // Clear the input frame before stopping
    process.stdout.write(this.buildClear());
    this.tui.stop();
  }

  /**
   * Write output to stdout, clearing and redrawing the input frame.
   * This is the key method that coordinates output with the input box.
   *
   * Batches writes within the same event-loop tick to avoid recomputing the
   * entire input frame on every call during model streaming.
   */
  private writeBuffer = "";
  private writeScheduled = false;

  write(value: string): void {
    if (!this.started) {
      process.stdout.write(value);
      return;
    }

    this.writeBuffer += value;
    if (!this.writeScheduled) {
      this.writeScheduled = true;
      setImmediate(() => {
        this.writeScheduled = false;
        const clear = this.buildClear();
        const redraw = this.buildRedraw();
        const payload = this.writeBuffer;
        this.writeBuffer = "";
        // Suppress pi-tui differential rendering so it doesn't race
        // with our manual frame write. The next buildRedraw() call
        // will produce a fresh frame from pi-tui's updated state.
        this.tui.requestRender(true);
        process.stdout.write(`${SYNC_START}${clear}${payload}${redraw}${SYNC_END}`);
      });
    }
  }

  /**
   * Set the status line (spinner, reasoning preview, etc.)
   */
  setStatus(status: string | null): void {
    const current = this.status.getStatus();
    if (current === status) {
      return;
    }
    this.status.setStatus(status);
    this.requestRender();
  }

  /**
   * Set the footer line (model info, session ID, etc.)
   */
  setFooter(footer: string | null): void {
    this.footer.setFooter(footer);
    this.requestRender();
  }

  /**
   * Set the queued display (steering queue)
   */
  setQueuedDisplay(submissions: PromptSubmission[]): void {
    this.queuedMessages.setQueuedDisplay(submissions);
    this.requestRender();
  }

  /**
   * Pop the first queued message
   */
  popQueuedDisplay(): void {
    this.queuedMessages.popFirst();
    this.requestRender();
  }

  /**
   * Set the handler for when a queued line is popped
   */
  setQueuedLinePopHandler(handler: (() => void) | null): void {
    this.popQueuedLineHandler = handler;
  }

  /**
   * Set the abort handler (called on Ctrl+C or double Escape)
   */
  setAbortHandler(handler: (() => void) | null): void {
    this.abortHandler = handler;
    this.lastEscapeAt = 0;
  }

  /**
   * Set session suggestions for autocomplete
   */
  setSessionSuggestions(sessions: SessionSummary[]): void {
    const context = { ...this.getAutocompleteContext(), sessions };
    this.autocompleteProvider.setContext(context);
  }

  /**
   * Set model suggestions for autocomplete
   */
  setModelSuggestions(models: SlashCommandMenuContext["models"]): void {
    const context = { ...this.getAutocompleteContext(), models };
    this.autocompleteProvider.setContext(context);
  }

  /**
   * Set skill suggestions for autocomplete
   */
  setSkillSuggestions(skills: SlashCommandMenuContext["skills"]): void {
    const context = { ...this.getAutocompleteContext(), skills };
    this.autocompleteProvider.setContext(context);
  }

  private getAutocompleteContext(): SlashCommandMenuContext {
    return this.autocompleteProvider.getContext();
  }

  /**
   * Clear the terminal completely.
   */
  clearTerminal(): void {
    const clear = this.buildClear();
    const redraw = this.buildRedraw();
    process.stdout.write(`${SYNC_START}${clear}\x1b[2J\x1b[3J\x1b[H${redraw}${SYNC_END}`);
  }

  /**
   * Get the editor text.
   */
  getEditorText(): string {
    return this.editor.getText();
  }

  /**
   * Set the editor text.
   */
  setEditorText(text: string): void {
    this.editor.setText(text);
    this.requestRender();
  }

  /**
   * Request a render update. When the draft system is active, defers to the
   * batch cycle (writeOutput → buildClear/buildRedraw) instead of writing
   * directly to stdout, preventing races between the two rendering systems.
   */
  requestRender(): void {
    if (!this.started) return;
    // If the draft system is active, trigger a flush through it so the
    // next buildRedraw() picks up the latest component state.
    // We write an empty string to ensure the batch flushes even if no
    // other output is pending.
    if (activeDraftSet) {
      writeOutputDraftTrigger("");
      return;
    }
    const clear = this.buildClear();
    const redraw = this.buildRedraw();
    process.stdout.write(`${SYNC_START}${clear}${redraw}${SYNC_END}`);
  }

  /**
   * Cancel any pi-tui render that is queued but not yet painted.
   * pi-tui defers renders via process.nextTick / setTimeout and checks
   * this.renderRequested before actually writing to the terminal.
   * Setting it to false here makes those deferred callbacks no-ops,
   * preventing pi-tui from overwriting a frame we are about to emit.
   */
  cancelPendingRender(): void {
    (this.tui as unknown as { renderRequested: boolean }).renderRequested = false;
  }

  /**
   * Check if the TUI is started
   */
  isStarted(): boolean {
    return this.started;
  }
}

let activeDraftSet = false;
let writeOutputDraftTrigger: (value: string) => void = () => {};

// Helper functions

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
  const images = submission.attachments.filter((attachment) => attachment.type === "image").length;
  const pastes = submission.attachments.filter((attachment) => attachment.type === "text").length;
  const suffix = [
    images > 0 ? `${images} image${images === 1 ? "" : "s"}` : "",
    pastes > 0 ? `${pastes} paste${pastes === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [text, suffix].filter(Boolean).join(" ");
}

function isPopQueuedSequence(sequence: string): boolean {
  return [
    "\x1b[1;3A", // Alt+Up
    "\x1b[1;9A", // Meta+Up
    "\x1b[1;2A", // Shift+Up
    "\x1b[1;4A", // Shift+Alt+Up
    "\x1b[1;5A", // Ctrl+Up
    "\x1b[1;6A", // Ctrl+Shift+Up
    "\x1b[1;7A", // Ctrl+Alt+Up
    "\x1b[1;8A", // Ctrl+Shift+Alt+Up
  ].includes(sequence);
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const inputLines = text.split("\n");

  for (const line of inputLines) {
    if (visibleWidth(line) <= width) {
      lines.push(line);
    } else {
      // Simple word wrap
      let current = "";
      let currentWidth = 0;
      const words = line.split(/(\s+)/);

      for (const word of words) {
        const wordWidth = visibleWidth(word);
        if (currentWidth + wordWidth <= width) {
          current += word;
          currentWidth += wordWidth;
        } else if (currentWidth === 0) {
          // Word is longer than width, truncate it
          lines.push(truncateToWidth(word, width));
        } else {
          lines.push(current);
          current = word.trimStart();
          currentWidth = visibleWidth(current);
        }
      }
      if (current) {
        lines.push(current);
      }
    }
  }

  return lines;
}

// Singleton instance
let instance: ChumpTUI | null = null;

export function createChumpTUI(options: ChumpTUIOptions): ChumpTUI {
  if (instance) {
    instance.stop();
  }
  instance = new ChumpTUI(options);
  return instance;
}

export function getChumpTUI(): ChumpTUI | null {
  return instance;
}

/**
 * Create a prompt reader that uses the TUI system.
 * This provides the same interface as the old createPromptReader but uses pi-tui.
 */
export function createTUIPromptReader(): {
  read: () => Promise<PromptSubmission | null>;
  close: () => void;
  popQueuedDisplay: () => void;
  setQueuedDisplay: (submissions: PromptSubmission[]) => void;
  setQueuedLinePopHandler: (handler: (() => void) | null) => void;
  setModelSuggestions: (models: SlashCommandMenuContext["models"]) => void;
  setSkillSuggestions: (skills: SlashCommandMenuContext["skills"]) => void;
  setAbortHandler: (handler: (() => void) | null) => void;
  setSessionSuggestions: (sessions: SessionSummary[]) => void;
  setStatus: (status: string | null) => void;
  setFooter: (footer: string | null) => void;
  } {
  let pendingResolve: ((value: PromptSubmission | null) => void) | null = null;
  let closed = false;

  const tui = createChumpTUI({
    onSubmit: (submission: PromptSubmission) => {
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve(submission);
      }
    },
  });

  // Wire the TUI into the activeDraft system so writeOutput() / writeOutputLine()
  // calls from app.ts, events.ts, and commands.ts go through the TUI's
  // clear → content → redraw cycle instead of writing directly to stdout.
  // This prevents the input box from being overwritten or skewed by streaming
  // output that bypasses the TUI render.
  setActiveDraft({
    buildClear: () => tui.buildClear(),
    buildRedraw: () => tui.buildRedraw(),
    beforeFlush: () => {
      // Cancel any render pi-tui has queued (via process.nextTick or setTimeout)
      // so it doesn't overwrite the atomic clear→content→redraw we are about
      // to emit.  pi-tui checks this.renderRequested before actually painting,
      // so setting it to false here is sufficient to suppress the pending render.
      tui.cancelPendingRender();
    },
  });

  activeDraftSet = true;
  writeOutputDraftTrigger = (value: string) => writeOutput(value);

  tui.start();

  return {
    read(): Promise<PromptSubmission | null> {
      if (closed) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    },

    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      const resolve = pendingResolve;
      pendingResolve = null;
      tui.stop();
      setActiveDraft(null);
      activeDraftSet = false;
      writeOutputDraftTrigger = () => {};
      resolve?.(null);
    },

    popQueuedDisplay(): void {
      tui.popQueuedDisplay();
    },

    setQueuedDisplay(submissions: PromptSubmission[]): void {
      tui.setQueuedDisplay(submissions);
    },

    setQueuedLinePopHandler(handler: (() => void) | null): void {
      tui.setQueuedLinePopHandler(handler);
    },

    setModelSuggestions(models: SlashCommandMenuContext["models"]): void {
      tui.setModelSuggestions(models);
    },

    setSkillSuggestions(skills: SlashCommandMenuContext["skills"]): void {
      tui.setSkillSuggestions(skills);
    },

    setAbortHandler(handler: (() => void) | null): void {
      tui.setAbortHandler(handler);
    },

    setSessionSuggestions(sessions: SessionSummary[]): void {
      tui.setSessionSuggestions(sessions);
    },

    setStatus(status: string | null): void {
      tui.setStatus(status);
    },

    setFooter(footer: string | null): void {
      tui.setFooter(footer);
    },
  };
}

/**
 * Write output to the TUI scrollback.
 * This replaces writeOutput from terminal.ts when using the TUI.
 */
export function writeTUIOutput(value: string): void {
  const tui = getChumpTUI();
  if (tui) {
    tui.write(value);
  } else {
    // Fallback to direct stdout
    process.stdout.write(value);
  }
}

/**
 * Write a line to the TUI scrollback.
 */
export function writeTUIOutputLine(value = ""): void {
  writeTUIOutput(`${value}\n`);
}

/**
 * Clear the terminal when using TUI.
 */
export function clearTUITerminal(): void {
  const tui = getChumpTUI();
  if (tui) {
    tui.clearTerminal();
  } else {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  }
}
