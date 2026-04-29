export type DraftRenderer = {
  clear: () => void;
  redraw: () => void;
};

let activeDraft: DraftRenderer | null = null;
let pauseDepth = 0;
let draftNeedsRedraw = false;
let redrawHandle: NodeJS.Immediate | null = null;

export function setActiveDraft(renderer: DraftRenderer | null): void {
  activeDraft = renderer;
  if (!renderer) {
    draftNeedsRedraw = false;
    if (redrawHandle) {
      clearImmediate(redrawHandle);
      redrawHandle = null;
    }
  }
}

export function withDraftPaused(action: () => void): void {
  const shouldClear = pauseDepth === 0 && activeDraft !== null;
  if (shouldClear) {
    if (redrawHandle) {
      clearImmediate(redrawHandle);
      redrawHandle = null;
    }
    activeDraft?.clear();
    draftNeedsRedraw = true;
  }

  pauseDepth += 1;
  try {
    action();
  } finally {
    pauseDepth -= 1;
    if (pauseDepth === 0 && draftNeedsRedraw) {
      scheduleDraftRedraw();
    }
  }
}

export function writeOutput(value: string): void {
  withDraftPaused(() => {
    process.stdout.write(value);
  });
}

export function writeOutputLine(value = ""): void {
  writeOutput(`${value}\n`);
}

export function clearTerminal(): void {
  withDraftPaused(() => {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  });
}

function scheduleDraftRedraw(): void {
  if (redrawHandle) {
    return;
  }

  redrawHandle = setImmediate(() => {
    redrawHandle = null;
    if (!draftNeedsRedraw || pauseDepth !== 0) {
      return;
    }
    draftNeedsRedraw = false;
    activeDraft?.redraw();
  });
}
