import type { CommandActivity } from "./command-activity.ts";

export type TerminalMarkdownStream = {
  write: (value: string) => void;
  end: () => void;
};

export type TerminalOutputSink = {
  write: (value: string) => void;
  clear: () => void;
  createMarkdownStream?: () => TerminalMarkdownStream;
  writeCommandActivity?: (activity: CommandActivity) => void;
  writeCompactToolRun?: (activity: { toolName: string, label: string, status: string, args: string, preview: string, fallbackLine: string }) => void;
  writeReasoning?: (content: string) => void;
  writeUserMessage?: (content: string) => void;
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

export function writeCommandActivity(activity: CommandActivity): boolean {
  if (!activeOutputSink?.writeCommandActivity) {
    return false;
  }
  activeOutputSink.writeCommandActivity(activity);
  return true;
}

export function writeReasoning(content: string): boolean {
  if (!activeOutputSink?.writeReasoning) {
    return false;
  }
  activeOutputSink.writeReasoning(content);
  return true;
}

export function writeUserMessage(content: string): boolean {
  if (!activeOutputSink?.writeUserMessage) {
    return false;
  }
  activeOutputSink.writeUserMessage(content);
  return true;
}

export function writeCompactToolRun(activity: { toolName: string, label: string, status: string, args: string, preview: string, fallbackLine: string }): boolean {
  if (!activeOutputSink?.writeCompactToolRun) {
    return false;
  }
  activeOutputSink.writeCompactToolRun(activity);
  return true;
}

// Retained for callers that synchronously print a menu in non-interactive
// mode. Pi owns the terminal in interactive mode, so no draft teardown is
// necessary anymore.
export function withDraftPaused(action: () => void): void {
  action();
}
