import { writeOutput } from "./terminal.ts";

const STYLE_RESET = "\x1b[0m";

const palette = {
  accent: "#b8dd35",
  accentStrong: "#96bf00",
  foreground: "#b8b8b8",
  foregroundStrong: "#d0d0d0",
  muted: "#8a8a8a",
  danger: "#ff6b6b",
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

  function flushLine(line: string, includeNewline: boolean): void {
    const rendered = renderMarkdownLine(line, inCodeBlock);
    writeOutput(includeNewline ? `${rendered}\n` : rendered);

    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    }
  }

  return {
    write(chunk: string) {
      buffer += chunk;

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        flushLine(line, true);
      }
    },
    end() {
      if (buffer.length > 0) {
        flushLine(buffer, true);
        buffer = "";
      }
    },
  };
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
  return foreground(value);
}

export function renderError(message: string): string {
  return `${danger("[error]")} ${message}`;
}

export function renderMuted(message: string): string {
  return muted(message);
}

export function renderFooterStatus(parts: string[]): string {
  return muted(parts.filter(Boolean).join(" · "));
}

export function renderQueuedMessage(message: string): string {
  const preview = message.replace(/\s+/g, " ").trim();
  const clipped = preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;
  return muted(`queued: ${clipped}`);
}

export function renderUserMessage(message: string): string {
  const lines = message.split("\n");
  const [firstLine = "", ...rest] = lines;
  const head = `${accent("※")} ${foreground(firstLine)}`;
  const tail = rest.map((line) => `${muted("╎")} ${foreground(line)}`);
  return ["", head, ...tail, ""].join("\n");
}
