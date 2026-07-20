import {
  Container,
  Markdown,
  Spacer,
  type Component,
  type MarkdownTheme,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { TerminalMarkdownStream } from "../terminal.ts";

export class StreamingText implements Component {
  private value = "";
  private readonly completedLines: CachedAnsiLine[] = [];
  private tail = "";
  private lastCompletedBlank = false;

  append(value: string): void {
    this.value += value;
    const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = `${this.tail}${normalized}`.split("\n");
    this.tail = parts.pop() ?? "";
    for (const line of parts) {
      const blank = line.trim().length === 0;
      if (blank && this.lastCompletedBlank) {
        continue;
      }
      this.completedLines.push(new CachedAnsiLine(line));
      this.lastCompletedBlank = blank;
    }
  }

  clear(): void {
    this.value = "";
    this.completedLines.length = 0;
    this.tail = "";
    this.lastCompletedBlank = false;
  }

  getValue(): string {
    return this.value;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.value) {
      return [];
    }
    const renderWidth = Math.max(1, width);
    const lines = this.completedLines.flatMap((line) => line.render(renderWidth));
    if (this.tail) {
      lines.push(...wrapTextWithAnsi(this.tail, renderWidth));
    }
    return lines;
  }

  endsWithBlankLine(): boolean {
    return !this.tail && this.lastCompletedBlank;
  }
}

/**
 * An ordered transcript made of immutable text runs and one mutable Markdown
 * block per assistant response. Only the active Markdown block is reparsed
 * while streaming; completed runs retain Pi's component caches.
 */
export class TuiTranscript extends Container {
  private currentText: StreamingText | null = null;
  private readonly markdownTheme: MarkdownTheme;
  private hasContent = false;

  constructor(markdownTheme: MarkdownTheme) {
    super();
    this.markdownTheme = markdownTheme;
  }

  append(value: string): void {
    if (!value) {
      return;
    }
    if (!this.currentText) {
      this.currentText = new StreamingText();
      this.addChild(this.currentText);
    }
    this.currentText.append(value);
    this.hasContent = true;
  }

  createMarkdownStream(
    transform: (value: string) => string,
    onChange: () => void,
  ): TerminalMarkdownStream {
    if (this.hasContent && !this.currentText?.endsWithBlankLine()) {
      this.addChild(new Spacer(1));
    }
    this.currentText = null;
    const markdown = new Markdown("", 0, 0, this.markdownTheme);
    this.addChild(markdown);
    let value = "";
    let ended = false;

    return {
      write: (chunk) => {
        if (ended || !chunk) {
          return;
        }
        value += transform(chunk);
        markdown.setText(value);
        this.hasContent = true;
        onChange();
      },
      end: () => {
        ended = true;
        this.currentText = null;
      },
    };
  }

  override clear(): void {
    super.clear();
    this.currentText = null;
    this.hasContent = false;
  }

  hasTrailingGap(): boolean {
    return this.currentText?.endsWithBlankLine() === true;
  }
}

class CachedAnsiLine {
  private readonly value: string;
  private cachedWidth = 0;
  private cachedLines: string[] | null = null;

  constructor(value: string) {
    this.value = value;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    this.cachedWidth = width;
    this.cachedLines = wrapTextWithAnsi(this.value, width);
    return this.cachedLines;
  }
}

export class MutableLines implements Component {
  private values: string[] = [];

  set(values: string[]): void {
    this.values = values;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const renderWidth = Math.max(1, width);
    return this.values.map((value) =>
      truncateToWidth(singleTerminalLine(value), renderWidth)
    );
  }
}

function singleTerminalLine(value: string): string {
  return value
    .replace(/\r\n|\r|\n/gu, " ↵ ")
    .replace(/\t/gu, " ");
}

export class TranscriptGap implements Component {
  private readonly transcript: TuiTranscript;

  constructor(transcript: TuiTranscript) {
    this.transcript = transcript;
  }

  invalidate(): void {}

  render(_width: number): string[] {
    return this.transcript.hasTrailingGap() ? [] : [""];
  }
}

export class SessionFooter implements Component {
  private location: string | null = null;
  private metadata: string | null = null;
  private context: string | null = null;
  private readonly style: (value: string) => string;

  constructor(style: (value: string) => string) {
    this.style = style;
  }

  setFooter(value: string | null): void {
    const [location = "", ...metadata] = (value ?? "").split("\n");
    this.location = location.trim() || null;
    this.metadata = metadata.join(" ").trim() || null;
  }

  setContext(value: string | null): void {
    this.context = value?.trim() || null;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const renderWidth = Math.max(1, width);
    const lines: string[] = [];
    if (this.location) {
      lines.push(this.style(truncateToWidth(this.location, renderWidth)));
    }

    if (this.context) {
      lines.push(this.style(truncateToWidth(this.context, renderWidth)));
    }
    if (this.metadata) {
      lines.push(this.style(truncateToWidth(this.metadata, renderWidth)));
    }
    return lines;
  }
}
