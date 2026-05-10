export type DraftRenderer = {
  buildClear: () => string;
  buildRedraw: () => string;
};

let activeDraft: DraftRenderer | null = null;

export function setActiveDraft(renderer: DraftRenderer | null): void {
  activeDraft = renderer;
}

export function writeOutput(value: string): void {
  if (!activeDraft) {
    process.stdout.write(value);
    return;
  }
  // Build clear + payload + redraw as a single write so the terminal can never
  // flush a partial frame between the three. This eliminates the "input box
  // jumps up then down" flicker when blocks (thinking summaries, tool output,
  // assistant chunks) are committed to scrollback while the input is live.
  const clear = activeDraft.buildClear();
  const redraw = activeDraft.buildRedraw();
  process.stdout.write(`${clear}${value}${redraw}`);
}

export function writeOutputLine(value = ""): void {
  writeOutput(`${value}\n`);
}

export function clearTerminal(): void {
  if (!activeDraft) {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    return;
  }
  const clear = activeDraft.buildClear();
  const redraw = activeDraft.buildRedraw();
  process.stdout.write(`${clear}\x1b[2J\x1b[3J\x1b[H${redraw}`);
}

// Run an action that needs the live draft cleared (e.g. when reading raw input
// from the TTY synchronously). Emits clear/redraw as separate writes — only
// use when you cannot pre-build the payload as a string.
export function withDraftPaused(action: () => void): void {
  if (!activeDraft) {
    action();
    return;
  }
  const draft = activeDraft;
  process.stdout.write(draft.buildClear());
  try {
    action();
  } finally {
    process.stdout.write(draft.buildRedraw());
  }
}
