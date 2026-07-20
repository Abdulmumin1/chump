export type TerminalMarkdownStream = {
  write: (value: string) => void;
  end: () => void;
};

export type TerminalOutputSink = {
  write: (value: string) => void;
  clear: () => void;
  createMarkdownStream?: () => TerminalMarkdownStream;
};

let activeOutputSink: TerminalOutputSink | null = null;

export function setTerminalOutputSink(sink: TerminalOutputSink | null): void {
  activeOutputSink = sink;
}

export function writeOutput(value: string): void {
  if (activeOutputSink) {
    activeOutputSink.write(value);
    return;
  }
  process.stdout.write(value);
}

export function writeOutputLine(value = ""): void {
  writeOutput(`${value}\n`);
}

export function clearTerminal(): void {
  if (activeOutputSink) {
    activeOutputSink.clear();
    return;
  }
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

export function createLiveMarkdownStream(): TerminalMarkdownStream | null {
  return activeOutputSink?.createMarkdownStream?.() ?? null;
}

// Retained for callers that synchronously print a menu in non-interactive
// mode. Pi owns the terminal in interactive mode, so no draft teardown is
// necessary anymore.
export function withDraftPaused(action: () => void): void {
  action();
}
