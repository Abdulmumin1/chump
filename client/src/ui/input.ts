import readline from "node:readline";
import type { Interface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import { completeSlashCommand } from "../app/commands.ts";
import type {
  SessionSummary,
  SlashCommandMenuContext,
  SlashCommandSuggestion,
  SlashCommandSuggestionView,
} from "../core/types.ts";
import { setActiveDraft } from "./terminal.ts";
import {
  renderContinuationPrompt,
  renderInput,
  renderPrompt,
  renderQueueHint,
  renderQueuedMessage,
  renderSlashCommandMenu,
} from "./render.ts";

const inputHistory: string[] = [];

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
  return readInteractivePrompt();
}

export function createPromptReader(fallbackRl: Interface | null): {
  read: () => Promise<string | null>;
  close: () => void;
  popQueuedDisplay: () => void;
  setQueuedLinePopHandler: (handler: (() => string | null) | null) => void;
  setAbortHandler: (handler: (() => void) | null) => void;
  setSessionSuggestions: (sessions: SessionSummary[]) => void;
  setStatus: (status: string | null) => void;
  setFooter: (footer: string | null) => void;
} {
  if (!input.isTTY) {
    return {
      read: () => readPrompt(fallbackRl),
      close: () => fallbackRl?.close(),
      popQueuedDisplay: () => {},
      setQueuedLinePopHandler: () => {},
      setAbortHandler: () => {},
      setSessionSuggestions: () => {},
      setStatus: () => {},
      setFooter: () => {},
    };
  }

  return createInteractivePromptReader();
}

function readInteractivePrompt(): Promise<string | null> {
  const reader = createInteractivePromptReader();
  return reader.read().finally(() => reader.close());
}

function createInteractivePromptReader(): {
  read: () => Promise<string | null>;
  close: () => void;
  popQueuedDisplay: () => void;
  setQueuedLinePopHandler: (handler: (() => string | null) | null) => void;
  setAbortHandler: (handler: (() => void) | null) => void;
  setSessionSuggestions: (sessions: SessionSummary[]) => void;
  setStatus: (status: string | null) => void;
  setFooter: (footer: string | null) => void;
} {
  readline.emitKeypressEvents(input);
  input.setRawMode(true);

  let value = "";
  let cursor = 0;
  let cursorLine = 0;
  let historyIndex = inputHistory.length;
  let pendingResolve: ((value: string | null) => void) | null = null;
  let queuedDisplay: string[] = [];
  let statusLine: string | null = null;
  let footerLine: string | null = null;
  let closed = false;
  let slashSelection = 0;
  let slashMenuContext: SlashCommandMenuContext = { sessions: [] };
  let abortHandler: (() => void) | null = null;
  let popQueuedLine: (() => string | null) | null = null;
  let lastEscapeAt = 0;

  function clear(): void {
    output.write("\r");
    if (cursorLine > 0) {
      output.write(`\x1b[${cursorLine}A`);
    }
    output.write("\x1b[J");
    cursorLine = 0;
  }

  function redraw(): void {
    if (closed || !pendingResolve) {
      return;
    }

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
    const queueLines = queuedDisplay.length > 0
      ? [
          ...queuedDisplay.map((queued) => renderQueuedMessage(queued)),
          renderQueueHint(),
        ]
      : [];
    const promptLines = lines.map((line, index) =>
      `${index === 0 ? renderPrompt() : renderContinuationPrompt()}${renderInput(line)}`
    );
    const frameLines = [
      ...statusLines,
      ...queueLines,
      ...menuLines,
      ...promptLines,
      ...footerLines,
    ];
    const cursorFrameLineIndex =
      statusLines.length +
      queueLines.length +
      menuLines.length +
      target.line;

    clear();

    output.write("\n");

    for (const [index, line] of frameLines.entries()) {
      if (index > 0) {
        output.write("\n");
      }
      output.write(line);
    }

    const layout = measureFrameLayout(
      frameLines,
      cursorFrameLineIndex,
      visibleLength(indexedPromptPrefix(target.line)) + target.column,
    );
    const rowsUp = layout.totalRows - 1 - layout.cursorRow;
    if (rowsUp > 0) {
      output.write(`\x1b[${rowsUp}A`);
    }
    output.write("\r");
    if (layout.cursorColumn > 0) {
      output.write(`\x1b[${layout.cursorColumn}C`);
    }
    cursorLine = layout.cursorRow;
  }

  function finish(result: string | null): void {
    if (!pendingResolve) {
      return;
    }

    const resolve = pendingResolve;
    pendingResolve = null;
    clear();

    if (result?.trim()) {
      inputHistory.push(result);
    }

    if (result !== null) {
      queuedDisplay.push(result);
      value = "";
      cursor = 0;
      historyIndex = inputHistory.length;
      pendingResolve = null;
      redraw();
    } else {
      pendingResolve = null;
    }

    resolve(result);
  }

  function insertText(text: string): void {
    value = `${value.slice(0, cursor)}${text}${value.slice(cursor)}`;
    cursor += text.length;
    historyIndex = inputHistory.length;
    slashSelection = 0;
    syncSlashSelection();
    redraw();
  }

  function deleteRange(start: number, end: number): void {
    if (start === end) {
      return;
    }
    value = `${value.slice(0, start)}${value.slice(end)}`;
    cursor = start;
    historyIndex = inputHistory.length;
    slashSelection = 0;
    syncSlashSelection();
    redraw();
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
    redraw();
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
    redraw();
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
    redraw();
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
    redraw();
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
    redraw();
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
    redraw();
  }

  function onData(chunk: Buffer): void {
    if (!pendingResolve) {
      return;
    }

    const sequence = chunk.toString("utf8");

    if (sequence === "\u0003") {
      finish(null);
      return;
    }

    if (sequence === "\u0004" && value.length === 0) {
      finish(null);
      return;
    }

    if (sequence === "\x1b") {
      const now = Date.now();
      if (abortHandler && now - lastEscapeAt <= 600) {
        lastEscapeAt = 0;
        abortHandler();
        return;
      }
      lastEscapeAt = now;
      return;
    }

    lastEscapeAt = 0;

    if (isPopQueuedSequence(sequence)) {
      if (value.length === 0 && queuedDisplay.length > 0) {
        const queuedLine = popQueuedLine?.() ?? null;
        if (queuedLine !== null) {
          queuedDisplay.pop();
          value = queuedLine;
          cursor = value.length;
          historyIndex = inputHistory.length;
          slashSelection = 0;
          syncSlashSelection();
          redraw();
        }
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
      finish(value);
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

    insertText(sequence);
  }

  input.on("data", onData);

  return {
    read() {
      if (closed) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        value = "";
        cursor = 0;
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
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      setActiveDraft(null);
      resolve?.(null);
    },
    popQueuedDisplay() {
      queuedDisplay.shift();
      redraw();
    },
    setQueuedLinePopHandler(handler: (() => string | null) | null) {
      popQueuedLine = handler;
    },
    setAbortHandler(handler: (() => void) | null) {
      abortHandler = handler;
      lastEscapeAt = 0;
    },
    setSessionSuggestions(sessions: SessionSummary[]) {
      slashMenuContext = { sessions };
      syncSlashSelection();
      redraw();
    },
    setStatus(status: string | null) {
      if (statusLine === status) {
        return;
      }
      statusLine = status;
      redraw();
    },
    setFooter(footer: string | null) {
      if (footerLine === footer) {
        return;
      }
      footerLine = footer;
      redraw();
    },
  };
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
  let totalRows = 1;
  let cursorRow = 1;

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

function visibleLength(value: string): number {
  return Array.from(stripAnsi(value)).length;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
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
  if (sequence === "\u0015") {
    return true;
  }

  return [
    /^\x1b\[(?:8|127);9u$/u,
    /^\x1b\[27;9;(?:8|127)~$/u,
  ].some((pattern) => pattern.test(sequence));
}

function isDeletePreviousWordSequence(sequence: string): boolean {
  if (["\u0017", "\x1b\u007f", "\x1b\b"].includes(sequence)) {
    return true;
  }

  return [
    /^\x1b\[(?:8|127);(?:3|5|7)u$/u,
    /^\x1b\[27;(?:3|5|7);(?:8|127)~$/u,
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
