import { renderAccent, renderMuted } from "./render.ts";

export function createSpinner(onFrame: (frame: string | null) => void): {
  start: () => void;
  refresh: () => void;
  stop: () => void;
} {
  const frames = ["✶", "✸", "✹", "✺", "✹", "✷"];
  const label = "Transmogrifying";
  let index = 0;
  let timer: NodeJS.Timeout | null = null;
  let active = false;
  let startedAt = 0;

  return {
    start() {
      if (active) {
        return;
      }
      active = true;
      startedAt = Date.now();
      onFrame(renderFrame(frames[index] ?? "✶", label, index, 0));
      timer = setInterval(() => {
        index = (index + 1) % frames.length;
        onFrame(renderFrame(frames[index] ?? "✶", label, index, Date.now() - startedAt));
      }, 190);
    },
    refresh() {
      if (!active) {
        this.start();
        return;
      }
      onFrame(renderFrame(frames[index] ?? "✶", label, index, Date.now() - startedAt));
    },
    stop() {
      if (!active) {
        return;
      }
      active = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      onFrame(null);
    },
  };
}

function renderFrame(symbol: string, label: string, index: number, elapsedMs: number): string {
  void index;
  return `${renderAccent(symbol)} ${renderMuted(label)} ${renderMuted(formatElapsed(elapsedMs))}`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
