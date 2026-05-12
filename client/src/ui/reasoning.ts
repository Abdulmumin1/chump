import { renderMuted, renderThinkingBlock, renderThinkingLabel } from "./render.ts";
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

  finish(): void {
    this.flush();
  }
}

export class LiveReasoningStream {
  private readonly onPreview: ((preview: string | null) => void) | null;
  private buffer = "";
  private lastPreview = "";
  private lastUpdateTime = 0;
  private updateTimer: NodeJS.Timeout | null = null;
  private readonly previewLineLimit = 1;
  private readonly previewCharLimit = 320;
  private readonly minPreviewInterval = 160;

  constructor(options: { onPreview?: ((preview: string | null) => void) | null } = {}) {
    this.onPreview = options.onPreview ?? null;
  }

  render(payload: Record<string, unknown>): void {
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!text) {
      return;
    }

    const next = mergeReasoningText(this.buffer, text);
    if (next === this.buffer) {
      return;
    }

    this.buffer = next;
    this.schedulePreview();
  }

  finish(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    this.onPreview?.(null);

    const content = this.buffer.trim();
    if (content) {
      const block = renderThinkingBlock(null, this.buffer);
      writeOutput(`\n${block.join("\n")}\n\n`);
    }

    this.reset();
  }

  private reset(): void {
    this.buffer = "";
    this.lastPreview = "";
    this.lastUpdateTime = 0;
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
  }

  private schedulePreview(): void {
    if (!this.onPreview) {
      return;
    }
    if (this.updateTimer) {
      return;
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;
    if (timeSinceLastUpdate >= this.minPreviewInterval) {
      this.updatePreview();
      return;
    }

    this.updateTimer = setTimeout(
      () => this.updatePreview(),
      this.minPreviewInterval - timeSinceLastUpdate,
    );
  }

  private updatePreview(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    const preview = renderReasoningPreview(
      this.buffer,
      this.previewLineLimit,
      this.previewCharLimit,
    );
    if (preview && preview !== this.lastPreview) {
      this.lastPreview = preview;
      this.onPreview?.(preview);
    }
    this.lastUpdateTime = Date.now();
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

function renderReasoningPreview(
  value: string,
  lineLimit: number,
  charLimit: number,
): string {
  const cleaned = cleanReasoningText(value);
  if (!cleaned) {
    return "";
  }

  const clipped =
    cleaned.length > charLimit
      ? `...${cleaned.slice(cleaned.length - charLimit).trimStart()}`
      : cleaned;
  const lines = clipped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const visible = lines.slice(-lineLimit).join("\n");
  if (!visible) {
    return "";
  }

  return `${renderThinkingLabel()} ${renderMuted(visible.replace(/\s+/g, " "))}`;
}
