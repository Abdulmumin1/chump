import { writeOutput } from "./terminal.ts";

const STYLE_RESET = "\x1b[0m";

const palette = {
  accent: "#b8dd35",
  accentStrong: "#96bf00",
  foreground: "#b8b8b8",
  foregroundStrong: "#d0d0d0",
  muted: "#8a8a8a",
  thinkingLabel: "#93a65a",
  thinkingText: "#737373",
  danger: "#ff6b6b",
  dangerMuted: "#b56b63",
  successMuted: "#8fad33",
  editHeader: "#c5c5c5",
};

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
  return fg(palette.muted, value);
}

function danger(value: string): string {
  return fg(palette.danger, value);
}

function foreground(value: string): string {
  return fg(palette.foreground, value);
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

  if (inCodeBlock || trimmedStart.startsWith("```")) {
    return accent(line);
  }

  const heading = /^(#{1,6})\s+(.+)$/.exec(trimmedStart);
  if (heading) {
    return `${indent}${bold(fg(palette.foregroundStrong, heading[2]))}`;
  }

  const bullet = /^([-*+])\s+(.+)$/.exec(trimmedStart);
  if (bullet) {
    return `${indent}${muted("•")} ${renderInlineMarkdown(bullet[2])}`;
  }

  const numbered = /^(\d+)\.\s+(.+)$/.exec(trimmedStart);
  if (numbered) {
    return `${indent}${muted(`${numbered[1]}.`)} ${renderInlineMarkdown(numbered[2])}`;
  }

  const quote = /^>\s?(.+)$/.exec(trimmedStart);
  if (quote) {
    return `${indent}${muted("│")} ${muted(stripAnsi(renderInlineMarkdown(quote[1])))}`;
  }

  return renderInlineMarkdown(line);
}

function renderInlineMarkdown(value: string): string {
  const pattern =
    /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let rendered = "";
  let index = 0;

  for (const match of value.matchAll(pattern)) {
    rendered += foreground(value.slice(index, match.index));

    if (match[1]) {
      rendered += accent(match[1]);
    } else if (match[2]) {
      rendered += bold(fg(palette.foregroundStrong, match[2]));
    } else if (match[3]) {
      rendered += italic(foreground(match[3]));
    } else if (match[4] && match[5]) {
      rendered += `${underline(foreground(match[4]))} ${muted(match[5])}`;
    }

    index = match.index + match[0].length;
  }

  rendered += foreground(value.slice(index));
  return rendered;
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
      "#26330f",
      `${muted(number)} ${success("+ ")}${fg(palette.successMuted, padDiffContent(content))}`,
    );
  }
  return bg(
    "#3a1f1c",
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
    return bg("#26330f", `${success(" + ")}${fg(palette.successMuted, padDiffContent(padded))}`);
  }
  if (line.startsWith("-")) {
    return bg("#3a1f1c", `${danger(" - ")}${fg(palette.dangerMuted, padDiffContent(padded))}`);
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
    lines.push(`${renderThinkingLabel()} ${bold(fg("#c79b67", heading))}`);
  } else {
    lines.push(renderThinkingLabel());
  }

  const wrapped = wrapPlainText(message.trim(), Math.max(24, (process.stdout.columns ?? 80) - 4));
  if (wrapped.length > 0) {
    lines.push("");
    lines.push(...wrapped.map((line) => `${muted("│")} ${renderThinkingText(line)}`));
  }

  return lines;
}

export function renderSlashCommandMenu(
  items: Array<{
    label: string;
    description: string;
    kind?: "model" | "session" | "command";
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
  const width = Math.max(48, Math.min(process.stdout.columns ?? 80, 96));
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
  return bg("#494d54", `${bold(accent(updated))}${bold(foreground(created))}${bold(foreground(raw.slice(36)))}`);
}

function renderSlashCommandMenuItem(
  command: string,
  description: string,
  selected: boolean,
  width: number,
  commandWidth: number,
): string {
  const gap = "  ";
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
    "#494d54",
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
