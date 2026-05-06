import readline from "node:readline";
import type { Interface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import { completeSlashCommand } from "../app/commands.ts";
import { logClientEvent } from "../app/diagnostics.ts";
import type { ChatAttachment, ImageAttachment, PromptSubmission } from "../core/types.ts";
import type {
  SessionSummary,
  SlashCommandMenuContext,
  SlashCommandSuggestion,
  SlashCommandSuggestionView,
} from "../core/types.ts";
import {
  normalizePastedText,
  readClipboardImageAttachment,
  readClipboardText,
  readImageAttachment,
} from "./attachments.ts";
import { setActiveDraft } from "./terminal.ts";
import {
  renderContinuationPrompt,
  renderInput,
  renderInputRule,
  renderPrompt,
  renderQueueHint,
  renderQueuedMessage,
  renderSlashCommandMenu,
} from "./render.ts";

const inputHistory: string[] = [];

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const LARGE_PASTE_CHARS = 8000;
const LARGE_PASTE_LINES = 3;

export async function readPrompt(fallbackRl: Interface | null): Promise<string | null> {
  if (!input.isTTY) {
    try {
      return await (fallbackRl?.question(renderPrompt()) ?? null);
    } catch (error) {
      if (error instanceof Error && error.message === "readline was closed") {
        return null;
      }
      throw error;
    }
  }
  const submission = await readInteractivePrompt();
  return submission?.text ?? null;
}

export function createPromptReader(fallbackRl: Interface | null): {
  read: () => Promise<PromptSubmission | null>;
  close: () => void;
  popQueuedDisplay: () => void;
  setQueuedLinePopHandler: (handler: (() => void) | null) => void;
  setModelSuggestions: (models: SlashCommandMenuContext["models"]) => void;
  setSkillSuggestions: (skills: SlashCommandMenuContext["skills"]) => void;
  setAbortHandler: (handler: (() => void) | null) => void;
  setSessionSuggestions: (sessions: SessionSummary[]) => void;
  setStatus: (status: string | null) => void;
  setFooter: (footer: string | null) => void;
} {
  if (!input.isTTY) {
    return {
      read: async () => {
        const text = await readPrompt(fallbackRl);
        return text === null ? null : buildSubmission(text, []);
      },
      close: () => fallbackRl?.close(),
      popQueuedDisplay: () => {},
      setQueuedLinePopHandler: () => {},
      setModelSuggestions: () => {},
      setSkillSuggestions: () => {},
      setAbortHandler: () => {},
      setSessionSuggestions: () => {},
      setStatus: () => {},
      setFooter: () => {},
    };
  }

  return createInteractivePromptReader();
}

function readInteractivePrompt(): Promise<PromptSubmission | null> {
  const reader = createInteractivePromptReader();
  return reader.read().finally(() => reader.close());
}

function createInteractivePromptReader(): {
  read: () => Promise<PromptSubmission | null>;
  close: () => void;
  popQueuedDisplay: () => void;
  setQueuedLinePopHandler: (handler: (() => void) | null) => void;
  setModelSuggestions: (models: SlashCommandMenuContext["models"]) => void;
  setSkillSuggestions: (skills: SlashCommandMenuContext["skills"]) => void;
  setAbortHandler: (handler: (() => void) | null) => void;
  setSessionSuggestions: (sessions: SessionSummary[]) => void;
  setStatus: (status: string | null) => void;
  setFooter: (footer: string | null) => void;
} {
  readline.emitKeypressEvents(input);
  input.setRawMode(true);

  let value = "";
  let cursor = 0;
  let attachments: ChatAttachment[] = [];
  let cursorLine = 0;
  let historyIndex = inputHistory.length;
  let pendingResolve: ((value: PromptSubmission | null) => void) | null = null;
  let queuedDisplay: PromptSubmission[] = [];
  let statusLine: string | null = null;
  let footerLine: string | null = null;
  let closed = false;
  let slashSelection = 0;
  let slashMenuContext: SlashCommandMenuContext = { sessions: [], models: [], skills: [] };
  let abortHandler: (() => void) | null = null;
  let popQueuedLine: (() => void) | null = null;
  let lastEscapeAt = 0;
  let pasteBuffer: string | null = null;
  let nextImageNumber = 1;
  let lastColumns = terminalColumns();
  let redrawScheduled = false;
  let lastPromptRows: string[] = [];
  let lastFooterRows: string[] = [];

  output.write("\x1b[?2004h");

  function clear(): void {
    const lastFrameRows = [...lastPromptRows, ...lastFooterRows];
    if (lastFrameRows.length === 0) {
      output.write("\r\x1b[2K");
      cursorLine = 0;
      return;
    }
    const moveUp = cursorLine > 0 ? `\x1b[${cursorLine}A` : "";
    const clearRows = lastFrameRows.map((_, index) => `${index === 0 ? "" : "\n"}\r\x1b[2K`).join("");
    const moveBackUp = lastFrameRows.length > 1 ? `\x1b[${lastFrameRows.length - 1}A` : "";
    output.write(`\r${moveUp}${clearRows}${moveBackUp}\r`);
    cursorLine = 0;
    lastPromptRows = [];
    lastFooterRows = [];
  }

  function redraw(): void {
    if (closed || !pendingResolve) {
      return;
    }

    redrawScheduled = false;

    const lines = value.split("\n");
    const target = cursorPosition(value, cursor);
    const slashMenu = getVisibleSlashMenu();
    const statusLines = statusLine ? statusLine.split("\n") : [];
    const footerLines = footerLine ? footerLine.split("\n") : [];
    const menuLines = renderSlashCommandMenu(
      slashMenu.items,
      slashMenu.selectedIndex,
      {
        hiddenAbove: slashMenu.hiddenAbove,
        hiddenBelow: slashMenu.hiddenBelow,
      },
    );
    const menuTopSpacerLines = menuLines.length > 0 ? 1 : 0;
    const queueLines = queuedDisplay.length > 0
      ? [
          ...queuedDisplay.map((queued) => renderQueuedMessage(formatSubmissionPreview(queued))),
          renderQueueHint(),
        ]
      : [];
    const inputIndent = " ";
    const rule = renderInputRule(terminalColumns() - 2);
    const promptLines = [
      rule,
      ...lines.map((line) => `${inputIndent}${renderInput(line)}`),
      rule,
    ];
    const promptFrameLines = [
      ...statusLines,
      ...queueLines,
      ...(menuTopSpacerLines > 0 ? [""] : []),
      ...menuLines,
      "",
      ...promptLines,
    ];
    const cursorFrameLineIndex =
      statusLines.length +
      queueLines.length +
      menuTopSpacerLines +
      menuLines.length +
      2 +
      target.line;

    const layout = measureFrameLayout(
      promptFrameLines,
      cursorFrameLineIndex,
      visibleLength(inputIndent) + target.column,
    );
    const promptRows = promptFrameLines.flatMap((line) => wrapAnsiLine(line, terminalColumns()));
    const footerRows = footerLines.flatMap((line) => wrapAnsiLine(line, terminalColumns()));
    const preserveFooter =
      sameRows(footerRows, lastFooterRows) &&
      promptRows.length === lastPromptRows.length;
    const renderedRows = preserveFooter
      ? promptRows
      : [...promptRows, ...footerRows];
    const previousTotalRows = lastPromptRows.length + lastFooterRows.length;
    const totalRows = preserveFooter
      ? Math.max(promptRows.length, 1)
      : Math.max(renderedRows.length, previousTotalRows, 1);
    const rowsUp = Math.max(0, totalRows - 1 - layout.cursorRow);
    const moveUp = cursorLine > 0 ? `\x1b[${cursorLine}A` : "";
    const moveToCursorRow = rowsUp > 0 ? `\x1b[${rowsUp}A` : "";
    const moveToCursorColumn = layout.cursorColumn > 0 ? `\x1b[${layout.cursorColumn}C` : "";
    const rows: string[] = [];

    for (let index = 0; index < totalRows; index += 1) {
      const nextRow = renderedRows[index] ?? "";
      rows.push(`${index === 0 ? "" : "\n"}\r\x1b[2K${nextRow}`);
    }

    output.write(
      `\r${moveUp}\x1b[?25l${rows.join("")}\x1b[?25h${moveToCursorRow}\r${moveToCursorColumn}`,
    );
    cursorLine = layout.cursorRow;
    lastPromptRows = promptRows;
    lastFooterRows = footerRows;
  }

  function redrawOnResize(): void {
    const columns = terminalColumns();
    if (columns === lastColumns) {
      return;
    }
    lastColumns = columns;
    requestRedraw();
  }

  function requestRedraw(): void {
    if (closed || !pendingResolve || redrawScheduled) {
      return;
    }
    redrawScheduled = true;
    setImmediate(() => {
      redraw();
    });
  }

  function finish(result: PromptSubmission | string | null): void {
    if (!pendingResolve) {
      return;
    }

    const resolve = pendingResolve;
    pendingResolve = null;
    clear();

    const submission = typeof result === "string"
      ? buildSubmission(result, [])
      : result;

    if (submission?.text.trim()) {
      inputHistory.push(submission.text);
    }

    if (submission !== null) {
      queuedDisplay.push(submission);
      value = "";
      cursor = 0;
      attachments = [];
      historyIndex = inputHistory.length;
      pendingResolve = null;
      requestRedraw();
    } else {
      pendingResolve = null;
    }

    resolve(submission);
  }

  function insertText(text: string): void {
    value = `${value.slice(0, cursor)}${text}${value.slice(cursor)}`;
    cursor += text.length;
    historyIndex = inputHistory.length;
    slashSelection = 0;
    syncSlashSelection();
    requestRedraw();
  }

  async function insertPaste(text: string): Promise<void> {
    const normalized = normalizePastedText(text);
    if (!normalized.trim()) {
      await insertClipboard();
      return;
    }
    const image = await readImageAttachment(normalized, process.cwd()).catch(() => null);
    if (image) {
      insertImageAttachment(image);
      return;
    }
    if (isLargePaste(normalized)) {
      insertTextAttachment(normalized);
      return;
    }
    insertText(normalized);
  }

  async function insertClipboard(): Promise<boolean> {
    const image = await readClipboardImageAttachment().catch(() => null);
    if (image) {
      logClientEvent("clipboardImage", `${image.mime} bytes=${Buffer.byteLength(image.data, "base64")}`);
      insertImageAttachment(image);
      return true;
    }

    const text = await readClipboardText().catch(() => null);
    if (text) {
      logClientEvent("clipboardText", `chars=${text.length}`);
      await insertPaste(text);
      return true;
    }

    logClientEvent("clipboard", "empty");
    return false;
  }

  function insertImageAttachment(image: ImageAttachment): void {
    const label = `[Image ${nextImageNumber++}: ${image.filename}]`;
    attachments.push({ ...image, label });
    insertText(`${label} `);
  }

  function insertTextAttachment(text: string): void {
    const lineCount = text.split("\n").length;
    const label = `[Pasted ~${lineCount} lines]`;
    attachments.push({ type: "text", label, text });
    insertText(`${label} `);
  }

  function deleteRange(start: number, end: number): void {
    if (start === end) {
      return;
    }
    const expanded = expandRangeForAttachments(start, end);
    value = `${value.slice(0, expanded.start)}${value.slice(expanded.end)}`;
    attachments = expanded.attachments;
    cursor = expanded.start;
    historyIndex = inputHistory.length;
    slashSelection = 0;
    syncSlashSelection();
    requestRedraw();
  }

  function expandRangeForAttachments(
    start: number,
    end: number,
  ): { start: number; end: number; attachments: ChatAttachment[] } {
    let nextStart = start;
    let nextEnd = end;
    const keep: ChatAttachment[] = [];

    for (const attachment of attachments) {
      const range = findAttachmentLabelRange(value, attachment);
      if (!range) {
        continue;
      }
      const spaceEnd = range.end + trailingSpaceLength(value, range.end);
      if (rangesOverlap(start, end, range.start, spaceEnd)) {
        nextStart = Math.min(nextStart, range.start);
        nextEnd = Math.max(nextEnd, spaceEnd);
        continue;
      }
      keep.push(attachment);
    }

    return {
      start: nextStart,
      end: nextEnd,
      attachments: keep,
    };
  }

  function clearDraft(): void {
    if (value.length === 0) {
      return;
    }
    value = "";
    cursor = 0;
    historyIndex = inputHistory.length;
    slashSelection = 0;
    syncSlashSelection();
    requestRedraw();
  }

  function deletePreviousWord(): void {
    if (cursor === 0) {
      return;
    }
    deleteRange(previousWordStart(value, cursor), cursor);
  }

  function deleteNextWord(): void {
    if (cursor >= value.length) {
      return;
    }
    deleteRange(cursor, nextWordEnd(value, cursor));
  }

  function moveCursor(nextCursor: number): void {
    const clampedCursor = Math.max(0, Math.min(value.length, nextCursor));
    if (clampedCursor === cursor) {
      return;
    }
    cursor = clampedCursor;
    requestRedraw();
  }

  function moveWordLeft(): void {
    moveCursor(previousWordStart(value, cursor));
  }

  function moveWordRight(): void {
    moveCursor(nextWordEnd(value, cursor));
  }

  function moveLineStart(): void {
    moveCursor(lineStartIndex(value, cursor));
  }

  function moveLineEnd(): void {
    moveCursor(lineEndIndex(value, cursor));
  }

  function moveDraftStart(): void {
    moveCursor(0);
  }

  function moveDraftEnd(): void {
    moveCursor(value.length);
  }

  function recallHistory(nextIndex: number): void {
    historyIndex = Math.max(0, Math.min(inputHistory.length, nextIndex));
    value = historyIndex === inputHistory.length ? "" : inputHistory[historyIndex] ?? "";
    cursor = value.length;
    slashSelection = 0;
    syncSlashSelection();
    requestRedraw();
  }

  function getSlashMenuState(): {
    views: SlashCommandSuggestionView[];
    suggestions: SlashCommandSuggestion[];
  } {
    if (value.includes("\n") || !value.startsWith("/")) {
      return { views: [], suggestions: [] };
    }
    const [views, , suggestions] = completeSlashCommand(value, slashMenuContext);
    return {
      views,
      suggestions,
    };
  }

  function getVisibleSlashMenu(): {
    items: SlashCommandSuggestionView[];
    selectedIndex: number;
    hiddenAbove: number;
    hiddenBelow: number;
    lineCount: number;
  } {
    const state = getSlashMenuState();
    if (state.views.length === 0) {
      return {
        items: [],
        selectedIndex: 0,
        hiddenAbove: 0,
        hiddenBelow: 0,
        lineCount: 0,
      };
    }

    const maxVisible = 6;
    const total = state.views.length;
    const start = Math.max(
      0,
      Math.min(total - maxVisible, slashSelection - Math.floor(maxVisible / 2)),
    );
    const end = Math.min(total, start + maxVisible);
    const items = state.views.slice(start, end);
    const hiddenAbove = start;
    const hiddenBelow = total - end;

    return {
      items,
      selectedIndex: slashSelection - start,
      hiddenAbove,
      hiddenBelow,
      lineCount: items.length + (hiddenAbove > 0 ? 1 : 0) + (hiddenBelow > 0 ? 1 : 0),
    };
  }

  function syncSlashSelection(): void {
    const state = getSlashMenuState();
    if (state.suggestions.length === 0) {
      slashSelection = 0;
      return;
    }
    slashSelection = Math.max(0, Math.min(slashSelection, state.suggestions.length - 1));
  }

  function moveSlashSelection(direction: -1 | 1): boolean {
    const state = getSlashMenuState();
    if (state.suggestions.length === 0) {
      return false;
    }
    slashSelection = (slashSelection + direction + state.suggestions.length) % state.suggestions.length;
    requestRedraw();
    return true;
  }

  function applySlashSelection(submitIfSelected: boolean): boolean {
    const state = getSlashMenuState();
    if (state.suggestions.length === 0) {
      return false;
    }
    const selected = state.suggestions[slashSelection];
    if (!selected) {
      return false;
    }
    if (selected.action === "submit" && submitIfSelected) {
      cursor = selected.command.length;
      finish(selected.command);
      return true;
    }
    if (value === selected.command) {
      return false;
    }
    value = selected.command;
    cursor = value.length;
    historyIndex = inputHistory.length;
    syncSlashSelection();
    requestRedraw();
    return true;
  }

  function moveVertical(direction: -1 | 1): void {
    if (moveSlashSelection(direction)) {
      return;
    }

    const position = cursorPosition(value, cursor);
    const lines = value.split("\n");
    const targetLine = position.line + direction;

    if (targetLine < 0) {
      if (lines.length === 1) {
        recallHistory(historyIndex - 1);
      }
      return;
    }

    if (targetLine >= lines.length) {
      if (lines.length === 1 && historyIndex < inputHistory.length) {
        recallHistory(historyIndex + 1);
      }
      return;
    }

    cursor = indexFromPosition(lines, targetLine, position.column);
    requestRedraw();
  }

  function onData(chunk: Buffer): void {
    if (!pendingResolve) {
      return;
    }

    const sequence = chunk.toString("utf8");

    if (pasteBuffer !== null) {
      const end = sequence.indexOf(BRACKETED_PASTE_END);
      if (end === -1) {
        pasteBuffer += sequence;
        return;
      }
      const pasted = pasteBuffer + sequence.slice(0, end);
      pasteBuffer = null;
      void insertPaste(pasted);
      const rest = sequence.slice(end + BRACKETED_PASTE_END.length);
      if (rest) {
        onData(Buffer.from(rest, "utf8"));
      }
      return;
    }

    const pasteStart = sequence.indexOf(BRACKETED_PASTE_START);
    if (pasteStart !== -1) {
      const before = sequence.slice(0, pasteStart);
      const afterStart = sequence.slice(pasteStart + BRACKETED_PASTE_START.length);
      if (before) {
        onData(Buffer.from(before, "utf8"));
      }
      const pasteEnd = afterStart.indexOf(BRACKETED_PASTE_END);
      if (pasteEnd === -1) {
        pasteBuffer = afterStart;
        return;
      }
      const pasted = afterStart.slice(0, pasteEnd);
      const after = afterStart.slice(pasteEnd + BRACKETED_PASTE_END.length);
      void insertPaste(pasted);
      if (after) {
        onData(Buffer.from(after, "utf8"));
      }
      return;
    }

    if (sequence === "\u0003") {
      finish(null);
      return;
    }

    if (sequence === "\u0004" && value.length === 0) {
      finish(null);
      return;
    }

    if (sequence === "\u0016") {
      void insertClipboard();
      return;
    }

    if (sequence === "\x1b") {
      const now = Date.now();
      if (abortHandler && now - lastEscapeAt <= 600) {
        lastEscapeAt = 0;
        logClientEvent("abortShortcut", "double escape");
        abortHandler();
        return;
      }
      lastEscapeAt = now;
      return;
    }

    lastEscapeAt = 0;

    if (isPopQueuedSequence(sequence)) {
      if (value.length === 0 && queuedDisplay.length > 0) {
        const queuedLine = queuedDisplay.at(-1) ?? null;
        if (!queuedLine) {
          return;
        }
        popQueuedLine?.();
        queuedDisplay.pop();
        value = queuedLine.text;
        cursor = value.length;
        attachments = [...queuedLine.attachments];
        historyIndex = inputHistory.length;
        slashSelection = 0;
        syncSlashSelection();
        requestRedraw();
      }
      return;
    }

    if (isInsertNewlineSequence(sequence)) {
      insertText("\n");
      return;
    }

    if (sequence === "\t") {
      if (!value.includes("\n") && value.startsWith("/")) {
        if (!applySlashSelection(false)) {
          moveSlashSelection(1);
        }
      }
      return;
    }

    if (isClearDraftSequence(sequence)) {
      clearDraft();
      return;
    }

    if (isDeletePreviousWordSequence(sequence)) {
      deletePreviousWord();
      return;
    }

    if (isDeleteNextWordSequence(sequence)) {
      deleteNextWord();
      return;
    }

    if (sequence === "\u007f" || sequence === "\b") {
      if (cursor === 0) {
        return;
      }
      deleteRange(cursor - 1, cursor);
      return;
    }

    if (isMoveWordLeftSequence(sequence)) {
      moveWordLeft();
      return;
    }

    if (isMoveWordRightSequence(sequence)) {
      moveWordRight();
      return;
    }

    if (sequence === "\x1b[D") {
      moveCursor(cursor - 1);
      return;
    }

    if (sequence === "\x1b[C") {
      moveCursor(cursor + 1);
      return;
    }

    if (isMoveDraftStartSequence(sequence)) {
      moveDraftStart();
      return;
    }

    if (isMoveDraftEndSequence(sequence)) {
      moveDraftEnd();
      return;
    }

    if (sequence === "\x1b[A") {
      moveVertical(-1);
      return;
    }

    if (sequence === "\x1b[B") {
      moveVertical(1);
      return;
    }

    if (sequence === "\r") {
      if (value.startsWith("/") && applySlashSelection(true)) {
        return;
      }
      cursor = value.length;
      finish(buildSubmission(value, attachments));
      return;
    }

    if (sequence === "\x1b[3~") {
      if (cursor < value.length) {
        deleteRange(cursor, cursor + 1);
      }
      return;
    }

    if (isMoveLineStartSequence(sequence)) {
      moveLineStart();
      return;
    }

    if (isMoveLineEndSequence(sequence)) {
      moveLineEnd();
      return;
    }

    if (sequence.startsWith("\x1b") || sequence < " ") {
      return;
    }

    if (isLikelyRawPaste(sequence)) {
      void insertPaste(sequence);
      return;
    }

    insertText(sequence);
  }

  input.on("data", onData);
  output.on("resize", redrawOnResize);

  return {
    read() {
      if (closed) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        value = "";
        cursor = 0;
        attachments = [];
        nextImageNumber = 1;
        slashSelection = 0;
        historyIndex = inputHistory.length;
        pendingResolve = resolve;
        setActiveDraft({ clear, redraw });
        redraw();
      });
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      const resolve = pendingResolve;
      pendingResolve = null;
      clear();
      output.write("\x1b[?2004l");
      input.off("data", onData);
      output.off("resize", redrawOnResize);
      input.setRawMode(false);
      input.pause();
      setActiveDraft(null);
      resolve?.(null);
    },
    popQueuedDisplay() {
      queuedDisplay.shift();
      requestRedraw();
    },
    setQueuedLinePopHandler(handler: (() => void) | null) {
      popQueuedLine = handler;
    },
    setAbortHandler(handler: (() => void) | null) {
      abortHandler = handler;
      lastEscapeAt = 0;
    },
    setSessionSuggestions(sessions: SessionSummary[]) {
      slashMenuContext = { ...slashMenuContext, sessions };
      syncSlashSelection();
      requestRedraw();
    },
    setModelSuggestions(models: SlashCommandMenuContext["models"]) {
      slashMenuContext = { ...slashMenuContext, models };
      syncSlashSelection();
      requestRedraw();
    },
    setSkillSuggestions(skills: SlashCommandMenuContext["skills"]) {
      slashMenuContext = { ...slashMenuContext, skills };
      syncSlashSelection();
      requestRedraw();
    },
    setStatus(status: string | null) {
      if (statusLine === status) {
        return;
      }
      statusLine = status;
      requestRedraw();
    },
    setFooter(footer: string | null) {
      if (footerLine === footer) {
        return;
      }
      footerLine = footer;
      requestRedraw();
    },
  };
}

function buildSubmission(text: string, attachments: ChatAttachment[]): PromptSubmission {
  let cleanText = text;
  for (const attachment of attachments) {
    if (attachment.type === "text") {
      cleanText = cleanText.replace(attachment.label, attachment.text);
    }
  }
  return {
    text: cleanText.replace(/[ \t]+\n/g, "\n").replace(/\s+$/u, ""),
    attachments: [...attachments],
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
  const images = submission.attachments.filter((attachment) => attachment.type === "image").length;
  const pastes = submission.attachments.filter((attachment) => attachment.type === "text").length;
  const suffix = [
    images > 0 ? `${images} image${images === 1 ? "" : "s"}` : "",
    pastes > 0 ? `${pastes} paste${pastes === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" ");
  return [text, suffix].filter(Boolean).join(" ");
}

function findAttachmentLabelRange(
  value: string,
  attachment: ChatAttachment,
): { start: number; end: number } | null {
  const start = value.indexOf(attachment.label);
  if (start === -1) {
    return null;
  }
  return { start, end: start + attachment.label.length };
}

function rangesOverlap(
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number,
): boolean {
  return start < rangeEnd && end > rangeStart;
}

function trailingSpaceLength(value: string, index: number): number {
  return value[index] === " " ? 1 : 0;
}

function isLargePaste(value: string): boolean {
  if (value.length >= LARGE_PASTE_CHARS) {
    return true;
  }
  return value.split("\n").length >= LARGE_PASTE_LINES;
}

function isLikelyRawPaste(value: string): boolean {
  const normalized = normalizePastedText(value);
  const trimmed = normalized.trim();
  if (normalized.includes("\n")) {
    return true;
  }
  return /\.(?:png|jpe?g|webp|gif)(?:["']?\s*)$/iu.test(trimmed);
}

function measureFrameLayout(
  lines: string[],
  cursorLineIndex: number,
  cursorColumn: number,
): {
  totalRows: number;
  cursorRow: number;
  cursorColumn: number;
} {
  let totalRows = 0;
  let cursorRow = 0;

  for (const [index, line] of lines.entries()) {
    const rows = visualRows(line);
    if (index < cursorLineIndex) {
      cursorRow += rows;
    }
    totalRows += rows;
  }

  const width = terminalColumns();
  const normalizedCursorColumn = Math.max(0, cursorColumn);
  cursorRow += Math.floor(normalizedCursorColumn / width);

  return {
    totalRows,
    cursorRow,
    cursorColumn: normalizedCursorColumn % width,
  };
}

function indexedPromptPrefix(line: number): string {
  return line === 0 ? renderPrompt() : renderContinuationPrompt();
}

function visualRows(value: string): number {
  const width = terminalColumns();
  const length = Math.max(visibleLength(value), 1);
  return Math.ceil(length / width);
}

function wrapAnsiLine(value: string, width: number): string[] {
  if (value.length === 0) {
    return [""];
  }

  const rows: string[] = [];
  let row = "";
  let visible = 0;
  let index = 0;

  while (index < value.length) {
    const ansiMatch = /^\x1b\[[0-9;]*m/u.exec(value.slice(index));
    if (ansiMatch) {
      row += ansiMatch[0];
      index += ansiMatch[0].length;
      continue;
    }

    const char = Array.from(value.slice(index))[0] ?? "";
    if (!char) {
      break;
    }

    const charWidth = charDisplayWidth(char);

    if (visible > 0 && visible + charWidth > width) {
      rows.push(row);
      row = "";
      visible = 0;
    }

    row += char;
    visible += charWidth;
    index += char.length;
  }

  rows.push(row);
  return rows;
}

function visibleLength(value: string): number {
  return Array.from(stripAnsi(value)).reduce((sum, char) => sum + charDisplayWidth(char), 0);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function sameRows(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function charDisplayWidth(char: string): number {
  if (char.length === 0) {
    return 0;
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(char)) {
    return 0;
  }
  if (/\p{Mark}/u.test(char)) {
    return 0;
  }
  if (
    /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(char)
  ) {
    return 2;
  }
  if (/\p{Extended_Pictographic}/u.test(char)) {
    return 2;
  }
  return 1;
}

function terminalColumns(): number {
  return Math.max(process.stdout.columns ?? 80, 20);
}

function isInsertNewlineSequence(sequence: string): boolean {
  if (sequence === "\n" || sequence === "\x1b\r" || sequence === "\x1b\n") {
    return true;
  }

  if (
    [
      "\x1b[13;5u",
      "\x1b[10;5u",
      "\x1b[27;5;13~",
      "\x1b[27;5;10~",
    ].includes(sequence)
  ) {
    return true;
  }

  return [
    /^\x1b\[(?:10|13);[2-8]u$/u,
    /^\x1b\[27;[2-8];(?:10|13)~$/u,
  ].some((pattern) => pattern.test(sequence));
}

function isClearDraftSequence(sequence: string): boolean {
  if (sequence === "\u0015" || sequence === "\x1b\u007f" || sequence === "\x1b\b") {
    return true;
  }

  return [
    /^\x1b\[(?:8|127);(?:5|9)u$/u,
    /^\x1b\[27;(?:5|9);(?:8|127)~$/u,
  ].some((pattern) => pattern.test(sequence));
}

function isDeletePreviousWordSequence(sequence: string): boolean {
  if (sequence === "\u0017") {
    return true;
  }

  return [
    /^\x1b\[(?:8|127);(?:3|7)u$/u,
    /^\x1b\[27;(?:3|7);(?:8|127)~$/u,
  ].some((pattern) => pattern.test(sequence));
}

function isDeleteNextWordSequence(sequence: string): boolean {
  if (sequence === "\x1bd") {
    return true;
  }

  return [
    /^\x1b\[3;(?:3|5|7|9)~$/u,
  ].some((pattern) => pattern.test(sequence));
}

function isMoveWordLeftSequence(sequence: string): boolean {
  return ["\x1bb", "\x1b\x1b[D", "\x1b[5D"].includes(sequence) || /^\x1b\[1;(?:3|5|7)D$/u.test(sequence);
}

function isMoveWordRightSequence(sequence: string): boolean {
  return ["\x1bf", "\x1b\x1b[C", "\x1b[5C"].includes(sequence) || /^\x1b\[1;(?:3|5|7)C$/u.test(sequence);
}

function isMoveDraftStartSequence(sequence: string): boolean {
  return ["\x1b[1;9A", "\x1b[1;5H", "\x1b[7;5~"].includes(sequence);
}

function isMoveDraftEndSequence(sequence: string): boolean {
  return ["\x1b[1;9B", "\x1b[1;5F", "\x1b[8;5~"].includes(sequence);
}

function isMoveLineStartSequence(sequence: string): boolean {
  return ["\u0001", "\x1b[H", "\x1bOH", "\x1b[1~", "\x1b[7~", "\x1b[1;9D", "\x1b[1;9H"].includes(sequence);
}

function isMoveLineEndSequence(sequence: string): boolean {
  return ["\u0005", "\x1b[F", "\x1bOF", "\x1b[4~", "\x1b[8~", "\x1b[1;9C", "\x1b[1;9F"].includes(sequence);
}

function isPopQueuedSequence(sequence: string): boolean {
  return [
    "\x1b[1;3A",
    "\x1b[1;9A",
    "\x1b[1;2A",
    "\x1b[1;4A",
    "\x1b[1;5A",
    "\x1b[1;6A",
    "\x1b[1;7A",
    "\x1b[1;8A",
  ].includes(sequence);
}

function cursorPosition(value: string, cursor: number): {
  line: number;
  column: number;
} {
  const beforeCursor = value.slice(0, cursor);
  const lines = beforeCursor.split("\n");
  return {
    line: lines.length - 1,
    column: lines.at(-1)?.length ?? 0,
  };
}

function indexFromPosition(lines: string[], line: number, column: number): number {
  let index = 0;
  for (let currentLine = 0; currentLine < line; currentLine += 1) {
    index += (lines[currentLine]?.length ?? 0) + 1;
  }
  return index + Math.min(column, lines[line]?.length ?? 0);
}

function previousWordStart(value: string, cursor: number): number {
  let index = cursor;

  while (index > 0 && /\s/u.test(value[index - 1] ?? "")) {
    index -= 1;
  }

  while (index > 0 && !/\s/u.test(value[index - 1] ?? "")) {
    index -= 1;
  }

  return index;
}

function nextWordEnd(value: string, cursor: number): number {
  let index = cursor;

  while (index < value.length && /\s/u.test(value[index] ?? "")) {
    index += 1;
  }

  while (index < value.length && !/\s/u.test(value[index] ?? "")) {
    index += 1;
  }

  return index;
}

function lineStartIndex(value: string, cursor: number): number {
  return value.lastIndexOf("\n", cursor - 1) + 1;
}

function lineEndIndex(value: string, cursor: number): number {
  const nextNewline = value.indexOf("\n", cursor);
  return nextNewline === -1 ? value.length : nextNewline;
}
