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

    if (sequence === "\u007f" || sequence === "\b") {
      if (cursor === 0) {
        return;
      }
      value = `${value.slice(0, cursor - 1)}${value.slice(cursor)}`;
      cursor -= 1;
      redraw();
      return;
    }

    if (sequence === "\x1b[D") {
      if (cursor > 0) {
        cursor -= 1;
        redraw();
      }
      return;
    }

    if (sequence === "\x1b[C") {
      if (cursor < value.length) {
        cursor += 1;
        redraw();
      }
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
        value = `${value.slice(0, cursor)}${value.slice(cursor + 1)}`;
        redraw();
      }
      return;
    }

    if (sequence === "\x1b[H" || sequence === "\x1b[1~") {
      cursor = lineStartIndex(value, cursor);
      redraw();
      return;
    }

    if (sequence === "\x1b[F" || sequence === "\x1b[4~") {
      cursor = lineEndIndex(value, cursor);
      redraw();
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

function lineStartIndex(value: string, cursor: number): number {
  return value.lastIndexOf("\n", cursor - 1) + 1;
}

function lineEndIndex(value: string, cursor: number): number {
  const nextNewline = value.indexOf("\n", cursor);
  return nextNewline === -1 ? value.length : nextNewline;
}
