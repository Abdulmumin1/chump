export type DraftRenderer = {
  buildClear: () => string;
  buildRedraw: () => string;
  /**
   * Called synchronously inside flushBatch, just before writing the atomic
   * clear→content→redraw sequence to stdout.  Use this to cancel any
   * pending renders in the underlying TUI library so they don't overwrite
   * the frame we are about to paint.
   */
  beforeFlush?: () => void;
};

let activeDraft: DraftRenderer | null = null;

// CSI 2026 synchronized output sequences for atomic screen updates
const SYNC_START = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";

// ---- write batching ----
// During model streaming, writeOutput is called many times per second (once
// per token / line).  Each call recomputes the entire input frame via
// buildClear + buildRedraw, which is expensive.  Batching coalesces all
// writes within the same event-loop tick into a single clear→content→redraw
// cycle, dramatically reducing the compute overhead and keeping the input
// box responsive.
//
// We use setImmediate (not setTimeout) so the batch fires as soon as the
// current call stack drains, before pi-tui's process.nextTick render can
// slip in and paint a stale/empty input frame between our clear and redraw.

let batchBuffer = "";
let batchScheduled = false;

function flushBatch(): void {
  batchScheduled = false;
  if (!batchBuffer) {
    return;
  }
  if (!activeDraft) {
    process.stdout.write(batchBuffer);
    batchBuffer = "";
    return;
  }
  activeDraft.beforeFlush?.();
  const clear = activeDraft.buildClear();
  const redraw = activeDraft.buildRedraw();
  let payload = batchBuffer;
  batchBuffer = "";
  // Ensure payload ends with newline so the redraw doesn't overwrite the last line.
  // The redraw starts with \r\x1b[2K which clears the current line, so if the
  // payload doesn't end with \n, the last line of content would be cleared.
  if (payload && !payload.endsWith("\n")) {
    payload += "\n";
  }
  process.stdout.write(`${SYNC_START}${clear}${payload}${redraw}${SYNC_END}`);
}

function scheduleFlush(): void {
  if (!batchScheduled) {
    batchScheduled = true;
    setImmediate(flushBatch);
  }
}

export function setActiveDraft(renderer: DraftRenderer | null): void {
  activeDraft = renderer;
}

export function writeOutput(value: string): void {
  if (!activeDraft) {
    process.stdout.write(value);
    return;
  }
  batchBuffer += value;
  scheduleFlush();
}

export function writeOutputLine(value = ""): void {
  writeOutput(`${value}\n`);
}

export function clearTerminal(): void {
  if (!activeDraft) {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    return;
  }
  // Flush any pending batched output first so it doesn't appear after the clear
  if (batchScheduled) {
    flushBatch();
  }
  const clear = activeDraft.buildClear();
  const redraw = activeDraft.buildRedraw();
  process.stdout.write(`${SYNC_START}${clear}\x1b[2J\x1b[3J\x1b[H${redraw}${SYNC_END}`);
}

// Run an action that needs the live draft cleared (e.g. when reading raw input
// from the TTY synchronously). Temporarily disables the draft so that
// writeOutput calls inside the action go directly to stdout without
// clear/redraw cycles.
export function withDraftPaused(action: () => void): void {
  if (!activeDraft) {
    action();
    return;
  }
  const draft = activeDraft;
  // Flush any pending batched output so it doesn't get lost
  if (batchScheduled) {
    flushBatch();
  }
  // Clear the input frame
  process.stdout.write(draft.buildClear());
  // Temporarily disable the draft so writeOutput goes directly to stdout
  activeDraft = null;
  try {
    action();
  } finally {
    // Restore the draft and redraw
    activeDraft = draft;
    process.stdout.write(draft.buildRedraw());
  }
}
