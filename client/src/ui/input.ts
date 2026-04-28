import readline from "node:readline";
import type { Interface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import { completeSlashCommand } from "../app/commands.ts";
import { setActiveDraft } from "./terminal.ts";
import {
  renderContinuationPrompt,
  renderInput,
  renderPrompt,
  renderQueuedMessage,
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
  setStatus: (status: string | null) => void;
  setFooter: (footer: string | null) => void;
} {
  if (!input.isTTY) {
    return {
      read: () => readPrompt(fallbackRl),
      close: () => fallbackRl?.close(),
      popQueuedDisplay: () => {},
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

    clear();

    output.write("\n");

    if (statusLine) {
      output.write(`${statusLine}\n`);
    }

    for (const queued of queuedDisplay) {
      output.write(`${renderQueuedMessage(queued)}\n`);
    }

    for (const [index, line] of lines.entries()) {
      if (index > 0) {
        output.write("\n");
      }
      output.write(`${index === 0 ? renderPrompt() : renderContinuationPrompt()}${renderInput(line)}`);
    }

    if (footerLine) {
      output.write(`\n${footerLine}`);
    }

    const rowsDown = lines.length - 1 - target.line;
    if (footerLine) {
      output.write("\x1b[1A");
    }
    if (rowsDown > 0) {
      output.write(`\x1b[${rowsDown}A`);
    }
    output.write("\r");
    const column = 3 + target.column;
    if (column > 0) {
      output.write(`\x1b[${column}C`);
    }
    cursorLine = 1 + (statusLine ? 1 : 0) + queuedDisplay.length + target.line;
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
    redraw();
  }

  function deleteRange(start: number, end: number): void {
    if (start === end) {
      return;
    }
    value = `${value.slice(0, start)}${value.slice(end)}`;
    cursor = start;
    historyIndex = inputHistory.length;
    redraw();
  }

  function clearDraft(): void {
    if (value.length === 0) {
      return;
    }
    value = "";
    cursor = 0;
    historyIndex = inputHistory.length;
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
    redraw();
  }

  function moveVertical(direction: -1 | 1): void {
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

    if (isInsertNewlineSequence(sequence)) {
      insertText("\n");
      return;
    }

    if (sequence === "\r") {
      cursor = value.length;
      finish(value);
      return;
    }

    if (sequence === "\t") {
      if (!value.includes("\n") && value.startsWith("/")) {
        const [matches] = completeSlashCommand(value);
        if (matches.length === 1) {
          value = matches[0];
          cursor = value.length;
          redraw();
        } else if (matches.length > 1) {
          clear();
          output.write(`${matches.join("  ")}\n`);
          redraw();
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
      clear();
      input.off("data", onData);
      input.setRawMode(false);
      setActiveDraft(null);
    },
    popQueuedDisplay() {
      queuedDisplay.shift();
      redraw();
    },
    setStatus(status: string | null) {
      statusLine = status;
      redraw();
    },
    setFooter(footer: string | null) {
      footerLine = footer;
      redraw();
    },
  };
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
