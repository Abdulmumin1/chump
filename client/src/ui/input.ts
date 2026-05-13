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
import { hasPendingBatch, setActiveDraft } from "./terminal.ts";
import { StdinBuffer } from "./stdin-buffer.ts";
import {
  renderContinuationPrompt,
  renderEscHint,
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

// Synchronized output mode (CSI ? 2026 h / l). Tells cooperating terminals
// (VS Code/xterm.js, Kitty, WezTerm, iTerm2, modern gnome-terminal, etc.)
// to buffer display updates between the BEGIN and END markers and render
// them atomically. On non-supporting terminals it's a harmless no-op.
// Wrapping every multi-byte write in these markers is the cheapest way to
// eliminate the visible "cursor walks across the frame" flicker and to
// reduce redundant re-rasterization on slow renderers — without changing
// what we actually write.
const SYNC_BEGIN = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";

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
  setQueuedDisplay: (submissions: PromptSubmission[]) => void;
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
      setQueuedDisplay: () => {},
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
  setQueuedDisplay: (submissions: PromptSubmission[]) => void;
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
  let escHintActive = false;
  let escHintTimer: NodeJS.Timeout | null = null;
  let nextImageNumber = 1;
  let lastColumns = terminalColumns();
  let redrawScheduled = false;
  let lastDrawnRowCount = 0;
  let lastRenderedRows: string[] = [];
  let lastCursorRowIndex = 0;
  let lastCursorColumn = 0;
  let lastFrameSignature = "";
  let forceRedraw = false;
  let resizeDebounceTimer: NodeJS.Timeout | null = null;
  let softRedrawTimer: NodeJS.Timeout | null = null;
  // Offset — in physical terminal rows — from the cursor row UP to the status
  // row, as of the last full repaint. Enables in-place spinner updates that
  // don't repaint the entire input frame. `null` means we have no valid
  // cached frame to patch against.
  let statusRowPhysicalOffset: number | null = null;
  let lastRenderedStatusRow = "";
  // Index of the status row within `lastRenderedRows`. Keeps the differential
  // renderer's view of the screen in sync after an in-place status patch.
  let statusIndexInRendered: number | null = null;

  output.write("\x1b[?2004h");

  // Number of physical screen rows a previously-written row currently occupies,
  // given the terminal's CURRENT columns. Terminals soft-wrap at exactly
  // `columns`, not at our internal `wrapWidth`, so this must use terminal
  // columns to correctly account for reflow.
  function physicalRowsFor(rows: string[], columns: number): number[] {
    return rows.map((row) =>
      Math.max(1, Math.ceil(Math.max(visibleLength(row), 0) / Math.max(1, columns))),
    );
  }

  // How many physical rows above the terminal cursor currently belong to the
  // previously drawn frame. Walks the stored `lastRenderedRows` and reflows
  // them at the live terminal width.
  function physicalCursorOffsetFromFrameTop(columns: number): number {
    if (lastRenderedRows.length === 0) {
      return cursorLine;
    }
    const heights = physicalRowsFor(lastRenderedRows, columns);
    let above = 0;
    for (let index = 0; index < lastCursorRowIndex && index < heights.length; index += 1) {
      above += heights[index] ?? 1;
    }
    // The cursor sat at column `lastCursorColumn` within the wrapped row at
    // its previous render width. After reflow at the new width that column
    // may now sit on a later physical row of the same logical row.
    above += Math.floor(Math.max(0, lastCursorColumn) / Math.max(1, columns));
    return above;
  }

  function buildClear(): string {
    lastFrameSignature = "";
    if (lastDrawnRowCount === 0 && lastRenderedRows.length === 0) {
      cursorLine = 0;
      statusRowPhysicalOffset = null;
      lastRenderedStatusRow = "";
      statusIndexInRendered = null;
      return "\r\x1b[2K";
    }
    const moveUpRows = physicalCursorOffsetFromFrameTop(terminalColumns());
    const moveUp = moveUpRows > 0 ? `\x1b[${moveUpRows}A` : "";
    cursorLine = 0;
    lastDrawnRowCount = 0;
    lastRenderedRows = [];
    lastCursorRowIndex = 0;
    lastCursorColumn = 0;
    statusRowPhysicalOffset = null;
    lastRenderedStatusRow = "";
    statusIndexInRendered = null;
    return `\r${moveUp}\x1b[J`;
  }

  function clear(): void {
    const payload = buildClear();
    if (payload) output.write(`${SYNC_BEGIN}${payload}${SYNC_END}`);
  }

  function buildRedraw(): string {
    if (closed || !pendingResolve) {
      return "";
    }

    redrawScheduled = false;
    // We're about to paint the authoritative frame, so any queued soft redraw
    // is now stale. Avoids a redundant paint shortly after this one.
    cancelSoftRedraw();

    const lines = value.split("\n");
    const target = cursorPosition(value, cursor);
    const slashMenu = getVisibleSlashMenu();
    const inputIndent = " ";
    const columns = terminalColumns();
    const wrapWidth = terminalWrapWidth(columns);
    const statusBase = statusLine
      ? truncateAnsiLine(statusLine.replaceAll(/\s*\n\s*/g, " "), wrapWidth)
      : "";
    const statusRow = escHintActive
      ? (statusBase ? `${statusBase}  ${renderEscHint()}` : renderEscHint())
      : statusBase;
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
    const footerRows = footerLine
      ? [truncateAnsiLine(footerLine.replaceAll(/\s*\n\s*/g, " "), wrapWidth)]
      : [];
    const frameWidth = Math.max(12, columns - 1);
    const rule = renderInputRule(frameWidth);
    const promptLines = [
      rule,
      ...lines.map((line) => `${inputIndent}${renderInput(line)}`),
      rule,
    ];
    const promptFrameLines = [
      ...queueLines,
      ...(menuTopSpacerLines > 0 ? [""] : []),
      ...menuLines,
      "",
      statusRow,
      ...promptLines,
    ];
    const cursorFrameLineIndex =
      queueLines.length +
      menuTopSpacerLines +
      menuLines.length +
      1 +
      2 +
      target.line;

    const layout = measureFrameLayout(
      promptFrameLines,
      cursorFrameLineIndex,
      visibleLength(inputIndent) + target.column,
    );
    const promptRows = promptFrameLines.flatMap((line) => wrapAnsiLine(line, wrapWidth));
    const renderedRows = [...promptRows, ...footerRows].map((row) => truncateAnsiLine(row, wrapWidth));
    const totalRows = Math.max(renderedRows.length, 1);

    // Decide whether to emit a differential frame (only write rows that
    // changed) or a full frame repaint. Differential is safe when the frame
    // shape is unchanged — same row count, same terminal width — and we have
    // a cached previous paint to diff against. This is the single biggest
    // optimization for slow terminals: a keystroke typically changes ONE row
    // out of ~10, so diff output is ~100 bytes vs ~900 for a full repaint.
    //
    // Ink (Claude Code), Bubble Tea (OpenCode), and similar CLI frameworks
    // all use this technique; without it, rapid state updates saturate
    // slow emulators like VS Code's integrated terminal and cause dropped
    // keystrokes because the emulator can't keep up with the output flood.
    //
    // Note: `forceRedraw` does NOT disqualify the diff path — it only means
    // "don't skip the write via the lastFrameSignature shortcut". The diff
    // itself already produces minimal output and is always correct when the
    // frame shape matches.
    const canDiff =
      lastRenderedRows.length > 0 &&
      lastRenderedRows.length === renderedRows.length &&
      lastColumns === columns;

    // Pre-compute the status row's index in the flat renderedRows array so
    // both the full-paint and patch paths can reference it.
    const statusPromptFrameIndex =
      queueLines.length + menuTopSpacerLines + menuLines.length + 1;
    let statusIndexInRenderedLocal = 0;
    for (let i = 0; i < statusPromptFrameIndex; i += 1) {
      statusIndexInRenderedLocal += wrapAnsiLine(promptFrameLines[i] ?? "", wrapWidth).length;
    }

    let frame: string;
    if (canDiff) {
      frame = buildDifferentialFrame(
        renderedRows,
        lastRenderedRows,
        lastCursorRowIndex,
        layout.cursorRow,
        layout.cursorColumn,
      );
    } else {
      const rowsUp = Math.max(0, totalRows - 1 - layout.cursorRow);
      const moveUpRows = physicalCursorOffsetFromFrameTop(columns);
      const moveUp = moveUpRows > 0 ? `\x1b[${moveUpRows}A` : "";
      const moveToCursorRow = rowsUp > 0 ? `\x1b[${rowsUp}A` : "";
      const moveToCursorColumn =
        layout.cursorColumn > 0 ? `\x1b[${layout.cursorColumn}C` : "";
      const rows: string[] = [];
      for (let index = 0; index < totalRows; index += 1) {
        const nextRow = renderedRows[index] ?? "";
        rows.push(`${index === 0 ? "" : "\n"}\r\x1b[2K${nextRow}`);
      }
      // Hide/show cursor around the full repaint so it doesn't visibly walk
      // across the frame while we write. The diff path skips this since it
      // writes too few bytes to flicker.
      frame = `\r${moveUp}\x1b[J\x1b[?25l${rows.join("")}\x1b[?25h${moveToCursorRow}\r${moveToCursorColumn}`;
    }

    cursorLine = layout.cursorRow;
    lastDrawnRowCount = totalRows;
    lastRenderedRows = renderedRows;
    lastCursorRowIndex = layout.cursorRow;
    lastCursorColumn = layout.cursorColumn;
    lastColumns = columns;

    // Cache the status row location for in-place spinner patches. Every entry
    // in `renderedRows` is truncated to `wrapWidth`, so each occupies exactly
    // one physical row at the current terminal width. Multi-row status (ESC
    // hint overflow) can't be patched safely; invalidate in that case.
    const statusWrapped = wrapAnsiLine(statusRow, wrapWidth);
    if (statusWrapped.length === 1) {
      statusRowPhysicalOffset = layout.cursorRow - statusIndexInRenderedLocal;
      lastRenderedStatusRow = truncateAnsiLine(statusWrapped[0] ?? "", wrapWidth);
      statusIndexInRendered = statusIndexInRenderedLocal;
    } else {
      statusRowPhysicalOffset = null;
      lastRenderedStatusRow = "";
      statusIndexInRendered = null;
    }

    if (frame === lastFrameSignature && !forceRedraw) {
      return "";
    }
    lastFrameSignature = frame;
    forceRedraw = false;
    return frame;
  }

  // Produce a frame that only overwrites the rows that differ from the
  // previous paint. Assumes the cursor is currently at (oldCursorRow, col=?)
  // within the cached frame; we CR at the start so the column is normalized.
  //
  // Output structure:
  //   \r               — normalize column
  //   ESC[NA           — move up to frame row 0
  //   for each row i:
  //     \n             — advance to next row (i > 0 only)
  //     \r ESC[2K row  — rewrite (only if changed)
  //   ESC[MA \r ESC[KC — position to new cursor
  //
  // For a ~10-row frame where only 1 row changed this emits ~100 bytes vs
  // ~900 bytes for a full repaint. No cursor hide/show toggle either — the
  // transient cursor motion is imperceptible in microseconds and the toggle
  // itself causes flicker on slow terminals.
  function buildDifferentialFrame(
    newRows: string[],
    oldRows: string[],
    oldCursorRow: number,
    newCursorRow: number,
    newCursorColumn: number,
  ): string {
    const parts: string[] = [];
    parts.push("\r");
    if (oldCursorRow > 0) {
      parts.push(`\x1b[${oldCursorRow}A`);
    }

    const maxRows = Math.max(newRows.length, oldRows.length);
    for (let i = 0; i < maxRows; i += 1) {
      if (i > 0) {
        parts.push("\n");
      }
      const newContent = newRows[i] ?? "";
      const oldContent = oldRows[i] ?? "";
      if (newContent !== oldContent) {
        // \x1b[0m guards against any color bleed from the previous row in
        // case a rendered row didn't close its SGR state cleanly.
        parts.push(`\r\x1b[2K\x1b[0m${newContent}`);
      }
    }

    // Cursor is now on row (maxRows - 1). Move up to newCursorRow, then to
    // column. Note we always CR + move right rather than relying on where
    // the last write left us, because unchanged rows didn't advance the
    // cursor within the row (we only did \n), but changed rows left it at
    // end-of-content. CR normalizes either way.
    const finalRowIndex = Math.max(0, maxRows - 1);
    const rowsUp = finalRowIndex - newCursorRow;
    if (rowsUp > 0) {
      parts.push(`\x1b[${rowsUp}A`);
    } else if (rowsUp < 0) {
      parts.push(`\x1b[${-rowsUp}B`);
    }
    parts.push("\r");
    if (newCursorColumn > 0) {
      parts.push(`\x1b[${newCursorColumn}C`);
    }

    return parts.join("");
  }

  function redraw(): void {
    // When a batched output flush is pending, skip the direct write — the
    // flush cycle calls buildRedraw() and includes our latest state.  This
    // avoids redundant stdout writes that overwhelm slow terminal emulators.
    if (hasPendingBatch()) {
      redrawScheduled = false;
      return;
    }
    const frame = buildRedraw();
    if (frame) {
      output.write(`${SYNC_BEGIN}${frame}${SYNC_END}`);
    }
  }

  function redrawOnResize(): void {
    const columns = terminalColumns();
    if (columns === lastColumns) {
      return;
    }
    // Debounce: terminals fire many resize events while the user drags. We
    // only need to repaint once the dust settles. This also avoids a feedback
    // loop where each rapid event triggers a redraw that itself shifts cursor
    // position and accumulates ghost rows in scrollback.
    if (!resizeDebounceTimer) {
      // Hide cursor while the layout is in flux so it doesn't flicker at a
      // stale position during the drag.
      output.write("\x1b[?25l");
    } else {
      clearTimeout(resizeDebounceTimer);
    }
    resizeDebounceTimer = setTimeout(() => {
      resizeDebounceTimer = null;
      if (closed || !pendingResolve) {
        output.write("\x1b[?25h");
        return;
      }
      // Force-rerender: requestRedraw skips when nothing changed, but the
      // physical layout may have changed even if our state has not.
      forceRedraw = true;
      redraw();
    }, 80);
  }

  function requestRedraw(): void {
    if (closed || !pendingResolve || redrawScheduled) {
      return;
    }
    // An urgent redraw supersedes any pending soft redraw: the soft redraw's
    // state is a subset of the frame we're about to paint anyway.
    cancelSoftRedraw();
    redrawScheduled = true;
    setImmediate(() => {
      redraw();
    });
  }

  // Non-urgent redraws (spinner frame changes, status/footer updates). On slow
  // terminal emulators like embedded editor terminals, the synchronous TTY
  // writes issued by requestRedraw() can saturate the terminal and starve
  // keyboard input handling. Coalescing these into a single repaint every
  // ~250ms keeps the animation visibly smooth while leaving enough slack in
  // the event loop to drain stdin between writes.
  //
  // If the user types (or any urgent change happens), requestRedraw() fires
  // synchronously via setImmediate and cancels any pending soft timer so the
  // keystroke is reflected without delay.
  const SOFT_REDRAW_INTERVAL_MS = 250;
  function softRequestRedraw(): void {
    if (closed || !pendingResolve) {
      return;
    }
    if (redrawScheduled || softRedrawTimer) {
      return;
    }
    softRedrawTimer = setTimeout(() => {
      softRedrawTimer = null;
      redraw();
    }, SOFT_REDRAW_INTERVAL_MS);
  }

  function cancelSoftRedraw(): void {
    if (softRedrawTimer) {
      clearTimeout(softRedrawTimer);
      softRedrawTimer = null;
    }
  }

  // Timestamp of the last keypress we processed. While the user is actively
  // typing, any non-essential output (spinner frames, status/footer updates)
  // is suppressed so the terminal can stay focused on echoing their input.
  // On slow terminals (VS Code, JetBrains, etc.) this is the single biggest
  // win: it removes output contention from the hot path of keystroke echo.
  //
  // Urgent paths — user input redraw, explicit status clears (turn ending),
  // queue/menu changes — are NOT gated by this; they always paint.
  let lastKeystrokeAt = 0;
  const KEYSTROKE_QUIET_MS = 600;
  function userIsTyping(): boolean {
    return Date.now() - lastKeystrokeAt < KEYSTROKE_QUIET_MS;
  }

  // Build an in-place patch that rewrites only the status row, leaving the
  // rest of the input frame untouched. Returns null when we can't safely
  // patch — in which case the caller should fall back to a full redraw.
  //
  // Patch shape (~30-60 bytes):
  //   DECSC (save cursor) → cursor up N → CR → clear line
  //   → new status content → DECRC (restore cursor)
  //
  // Why this matters: the spinner ticks every 190ms. Without this, each tick
  // repaints the ENTIRE frame (500-2000B of escape sequences). On a slow
  // terminal like VS Code's, that flood saturates the emulator and keystrokes
  // fall behind. Patching just the status row cuts write volume by ~10-40x
  // and avoids the expensive `\x1b[J` clear-to-end that can confuse slow
  // terminals when issued rapidly.
  function buildStatusPatch(): string | null {
    if (closed || !pendingResolve) {
      return null;
    }
    if (statusRowPhysicalOffset === null) {
      // No valid cached frame yet, or last paint had multi-row status.
      // Caller must do a full redraw.
      return null;
    }
    if (statusRowPhysicalOffset <= 0) {
      // Unexpected: status row should always be above the cursor. Bail out.
      return null;
    }
    // A full redraw is already scheduled — let it paint the latest state
    // rather than racing it with a partial patch.
    if (redrawScheduled) {
      return null;
    }
    // Batch flush already repaints the full frame; don't interleave a patch.
    if (hasPendingBatch()) {
      return null;
    }

    const columns = terminalColumns();
    if (columns !== lastColumns) {
      // Terminal resized since last paint — cached offset may be stale.
      return null;
    }
    const wrapWidth = terminalWrapWidth(columns);
    const statusBase = statusLine
      ? truncateAnsiLine(statusLine.replaceAll(/\s*\n\s*/g, " "), wrapWidth)
      : "";
    const statusRow = escHintActive
      ? (statusBase ? `${statusBase}  ${renderEscHint()}` : renderEscHint())
      : statusBase;
    // If the new status would wrap, the patch's single-row overwrite would
    // leave stale geometry. Fall back to a full redraw.
    if (visibleLength(statusRow) > wrapWidth) {
      return null;
    }
    const statusRowTruncated = truncateAnsiLine(statusRow, wrapWidth);
    if (statusRowTruncated === lastRenderedStatusRow) {
      return null;
    }

    const rowsUp = statusRowPhysicalOffset;
    const moveUp = `\x1b[${rowsUp}A`;

    // Keep cache consistent so the next full redraw doesn't no-op against a
    // stale signature, and the differential renderer's screen model stays
    // accurate (otherwise the next diff would spuriously rewrite this row).
    lastRenderedStatusRow = statusRowTruncated;
    if (statusIndexInRendered !== null && statusIndexInRendered < lastRenderedRows.length) {
      lastRenderedRows[statusIndexInRendered] = statusRowTruncated;
    }
    lastFrameSignature = "";
    // DECSC/DECRC (save/restore cursor) is universally supported and lets us
    // avoid computing cursor-down + column offsets manually. Skipping the
    // \x1b[?25l / \x1b[?25h toggle too — the patch executes in microseconds
    // and the embedded cursor motion is imperceptible. On slow terminals the
    // hide/show toggle was itself a source of flicker.
    return `\x1b7${moveUp}\r\x1b[2K${statusRowTruncated}\x1b8`;
  }

  function repaintStatusInPlace(): boolean {
    const patch = buildStatusPatch();
    if (!patch) {
      return false;
    }
    output.write(`${SYNC_BEGIN}${patch}${SYNC_END}`);
    return true;
  }

  function setEscHint(): void {
    if (escHintTimer) {
      clearTimeout(escHintTimer);
    }
    escHintActive = true;
    forceRedraw = true;
    requestRedraw();
    escHintTimer = setTimeout(() => {
      escHintTimer = null;
      escHintActive = false;
      forceRedraw = true;
      requestRedraw();
    }, 600);
  }

  function clearEscHint(): void {
    if (escHintTimer) {
      clearTimeout(escHintTimer);
      escHintTimer = null;
    }
    if (escHintActive) {
      escHintActive = false;
      forceRedraw = true;
      requestRedraw();
    }
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
      // The server is the source of truth for the steering queue: accepted
      // submissions come back via the steering_queue event and drive the
      // display through setQueuedDisplay. We intentionally do not push here
      // — doing so previously produced a brief "Steering: ..." flash on
      // every submit (for normal turns) and a double-render when a steered
      // message was both pushed locally and echoed by the server.
      value = "";
      cursor = 0;
      attachments = [];
      historyIndex = inputHistory.length;
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
    forceRedraw = true;
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
    forceRedraw = true;
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
    forceRedraw = true;
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
    forceRedraw = true;
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
    forceRedraw = true;
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
    forceRedraw = true;
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
    forceRedraw = true;
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

  // StdinBuffer owns the raw chunk → complete-sequence parsing. It holds
  // incomplete escape sequences across stdin 'data' events (with a 10ms
  // flush timeout) so that a split like ["\x1b", "[D"] doesn't get
  // mis-interpreted as bare-ESC + literal "[D". It also detects bracketed
  // paste and emits the content as a single 'paste' event.
  const stdinBuffer = new StdinBuffer({ timeout: 10 });
  stdinBuffer.on("data", (sequence: string) => {
    if (!pendingResolve) return;
    // Stamp the keystroke time up front so any concurrent spinner timer
    // that fires while we're mid-dispatch is already treated as "typing
    // active" and skips its paint. This is essential on slow terminals:
    // every byte we don't write during typing is a byte the emulator can
    // spend echoing the keystroke.
    lastKeystrokeAt = Date.now();
    dispatchKey(sequence);
  });
  stdinBuffer.on("paste", (content: string) => {
    if (!pendingResolve) return;
    lastKeystrokeAt = Date.now();
    void insertPaste(content);
  });

  function onData(chunk: Buffer): void {
    if (!pendingResolve) return;
    // Raw multi-line content arriving WITHOUT bracketed-paste markers (e.g.
    // when the terminal doesn't support them) should still be treated as a
    // paste rather than being parsed byte-by-byte — otherwise embedded "\r"
    // would submit mid-content. Detect before handing to the buffer.
    const sequence = chunk.toString("utf8");
    if (!sequence.includes(BRACKETED_PASTE_START) && isLikelyRawPaste(sequence)) {
      lastKeystrokeAt = Date.now();
      void insertPaste(sequence);
      return;
    }
    stdinBuffer.process(chunk);
  }

  function dispatchKey(sequence: string): void {
    if (!pendingResolve) {
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

    // A rapid multi-ESC burst is coalesced by StdinBuffer into "\x1b\x1b"
    // or longer (since the incomplete-sequence flush timer ships them as a
    // run). Dispatch each ESC individually so the double-escape abort
    // shortcut fires on the second press. Alt+ESC as a user shortcut is
    // extremely rare; treating these as bare ESCs is the correct trade-off.
    if (sequence.length > 1 && /^\x1b+$/.test(sequence)) {
      for (let i = 0; i < sequence.length; i += 1) {
        dispatchKey("\x1b");
      }
      return;
    }

    if (sequence === "\x1b") {
      const now = Date.now();
      if (abortHandler && now - lastEscapeAt <= 600) {
        lastEscapeAt = 0;
        clearEscHint();
        logClientEvent("abortShortcut", "double escape");
        abortHandler();
        return;
      }
      lastEscapeAt = now;
      if (abortHandler) {
        setEscHint();
      }
      return;
    }

    clearEscHint();
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

    // Unknown escape sequence (some CSI/SS3 we don't recognize) or lone
    // control byte. Swallow rather than inserting it as text so we don't
    // pollute the draft with garbage. StdinBuffer guarantees this is a
    // single complete sequence, not a coalesced burst that happened to
    // start with \x1b.
    if (sequence.startsWith("\x1b") || sequence < " ") {
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
        forceRedraw = true;
        setActiveDraft({ buildClear, buildRedraw });
        redraw();
      });
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (resizeDebounceTimer) {
        clearTimeout(resizeDebounceTimer);
        resizeDebounceTimer = null;
      }
      if (escHintTimer) {
        clearTimeout(escHintTimer);
        escHintTimer = null;
      }
      cancelSoftRedraw();
      stdinBuffer.destroy();
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
      forceRedraw = true;
      requestRedraw();
    },
    setQueuedDisplay(submissions: PromptSubmission[]) {
      queuedDisplay = [...submissions];
      forceRedraw = true;
      requestRedraw();
    },
    setQueuedLinePopHandler(handler: (() => void) | null) {
      popQueuedLine = handler;
    },
    setAbortHandler(handler: (() => void) | null) {
      abortHandler = handler;
      lastEscapeAt = 0;
      if (!handler) {
        clearEscHint();
      }
    },
    setSessionSuggestions(sessions: SessionSummary[]) {
      slashMenuContext = { ...slashMenuContext, sessions };
      syncSlashSelection();
      forceRedraw = true;
      requestRedraw();
    },
    setModelSuggestions(models: SlashCommandMenuContext["models"]) {
      slashMenuContext = { ...slashMenuContext, models };
      syncSlashSelection();
      forceRedraw = true;
      requestRedraw();
    },
    setSkillSuggestions(skills: SlashCommandMenuContext["skills"]) {
      slashMenuContext = { ...slashMenuContext, skills };
      syncSlashSelection();
      forceRedraw = true;
      requestRedraw();
    },
    setStatus(status: string | null) {
      if (statusLine === status) {
        return;
      }
      statusLine = status;
      forceRedraw = true;
      // While the user is actively typing, absolutely do not write anything
      // for a spinner tick — it contends with keystroke echo on slow
      // terminals. Clearing the status (null) is treated as urgent though:
      // the turn just ended and the user needs to see a clean prompt.
      if (status !== null && userIsTyping()) {
        return;
      }
      // Fast path: if the frame layout hasn't changed since our last paint,
      // rewrite just the status row in place. This is ~10-40x less terminal
      // output than a full frame repaint, which is critical on slow terminals
      // (e.g. VS Code) where repeated full repaints at spinner rate saturate
      // the emulator and cause dropped keystrokes.
      if (repaintStatusInPlace()) {
        return;
      }
      // Fallback: full repaint. Keep the soft/urgent split so that clearing
      // the status (null, turn ended) is reflected immediately while ongoing
      // spinner activity stays throttled.
      if (status === null) {
        requestRedraw();
      } else {
        softRequestRedraw();
      }
    },
    setFooter(footer: string | null) {
      if (footerLine === footer) {
        return;
      }
      footerLine = footer;
      forceRedraw = true;
      // Footer changes are also non-urgent; never let them contend with the
      // user's keystrokes. They'll be picked up on the next paint.
      if (userIsTyping()) {
        return;
      }
      softRequestRedraw();
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
  // Multi-line WITH actual content is a paste. A bare "\r" / "\n" / "\r\n"
  // is Enter (submit) or Ctrl+J (insert newline) — NOT a paste. The
  // trimmed-length guard is what distinguishes them; without it, pressing
  // Enter would route through insertPaste because normalize turns "\r" into
  // "\n" and the old heuristic would match on that alone.
  if (trimmed.length > 0 && normalized.includes("\n")) {
    return true;
  }
  // Single-line content that ends with a known image extension — a likely
  // drag-and-drop path paste even without newlines.
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

  const width = terminalWrapWidth(terminalColumns());
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
  const width = terminalWrapWidth(terminalColumns());
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

function truncateAnsiLine(value: string, width: number): string {
  const maxWidth = Math.max(1, width);
  if (visibleLength(value) <= maxWidth) {
    return value;
  }

  const marker = maxWidth <= 3 ? ".".repeat(maxWidth) : "...";
  const targetWidth = Math.max(0, maxWidth - marker.length);
  let row = "";
  let visible = 0;
  let index = 0;
  let sawAnsi = false;

  while (index < value.length && visible < targetWidth) {
    const ansiMatch = /^\x1b\[[0-9;]*m/u.exec(value.slice(index));
    if (ansiMatch) {
      sawAnsi = true;
      row += ansiMatch[0];
      index += ansiMatch[0].length;
      continue;
    }

    const char = Array.from(value.slice(index))[0] ?? "";
    if (!char) {
      break;
    }

    const charWidth = charDisplayWidth(char);
    if (visible + charWidth > targetWidth) {
      break;
    }

    row += char;
    visible += charWidth;
    index += char.length;
  }

  return `${row}${marker}${sawAnsi ? "\x1b[0m" : ""}`;
}

function visibleLength(value: string): number {
  return Array.from(stripAnsi(value)).reduce((sum, char) => sum + charDisplayWidth(char), 0);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
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

function terminalWrapWidth(columns: number): number {
  return Math.max(1, columns - 1);
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
