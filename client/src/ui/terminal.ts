export type DraftRenderer = {
  clear: () => void;
  redraw: () => void;
};

let activeDraft: DraftRenderer | null = null;

export function setActiveDraft(renderer: DraftRenderer | null): void {
  activeDraft = renderer;
}

export function withDraftPaused(action: () => void): void {
  activeDraft?.clear();
  action();
  activeDraft?.redraw();
}

export function writeOutput(value: string): void {
  withDraftPaused(() => {
    process.stdout.write(value);
  });
}

export function writeOutputLine(value = ""): void {
  writeOutput(`${value}\n`);
}
