import {
  Container,
  Markdown,
  Spacer,
  type Component,
  type MarkdownTheme,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import {
  type CommandActivity,
  renderCommandActivityLines,
} from "../command-activity.ts";
import { renderThinkingLabel, renderTuiMuted } from "../render.ts";
import type { TerminalMarkdownStream } from "../terminal.ts";
import { renderToolDone, renderToolResult } from "../render.ts";

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
  private currentCompactGroup: CompactToolGroup | null = null;
  private readonly markdownTheme: MarkdownTheme;
  private readonly commandActivities: ExpandableCommandActivity[] = [];
  private readonly reasoningBlocks: ToggleableReasoning[] = [];
  private hasContent = false;
  private trailingGap = false;
  private toolsExpanded = false;
  private thinkingVisible = true;

  constructor(markdownTheme: MarkdownTheme) {
    super();
    this.markdownTheme = markdownTheme;
  }

  append(value: string): void {
    if (!value) {
      return;
    }
    this.currentCompactGroup = null;
    if (!this.currentText) {
      this.currentText = new StreamingText();
      this.addChild(this.currentText);
    }
    this.currentText.append(value);
    this.hasContent = true;
    this.trailingGap = this.currentText.endsWithBlankLine();
  }

  appendCommandActivity(activity: CommandActivity): void {
    this.currentText = null;
    this.currentCompactGroup = null;
    const component = new ExpandableCommandActivity(
      activity,
      this.toolsExpanded,
    );
    this.commandActivities.push(component);
    this.addChild(component);
    this.hasContent = true;
    this.trailingGap = false;
  }

  appendReasoning(content: string): void {
    const normalized = content.trim();
    if (!normalized) {
      return;
    }
    this.currentText = null;
    this.currentCompactGroup = null;
    const component = new ToggleableReasoning(
      normalized,
      this.markdownTheme,
      this.thinkingVisible,
    );
    this.reasoningBlocks.push(component);
    this.addChild(component);
    this.hasContent = true;
    this.trailingGap = false;
  }

  appendCompactToolRun(activity: { toolName: string, label: string, status: string, args: string, preview: string, fallbackLine: string }): void {
    this.currentText = null;
    if (this.currentCompactGroup?.getToolName() === activity.toolName) {
      this.currentCompactGroup.addRun(activity);
    } else {
      if (!this.currentCompactGroup && this.hasContent && !this.trailingGap) {
        this.addChild(new Spacer(1));
      }
      this.currentCompactGroup = new CompactToolGroup(activity);
      this.addChild(this.currentCompactGroup);
      this.hasContent = true;
      this.trailingGap = false;
    }
  }

  setToolsExpanded(expanded: boolean): void {
    this.toolsExpanded = expanded;
    for (const activity of this.commandActivities) {
      activity.setExpanded(expanded);
    }
  }

  areToolsExpanded(): boolean {
    return this.toolsExpanded;
  }

  setThinkingVisible(visible: boolean): void {
    this.thinkingVisible = visible;
    for (const reasoning of this.reasoningBlocks) {
      reasoning.setVisible(visible);
    }
  }

  isThinkingVisible(): boolean {
    return this.thinkingVisible;
  }

  createMarkdownStream(
    transform: (value: string) => string,
    onChange: () => void,
  ): TerminalMarkdownStream {
    if (this.hasContent && !this.currentText?.endsWithBlankLine()) {
      this.addChild(new Spacer(1));
    }
    this.currentText = null;
    this.currentCompactGroup = null;
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
        this.trailingGap = false;
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
    this.currentCompactGroup = null;
    this.hasContent = false;
    this.trailingGap = false;
    this.commandActivities.length = 0;
    this.reasoningBlocks.length = 0;
  }

  hasTrailingGap(): boolean {
    return this.trailingGap;
  }
}

export class ExpandableCommandActivity implements Component {
  private readonly activity: CommandActivity;
  private expanded: boolean;

  constructor(activity: CommandActivity, expanded = false) {
    this.activity = activity;
    this.expanded = expanded;
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return renderCommandActivityLines(
      this.activity,
      Math.max(1, width),
      this.expanded,
    );
  }
}

export class ToggleableReasoning implements Component {
  private readonly markdown: Markdown;
  private visible: boolean;

  constructor(
    content: string,
    markdownTheme: MarkdownTheme,
    visible = true,
  ) {
    this.markdown = new Markdown(content, 0, 0, markdownTheme);
    this.visible = visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  invalidate(): void {
    this.markdown.invalidate();
  }

  render(width: number): string[] {
    if (!this.visible) {
      return [];
    }
    const renderWidth = Math.max(1, width);
    const bodyWidth = Math.max(1, renderWidth - 2);
    return [
      "",
      renderThinkingLabel(),
      ...this.markdown.render(bodyWidth).map((line) =>
        truncateToWidth(renderTuiMuted(`  ${line}`), renderWidth)
      ),
    ];
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
  private readonly showHiddenCharacterCount: boolean;

  constructor(options: { showHiddenCharacterCount?: boolean } = {}) {
    this.showHiddenCharacterCount = options.showHiddenCharacterCount ?? false;
  }

  set(values: string[]): void {
    this.values = values;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const renderWidth = Math.max(1, width);
    return this.values.map((value) =>
      this.showHiddenCharacterCount
        ? truncateWithHiddenCharacterCount(singleTerminalLine(value), renderWidth)
        : truncateToWidth(singleTerminalLine(value), renderWidth)
    );
  }
}

function singleTerminalLine(value: string): string {
  return value
    .replace(/\r\n|\r|\n/gu, " ↵ ")
    .replace(/\t/gu, " ");
}

function truncateWithHiddenCharacterCount(value: string, width: number): string {
  if (visibleWidth(value) <= width) {
    return value;
  }

  const fileChangeSuffix = readFileChangeSuffix(value);
  if (fileChangeSuffix && fileChangeSuffix.width < width) {
    const ellipsis = renderTuiMuted("…");
    const prefixWidth = Math.max(0, width - fileChangeSuffix.width - 1);
    return `${truncateToWidth(value, prefixWidth, "")}${ellipsis}${fileChangeSuffix.value}`;
  }

  const totalCharacters = countVisibleCharacters(value);
  let hiddenCharacters = totalCharacters;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const suffix = `… (+${hiddenCharacters.toLocaleString()} chars)`;
    if (visibleWidth(suffix) >= width) {
      return truncateToWidth(value, width);
    }

    const prefix = truncateToWidth(value, width - visibleWidth(suffix), "");
    const nextHiddenCharacters = Math.max(
      0,
      totalCharacters - countVisibleCharacters(prefix),
    );
    if (nextHiddenCharacters === hiddenCharacters) {
      return `${prefix}${renderTuiMuted(suffix)}`;
    }
    hiddenCharacters = nextHiddenCharacters;
  }

  const suffix = `… (+${hiddenCharacters.toLocaleString()} chars)`;
  return visibleWidth(suffix) < width
    ? `${truncateToWidth(value, width - visibleWidth(suffix), "")}${renderTuiMuted(suffix)}`
    : truncateToWidth(value, width);
}

function readFileChangeSuffix(
  value: string,
): { value: string; width: number } | null {
  const plainText = stripAnsi(value);
  const match = /\s\+\d[\d,]*\s-\d[\d,]*$/u.exec(plainText);
  if (!match || match.index === undefined) {
    return null;
  }

  const startColumn = visibleWidth(plainText.slice(0, match.index));
  const width = visibleWidth(match[0]);
  return {
    value: sliceByColumn(value, startColumn, width, true),
    width,
  };
}

function countVisibleCharacters(value: string): number {
  const plainText = stripAnsi(value);
  return [...graphemeSegmenter.segment(plainText)].length;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE, "");
}

const ANSI_ESCAPE_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/gu;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

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

export class CompactToolGroup implements Component {
  private toolName: string;
  private label: string;
  private runs: Array<{ status: string; args: string; preview: string; fallbackLine: string }> = [];

  constructor(firstRun: { toolName: string, label: string, status: string, args: string, preview: string, fallbackLine: string }) {
    this.toolName = firstRun.toolName;
    this.label = firstRun.label;
    this.runs.push(firstRun);
  }

  getToolName(): string {
    return this.toolName;
  }

  addRun(run: { status: string; args: string; preview: string; fallbackLine: string }): void {
    this.runs.push(run);
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.runs.length === 0) {
      return [];
    }
    const renderWidth = Math.max(1, width);
    if (this.runs.length === 1) {
      return [truncateToWidth(singleTerminalLine(this.runs[0].fallbackLine), renderWidth)];
    }

    // Grouped layout
    const header = this.runs.every((run) => run.status === "ok")
      ? renderToolDone(this.label, "")
      : renderToolResult("error", this.label, "");
    const lines = [truncateToWidth(singleTerminalLine(header), renderWidth)];
    for (let i = 0; i < this.runs.length; i++) {
      const run = this.runs[i];
      const isLast = i === this.runs.length - 1;
      const prefix = isLast ? "  └─ " : "  ├─ ";
      
      const content = run.preview || run.args;
      const contentLine = run.status === "ok"
        ? `${prefix}${content}`
        : `${prefix}× ${content}`;
      
      lines.push(truncateToWidth(singleTerminalLine(renderTuiMuted(contentLine)), renderWidth));
    }
    return lines;
  }
}
