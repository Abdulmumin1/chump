import { renderMuted } from "./render.ts";

export function createSpinner(): {
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
      process.stdout.write(`${renderMuted(frames[index])} `);
      timer = setInterval(() => {
        index = (index + 1) % frames.length;
        process.stdout.write(`\r${renderMuted(frames[index])} `);
      }, 90);
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
      process.stdout.write("\n");
    },
  };
}
