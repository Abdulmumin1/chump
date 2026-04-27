import { renderAccent, renderMuted } from "./render.ts";

export function createSpinner(onFrame: (frame: string | null) => void): {
  start: () => void;
  stop: () => void;
} {
  const frames = ["✶", "✸", "✹", "✺", "✹", "✷"];
  const label = "Transmogrifying";
  let index = 0;
  let timer: NodeJS.Timeout | null = null;
  let active = false;

  return {
    start() {
      active = true;
      onFrame(renderFrame(frames[index] ?? "✶", label, index));
      timer = setInterval(() => {
        index = (index + 1) % frames.length;
        onFrame(renderFrame(frames[index] ?? "✶", label, index));
      }, 190);
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

function renderFrame(symbol: string, label: string, index: number): string {
  return `${renderAccent(symbol)} ${renderShimmer(label, index)}`;
}

function renderShimmer(label: string, index: number): string {
  const activeIndex = index % label.length;
  return Array.from(label).map((char, charIndex) => {
    if (charIndex === activeIndex) {
      return renderAccent(char);
    }
    if (charIndex === activeIndex - 1 || charIndex === activeIndex + 1) {
      return renderMuted(char);
    }
    return renderMuted(char);
  }).join("");
}
