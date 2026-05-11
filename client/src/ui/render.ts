import fs from "node:fs";
import { writeOutput } from "./terminal.ts";

const STYLE_RESET = "\x1b[0m";

const darkPalette = {
  accent: "#b8dd35",
  accentStrong: "#96bf00",
  foregroundStrong: "#d0d0d0",
  thinkingLabel: "#93a65a",
  thinkingTitle: "#c79b67",
  muted: "#8a8a8a",
  thinkingText: "#737373",
  danger: "#ff6b6b",
  dangerMuted: "#b56b63",
  successMuted: "#8fad33",
  editHeader: "#c5c5c5",
  selectedBg: "#494d54",
  diffAddBg: "#26330f",
  diffRemoveBg: "#3a1f1c",
};

const lightPalette = {
  accent: "#4f6900",
  accentStrong: "#425900",
  foregroundStrong: "#343434",
  thinkingLabel: "#4f5f16",
  thinkingTitle: "#7a5200",
  muted: "#545454",
  thinkingText: "#4f4f4f",
  danger: "#b42318",
  dangerMuted: "#8f4a43",
  successMuted: "#627a18",
  editHeader: "#3f3f3f",
  selectedBg: "#c8d4a8",
  diffAddBg: "#d6f0b2",
  diffRemoveBg: "#fad4d0",
};

const palette = isLightTerminal() ? lightPalette : darkPalette;

function ansi(code: string, value: string): string {
  if (process.env.NO_COLOR) {
    return value;
  }
  return `${code}${value}${STYLE_RESET}`;
}

function fg(hex: string, value: string): string {
  const [red, green, blue] = [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  return ansi(`\x1b[38;2;${red};${green};${blue}m`, value);
}

function bg(hex: string, value: string): string {
  const [red, green, blue] = [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  return ansi(`\x1b[48;2;${red};${green};${blue}m`, value);
}

function bold(value: string): string {
  return ansi("\x1b[1m", value);
}

function italic(value: string): string {
  return ansi("\x1b[3m", value);
}

function underline(value: string): string {
  return ansi("\x1b[4m", value);
}

function accent(value: string): string {
  return fg(palette.accent, value);
}

function success(value: string): string {
  return fg(palette.accentStrong, value);
}

function muted(value: string): string {
  if (isLightTerminal()) {
    return fg(palette.muted, value);
  }
  return ansi("\x1b[2m", value);
}

function danger(value: string): string {
  return fg(palette.danger, value);
}

function foreground(value: string): string {
  return value;
}

export function createMarkdownStream(): {
  write: (chunk: string) => void;
  end: () => void;
} {
  let buffer = "";
  let inCodeBlock = false;

  function renderStreamLine(line: string, includeNewline: boolean): string {
    const rendered = renderMarkdownLine(line, inCodeBlock);

    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    }
    return includeNewline ? `${rendered}\n` : rendered;
  }

  return {
    write(chunk: string) {
      buffer += chunk;
      let output = "";

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        output += renderStreamLine(line, true);
      }

      if (output) {
        writeOutput(output);
      }
    },
    end() {
      if (buffer.length > 0) {
        writeOutput(renderStreamLine(buffer, true));
        buffer = "";
      }
    },
  };
}

export function renderMarkdownBlock(value: string): string {
  let inCodeBlock = false;
  const rendered = value.split("\n").map((line) => {
    const renderedLine = renderMarkdownLine(line, inCodeBlock);
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    }
    return renderedLine;
  });
  return rendered.join("\n");
}

function renderMarkdownLine(line: string, inCodeBlock: boolean): string {
  const trimmedStart = line.trimStart();
  const indent = line.slice(0, line.length - trimmedStart.length);

  if (trimmedStart.startsWith("```")) {
    const language = trimmedStart.slice(3).trim();
    return language ? `${indent}${muted(language)}` : "";
  }

  if (inCodeBlock) {
    return `${indent}${accent(trimmedStart)}`;
  }

  // Horizontal rules: --- / *** / ___ (3+ chars, optionally spaced)
  if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(trimmedStart)) {
    const cols = process.stdout.columns ?? 80;
    return muted("─".repeat(Math.max(12, cols - 2)));
  }

  const heading = /^(#{1,6})\s+(.+)$/.exec(trimmedStart);
  if (heading) {
    const level = (heading[1] ?? "").length;
    const text = renderInlineMarkdown(heading[2] ?? "");
    // H1/H2 bold+strong, H3+ just bold
    return level <= 2
      ? `${indent}${bold(fg(palette.foregroundStrong, text))}`
      : `${indent}${bold(text)}`;
  }

  const bullet = /^([-*+])\s+(.*)$/.exec(trimmedStart);
  if (bullet) {
    return `${indent}${muted("•")} ${renderInlineMarkdown(bullet[2] ?? "")}`;
  }

  const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmedStart);
  if (numbered) {
    return `${indent}${muted(`${numbered[1]}.`)} ${renderInlineMarkdown(numbered[2] ?? "")}`;
  }

  const quote = /^(>{1,})\s?(.*)$/.exec(trimmedStart);
  if (quote) {
    const depth = (quote[1] ?? "").length;
    const bar = muted("│ ".repeat(depth).trimEnd());
    const inner = renderInlineMarkdown(quote[2] ?? "");
    return `${indent}${bar} ${muted(stripAnsi(inner))}`;
  }

  return renderInlineMarkdown(line);
}

function renderInlineMarkdown(value: string): string {
  let rendered = "";
  let index = 0;
  const source = normalizeMarkdownEscapes(value);

  while (index < source.length) {
    // ── code spans ────────────────────────────────────────────────────────────
    // Double-backtick: ``code`` (content may contain single backticks)
    if (source.startsWith("``", index) && source[index + 2] !== "`") {
      const end = source.indexOf("``", index + 2);
      if (end > index + 2) {
        rendered += accent(source.slice(index + 2, end));
        index = end + 2;
        continue;
      }
    }

    // Single-backtick: `code`
    if (source[index] === "`" && source[index + 1] !== "`") {
      const end = source.indexOf("`", index + 1);
      if (end > index) {
        rendered += accent(source.slice(index + 1, end));
        index = end + 1;
        continue;
      }
    }

    // ── strikethrough ─────────────────────────────────────────────────────────
    if (source.startsWith("~~", index)) {
      const end = source.indexOf("~~", index + 2);
      if (end > index + 2) {
        rendered += muted(renderInlineMarkdown(source.slice(index + 2, end)));
        index = end + 2;
        continue;
      }
    }

    // ── bold (**text** or __text__) ───────────────────────────────────────────
    if (source.startsWith("**", index) && source[index + 2] !== " ") {
      const end = findClosingDelimiter(source, "**", index + 2);
      if (end !== -1) {
        rendered += bold(fg(palette.foregroundStrong, renderInlineMarkdown(source.slice(index + 2, end))));
        index = end + 2;
        continue;
      }
    }

    if (source.startsWith("__", index) && source[index + 2] !== " ") {
      const end = findClosingDelimiter(source, "__", index + 2);
      if (end !== -1) {
        rendered += bold(fg(palette.foregroundStrong, renderInlineMarkdown(source.slice(index + 2, end))));
        index = end + 2;
        continue;
      }
    }

    // ── italic (*text* or _text_) ─────────────────────────────────────────────
    // Only match single * or _ that are not part of ** / __
    if (source[index] === "*" && source[index + 1] !== "*" && source[index + 1] !== " ") {
      const end = findSingleDelimiter(source, "*", index + 1);
      if (end !== -1) {
        rendered += italic(renderInlineMarkdown(source.slice(index + 1, end)));
        index = end + 1;
        continue;
      }
    }

    if (source[index] === "_" && source[index + 1] !== "_" && source[index + 1] !== " ") {
      const end = findSingleDelimiter(source, "_", index + 1);
      if (end !== -1) {
        rendered += italic(renderInlineMarkdown(source.slice(index + 1, end)));
        index = end + 1;
        continue;
      }
    }

    // ── links [label](url) ────────────────────────────────────────────────────
    if (source[index] === "[") {
      const labelEnd = source.indexOf("]", index + 1);
      if (labelEnd !== -1 && source[labelEnd + 1] === "(") {
        const urlEnd = source.indexOf(")", labelEnd + 2);
        if (urlEnd !== -1) {
          const label = source.slice(index + 1, labelEnd);
          const url = source.slice(labelEnd + 2, urlEnd);
          rendered += `${underline(renderInlineMarkdown(label))} ${muted(url)}`;
          index = urlEnd + 1;
          continue;
        }
      }
    }

    rendered += foreground(source[index] ?? "");
    index += 1;
  }

  return rendered;
}

/**
 * Find the next occurrence of a two-character closing delimiter (e.g. "**"),
 * ensuring it is not preceded by a space (so "** word **" doesn't close early).
 */
function findClosingDelimiter(source: string, delimiter: string, fromIndex: number): number {
  let i = fromIndex;
  while (i <= source.length - delimiter.length) {
    const pos = source.indexOf(delimiter, i);
    if (pos === -1) return -1;
    // Must not have a space immediately before the delimiter
    if (pos > fromIndex && source[pos - 1] !== " ") {
      return pos;
    }
    i = pos + 1;
  }
  return -1;
}

/**
 * Find the next single-character delimiter (e.g. "*" or "_") that is not
 * doubled (i.e. not followed by the same char) and not preceded by a space.
 */
function findSingleDelimiter(source: string, delimiter: string, fromIndex: number): number {
  let i = fromIndex;
  while (i < source.length) {
    const pos = source.indexOf(delimiter, i);
    if (pos === -1) return -1;
    // Skip doubled delimiters (** or __)
    if (source[pos + 1] === delimiter) {
      i = pos + 2;
      continue;
    }
    // Must not be preceded by space
    if (source[pos - 1] !== " ") {
      return pos;
    }
    i = pos + 1;
  }
  return -1;
}

function normalizeMarkdownEscapes(value: string): string {
  return value
    .replace(/\\([`*_])/g, "$1")
    .replace(/\uFF0A/g, "*")
    .replace(/\uFF3F/g, "_")
    .replace(/\u02CB/g, "`")
    .replace(/\u02CA/g, "`");
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

export function renderToolStart(name: string, args: string): string {
  const suffix = args ? ` ${muted(args)}` : "";
  return `${muted("✶")} ${accent(name)}${suffix}`;
}

export function renderToolResult(
  status: string,
  name: string,
  preview: string,
): string {
  if (status === "ok") {
    return `${success("·")} ${accent(name)} ${muted(preview)}`;
  }
  return `${danger("×")} ${accent(name)} ${preview}`;
}

export function renderToolDone(name: string, args: string): string {
  const suffix = args ? ` ${foreground(args)}` : "";
  return `${success("·")} ${accent(name)}${suffix}`;
}

export type FileEditDiff = {
  path: string;
  kind?: "add" | "update" | "delete" | "move";
  sourcePath?: string | null;
  added: number;
  removed: number;
  changes?: FileEditChange[];
  lines?: string[];
  truncated: boolean;
  shownChanges?: number;
  totalChanges?: number;
};

export type FileEditChange = {
  type: "add" | "remove";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export function renderFileEditDiff(diff: FileEditDiff): string {
  const header = `${muted("•")} ${bold(fg(palette.editHeader, renderEditVerb(diff)))} ${foreground(renderEditTarget(diff))} ${success(`(+${diff.added}`)} ${danger(`-${diff.removed})`)}`;
  const lines = diff.changes
    ? diff.changes.map((change) => renderDiffChange(change))
    : (diff.lines ?? [])
      .filter((line) => line.startsWith("+") || line.startsWith("-"))
      .map((line) => renderDiffLine(line));
  if (diff.truncated) {
    const detail =
      typeof diff.shownChanges === "number" && typeof diff.totalChanges === "number"
        ? ` (showing ${diff.shownChanges} of ${diff.totalChanges} changed lines)`
        : "";
    lines.push(muted(`... diff truncated${detail}`));
  }
  return [header, ...lines].join("\n");
}

function renderEditVerb(diff: FileEditDiff): string {
  if (diff.kind === "add") {
    return "Added";
  }
  if (diff.kind === "delete") {
    return "Deleted";
  }
  if (diff.kind === "move") {
    return "Moved";
  }
  return "Edited";
}

function renderEditTarget(diff: FileEditDiff): string {
  if (diff.kind === "move" && diff.sourcePath) {
    return `${diff.sourcePath} → ${diff.path}`;
  }
  return diff.path;
}

function renderDiffChange(change: FileEditChange): string {
  const lineNumber = change.type === "add" ? change.newLine : change.oldLine;
  const number = `${lineNumber ?? ""}`.padStart(4, " ");
  const content = change.text.length > 0 ? change.text : " ";
  if (change.type === "add") {
    return bg(
      palette.diffAddBg,
      `${muted(number)} ${success("+ ")}${fg(palette.successMuted, padDiffContent(content))}`,
    );
  }
  return bg(
    palette.diffRemoveBg,
    `${muted(number)} ${danger("- ")}${fg(palette.dangerMuted, padDiffContent(content))}`,
  );
}

function renderDiffLine(line: string): string {
  const marker = line.slice(0, 1);
  const content = line.slice(1);
  const padded = content.length > 0 ? content : " ";
  if (line.startsWith("@@")) {
    return muted(`    ${line}`);
  }
  if (line.startsWith("+")) {
    return bg(palette.diffAddBg, `${success(" + ")}${fg(palette.successMuted, padDiffContent(padded))}`);
  }
  if (line.startsWith("-")) {
    return bg(palette.diffRemoveBg, `${danger(" - ")}${fg(palette.dangerMuted, padDiffContent(padded))}`);
  }
  return muted(`   ${marker === " " ? " " : ""}${content}`);
}

function padDiffContent(value: string): string {
  const minWidth = 72;
  return value.length >= minWidth ? value : value.padEnd(minWidth, " ");
}

export function renderCommand(command: string): string {
  return `${accent("$")} ${foreground(command)}`;
}

export function renderCommandOutput(status: string, preview: string): string {
  if (status === "ok") {
    return muted(preview);
  }
  return danger(preview);
}

export function renderPrompt(): string {
  return bold(accent("✦  "));
}

export function renderContinuationPrompt(): string {
  return muted("·  ");
}

export function renderInput(value: string): string {
  return renderInlineAttachments(value);
}

export function renderInputRule(width: number = process.stdout.columns ?? 80): string {
  return muted("─".repeat(Math.max(12, width)));
}

export function renderError(message: string): string {
  return `${danger("[error]")} ${message}`;
}

export function renderMuted(message: string): string {
  return muted(message);
}

export function renderAccent(message: string): string {
  return accent(message);
}

export function renderFooterStatus(parts: string[]): string {
  return muted(parts.filter(Boolean).join(" · "));
}

export function renderQueuedMessage(message: string): string {
  const preview = message.replace(/\s+/g, " ").trim();
  const clipped = preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;
  return `${muted("Steering:")} ${foreground(clipped)}`;
}

export function renderQueueHint(): string {
  return muted("↳ option+up to edit queued messages");
}

export function renderThinkingLabel(): string {
  return italic(fg(palette.thinkingLabel, "Thinking:"));
}

export function renderThinkingText(message: string): string {
  return fg(palette.thinkingText, message);
}


function isLightTerminal(): boolean {
  const theme = process.env.CHUMP_THEME?.toLowerCase();
  if (theme === "light") return true;
  if (theme === "dark") return false;

  // COLORFGBG is set by some terminals (e.g. konsole, iTerm2)
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const background = Number(colorFgBg.split(";").at(-1));
    if (Number.isFinite(background)) {
      return background >= 7 && background <= 15;
    }
  }

  // OSC 11 query: ask the terminal for its background color synchronously.
  // Only attempt when stdin/stdout are both TTYs (interactive terminal).
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;

  try {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    // Send OSC 11 query: ESC ] 11 ; ? ESC \
    process.stdout.write("\x1b]11;?\x1b\\");

    // Read response bytes synchronously. Open /dev/tty as a fresh fd so we can
    // use O_NONBLOCK without disturbing the process stdin fd.
    const ttyFd = fs.openSync("/dev/tty", fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const buf = Buffer.alloc(64);
    let response = "";
    const deadline = Date.now() + 100;
    try {
      while (Date.now() < deadline) {
        let n = 0;
        try {
          n = fs.readSync(ttyFd, buf, 0, buf.length, null);
        } catch (e: unknown) {
          // EAGAIN (no data yet) — spin until deadline
          if ((e as NodeJS.ErrnoException).code === "EAGAIN") continue;
          break;
        }
        if (n > 0) {
          response += buf.toString("ascii", 0, n);
          if (response.includes("\x07") || response.includes("\x1b\\")) break;
        }
      }
    } finally {
      fs.closeSync(ttyFd);
    }

    process.stdin.setRawMode(wasRaw);

    // Parse rgb:RRRR/GGGG/BBBB (16-bit components)
    const match = /rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)/.exec(response);
    if (match) {
      const r = Number.parseInt(match[1], 16);
      const g = Number.parseInt(match[2], 16);
      const b = Number.parseInt(match[3], 16);
      // Scale to 8-bit if needed (16-bit components are 4 hex digits)
      const scale = match[1].length > 2 ? 257 : 1;
      const luminance = (0.299 * (r / scale) + 0.587 * (g / scale) + 0.114 * (b / scale)) / 255;
      return luminance > 0.5;
    }
  } catch {
    // If anything fails, fall back to dark
  }

  return false;
}

export function renderThinkingStatus(message: string): string {
  return `${renderThinkingLabel()} ${renderThinkingText(message)}`;
}

export function renderThinkingBlock(
  title: string | null,
  message: string,
): string[] {
  const lines: string[] = [];
  const heading = title?.trim();
  if (heading) {
    lines.push(`${renderThinkingLabel()} ${bold(fg(palette.thinkingTitle, heading))}`);
  } else {
    lines.push(renderThinkingLabel());
  }

  const content = message.trim();
  if (content) {
    // Strip markdown to plain text, then word-wrap and apply uniform thinking colour.
    const wrapWidth = Math.max(24, (process.stdout.columns ?? 80) - 4);
    const plainLines = renderMarkdownBlock(content).split("\n").map(stripAnsi);
    lines.push("");
    for (const plainLine of plainLines) {
      if (plainLine.length > wrapWidth) {
        const subWrapped = wrapPlainText(plainLine, wrapWidth);
        lines.push(...subWrapped.map((l) => `${muted("│")} ${renderThinkingText(l)}`));
      } else {
        lines.push(`${muted("│")} ${renderThinkingText(plainLine)}`);
      }
    }
  }

  return lines;
}

export function renderSlashCommandMenu(
  items: Array<{
    label: string;
    description: string;
    kind?: "model" | "session" | "skill" | "command";
    columns?: {
      updated: string;
      created: string;
      conversation: string;
    };
  }>,
  selectedIndex: number,
  meta: {
    hiddenAbove: number;
    hiddenBelow: number;
  } = { hiddenAbove: 0, hiddenBelow: 0 },
): string[] {
  // Use the full terminal width so the menu spans the screen and individual
  // rows never soft-wrap to empty-padded second rows between items.
  const terminalCols = process.stdout.columns ?? 80;
  const width = Math.max(20, terminalCols - 1);
  const hasModelItems = items.some((item) => item.kind === "model");
  const commandWidth = Math.max(
    12,
    Math.min(
      hasModelItems ? Math.max(28, width - 18) : 18,
      items.reduce((max, item) => Math.max(max, item.label.length), 0) + 2,
    ),
  );

  const lines: string[] = [];
  const hasSessionColumns = items.some((item) => item.columns);
  if (hasSessionColumns) {
    lines.push(renderSessionMenuHeader(width));
  }

  if (meta.hiddenAbove > 0) {
    lines.push(muted(`  ${meta.hiddenAbove} more`));
  }

  lines.push(...items.map((item, index) =>
    item.columns
      ? renderSessionMenuItem(item.columns, index === selectedIndex, width)
      : renderSlashCommandMenuItem(item.label, item.description, index === selectedIndex, width, commandWidth)
  ));

  if (meta.hiddenBelow > 0) {
    lines.push(muted(`  ${meta.hiddenBelow} more`));
  }

  return lines;
}

function renderSessionMenuHeader(width: number): string {
  const raw = `${"Updated".padEnd(18, " ")}${"Created".padEnd(18, " ")}Conversation`;
  return muted(raw.length > width ? raw.slice(0, width) : raw.padEnd(width, " "));
}

function renderSessionMenuItem(
  session: {
    updated: string;
    created: string;
    conversation: string;
  },
  selected: boolean,
  width: number,
): string {
  const updated = session.updated.padEnd(18, " ");
  const created = session.created.padEnd(18, " ");
  const titleWidth = Math.max(12, width - 36);
  const conversation = clipPlain(session.conversation, titleWidth).padEnd(titleWidth, " ");
  const raw = `${updated}${created}${conversation}`;
  if (!selected) {
    return `${muted(updated)}${muted(created)}${foreground(conversation)}`;
  }
  return bg(palette.selectedBg, `${bold(accent(updated))}${bold(foreground(created))}${bold(foreground(raw.slice(36)))}`);
}

function renderSlashCommandMenuItem(
  command: string,
  description: string,
  selected: boolean,
  width: number,
  commandWidth: number,
): string {
  const gap = "    ";
  const commandText = clipPlain(command, commandWidth).padEnd(commandWidth, " ");
  const descriptionWidth = Math.max(0, width - commandWidth - gap.length);
  const descriptionText = clipPlain(description, descriptionWidth).padEnd(descriptionWidth, " ");
  const clipped = `${commandText}${gap}${descriptionText}`;
  if (!selected) {
    return `${foreground(commandText)}${muted(gap)}${muted(descriptionText)}`;
  }

  const commandPart = clipped.slice(0, commandWidth);
  const gapPart = clipped.slice(commandWidth, commandWidth + gap.length);
  const descriptionPart = clipped.slice(commandWidth + gap.length);
  return bg(
    palette.selectedBg,
    `${bold(accent(commandPart))}${muted(gapPart)}${bold(foreground(descriptionPart))}`,
  );
}

function clipPlain(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  if (width <= 3) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 3).trimEnd()}...`;
}

export function renderUserMessage(message: string): string {
  const lines = message.split("\n");
  const [firstLine = "", ...rest] = lines;
  const head = `${accent("※")} ${renderInlineAttachments(firstLine)}`;
  const tail = rest.map((line) => `${muted("╎")} ${renderInlineAttachments(line)}`);
  return ["", head, ...tail, ""].join("\n");
}

export function renderSteeringMessage(message: string): string {
  const preview = message.replace(/\s+/g, " ").trim();
  const [firstLine = "", ...rest] = preview.split("\n");
  const head = `${muted("Steering:")} ${renderInlineAttachments(firstLine)}`;
  const tail = rest.map((line) => `${muted("↳")} ${renderInlineAttachments(line)}`);
  return ["", head, ...tail, ""].join("\n");
}

function renderInlineAttachments(value: string): string {
  const pattern = /\[(?:Image \d+: [^\]]+|Pasted ~\d+ lines)\]/g;
  let rendered = "";
  let index = 0;

  for (const match of value.matchAll(pattern)) {
    rendered += foreground(value.slice(index, match.index));
    rendered += accent(match[0]);
    index = match.index + match[0].length;
  }

  rendered += foreground(value.slice(index));
  return rendered;
}

function wrapPlainText(value: string, width: number): string[] {
  if (!value) {
    return [];
  }

  const result: string[] = [];
  for (const sourceLine of value.split("\n")) {
    const words = sourceLine.split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      result.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
        continue;
      }
      if ((current.length + 1 + word.length) <= width) {
        current = `${current} ${word}`;
        continue;
      }
      result.push(current);
      current = word;
    }
    if (current) {
      result.push(current);
    }
  }

  return result;
}
