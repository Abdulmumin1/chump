import {
  renderThinkingBlock,
  renderThinkingLabel,
  renderThinkingText,
} from "./render.ts";
import { writeOutput } from "./terminal.ts";

export class ReasoningRenderer {
  private buffer = "";
  private activity = false;

  consumeActivity(): boolean {
    const hadActivity = this.activity;
    this.activity = false;
    return hadActivity;
  }

  render(payload: Record<string, unknown>): void {
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!text) {
      return;
    }

    this.buffer = mergeReasoningText(this.buffer, text);
    this.activity = true;
  }

  flush(): void {
    const content = this.buffer.trim();
    if (!content) {
      return;
    }
    const block = renderThinkingBlock(null, this.buffer);
    writeOutput(`\n${block.join("\n")}\n\n`);
    this.buffer = "";
  }
}

export class LiveReasoningStream {
  private readonly onPreview: ((preview: string | null) => void) | null;
  private plainText = "";
  private previewTimer: NodeJS.Timeout | null = null;

  constructor(options: { onPreview?: ((preview: string | null) => void) | null } = {}) {
    this.onPreview = options.onPreview ?? null;
  }

  render(payload: Record<string, unknown>): void {
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!text) {
      return;
    }

    const merged = mergeReasoningText(this.plainText, text);
    if (merged === this.plainText) {
      return;
    }

    this.plainText = merged;
    this.schedulePreview();
  }

  finish(): void {
    this.clearPreviewTimer();
    this.onPreview?.(null);

    const text = cleanReasoningText(this.plainText);
    if (text) {
      const block = renderThinkingBlock(null, text);
      writeOutput(`\n${block.join("\n")}\n\n`);
    }

    this.reset();
  }

  private schedulePreview(): void {
    if (this.previewTimer) {
      return;
    }
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.onPreview?.(this.preview());
    }, 120);
  }

  private preview(): string | null {
    const text = cleanReasoningPreview(this.plainText);
    if (!text) {
      return null;
    }
    const clipped = text.length > 96 ? `...${text.slice(-93)}` : text;
    return `${renderThinkingLabel()} ${renderThinkingText(clipped)}`;
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }

  private reset(): void {
    this.clearPreviewTimer();
    this.plainText = "";
  }
}

function mergeReasoningText(existing: string, incoming: string): string {
  const normalized = normalizeChunk(incoming, existing.length === 0);
  if (!normalized.trim()) {
    return existing;
  }
  const appended = appendNovelSuffix(existing, normalized);
  if (!appended) {
    return existing;
  }
  return existing + appended;
}

function normalizeChunk(value: string, trimStart: boolean): string {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n");
  return trimStart ? normalized.trimStart() : normalized;
}

function appendNovelSuffix(existing: string, incoming: string): string {
  if (!incoming) {
    return "";
  }
  if (!existing) {
    return incoming;
  }
  if (existing.endsWith(incoming)) {
    return "";
  }
  if (incoming.startsWith(existing)) {
    return incoming.slice(existing.length);
  }

  const tail = existing.slice(-Math.min(existing.length, incoming.length, 1024));
  const maxOverlap = Math.min(tail.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (tail.slice(-overlap) === incoming.slice(0, overlap)) {
      return incoming.slice(overlap);
    }
  }
  return incoming;
}

function cleanReasoningText(value: string): string {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split("\n")
    .map((line) => dedupeAdjacentWords(line))
    .join("\n");
}

function cleanReasoningPreview(value: string): string {
  return cleanReasoningText(value).replace(/\s+/g, " ").trim();
}

function dedupeAdjacentWords(value: string): string {
  const words = value.split(" ");
  const cleaned: string[] = [];
  for (const word of words) {
    const previous = cleaned[cleaned.length - 1];
    if (previous && stripWord(previous) === stripWord(word)) {
      continue;
    }
    cleaned.push(word);
  }
  return cleaned.join(" ");
}

function stripWord(value: string): string {
  return value.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, "");
}
