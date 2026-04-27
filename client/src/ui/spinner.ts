import { renderMuted } from "./render.ts";

export function createSpinner(onFrame: (frame: string | null) => void): {
  start: () => void;
  stop: () => void;
} {
  const frames = ["✶", "✸", "✹", "✺", "✹", "✷"];
  let index = 0;
  let timer: NodeJS.Timeout | null = null;
  let active = false;

  return {
    start() {
      active = true;
      onFrame(renderMuted(frames[index] ?? "✶"));
      timer = setInterval(() => {
        index = (index + 1) % frames.length;
        onFrame(renderMuted(frames[index] ?? "✶"));
      }, 120);
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
