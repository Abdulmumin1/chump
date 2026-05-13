export type DraftRenderer = {
  buildClear: () => string;
  buildRedraw: () => string;
  beforeFlush?: () => void;
};

let activeDraft: DraftRenderer | null = null;

// CSI 2026 synchronized output sequences for atomic screen updates
const SYNC_START = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";

// ---- write batching ----
// During model streaming, writeOutput is called many times per second (once
// per token / line).  Each call recomputes the entire input frame via
// buildClear + buildRedraw, which is expensive.  Batching coalesces writes
// into a single clear→content→redraw cycle.
//
// To avoid overwhelming slow terminal emulators (e.g. embedded editor
// terminals like VS Code) — which can drop keystrokes when flooded with
// escape sequences — we enforce a minimum interval between successive
// flushes.  The first flush after a quiet period fires immediately (via
// setImmediate, which runs after I/O so pending stdin events are processed
// first).  Subsequent flushes within the throttle window are delayed,
// coalescing multiple tokens into fewer screen updates.
//
const MIN_FLUSH_INTERVAL_MS = 33; // ~30 fps

let batchBuffer = "";
let batchScheduled = false;
let lastFlushAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushBatch(): void {
  batchScheduled = false;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  lastFlushAt = Date.now();
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
  if (payload && !payload.endsWith("\n")) {
    payload += "\n";
  }
  process.stdout.write(`${SYNC_START}${clear}${payload}${redraw}${SYNC_END}`);
}

function scheduleFlush(): void {
  if (batchScheduled) {
    return;
  }
  batchScheduled = true;
  const elapsed = Date.now() - lastFlushAt;
  if (elapsed >= MIN_FLUSH_INTERVAL_MS) {
    // Enough time since last flush — go on the next event-loop pass.
    // setImmediate runs after I/O, so pending stdin events are drained first.
    setImmediate(flushBatch);
  } else {
    // Throttle: wait for the remaining interval, then use setImmediate so
    // stdin data events are processed before we write output.
    flushTimer = setTimeout(
      () => setImmediate(flushBatch),
      MIN_FLUSH_INTERVAL_MS - elapsed,
    );
  }
}

export function hasPendingBatch(): boolean {
  return batchScheduled;
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
