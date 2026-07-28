import {
  renderCommand,
  renderCommandOutput,
} from "./render.ts";

const COLLAPSED_COMMAND_ROWS = 5;
const COLLAPSED_OUTPUT_LINES = 5;

export type CommandActivity = {
  command: string;
  status: string;
  preview: string;
  displayOutput: string | null;
};

export function renderCommandActivityLines(
  activity: CommandActivity,
  columns: number,
  expanded: boolean,
): string[] {
  const outputExpanded = expanded && activity.displayOutput !== null;
  const output = activity.displayOutput ?? activity.preview;
  const formattedOutput = formatCommandOutput(
    output,
    outputExpanded ? Number.POSITIVE_INFINITY : commandOutputPreviewLimit(columns),
    outputExpanded ? Number.POSITIVE_INFINITY : COLLAPSED_OUTPUT_LINES,
    {
      interactive: true,
      canExpand: activity.displayOutput !== null,
      expanded: outputExpanded,
    },
  );
  const command = renderCommand(
    activity.command,
    columns,
    expanded ? Number.POSITIVE_INFINITY : COLLAPSED_COMMAND_ROWS,
  );
  const renderedOutput = renderCommandOutput(
    activity.status,
    formattedOutput,
    columns,
  );
  return ["", ...command.split("\n"), ...renderedOutput.split("\n")];
}

export function formatCommandOutput(
  value: string,
  limit: number,
  maxLines: number,
  options: {
    interactive: boolean;
    canExpand: boolean;
    expanded: boolean;
  } = { interactive: false, canExpand: false, expanded: false },
): string {
  const normalized = value.replace(/\r\n?/gu, "\n");
  let rawLines = normalized.split("\n");
  let serverTruncatedCount = 0;
  let serverTruncatedBytes = 0;
  let serverOutputTruncated = false;

  if (rawLines[0]?.startsWith("...[command output truncated")) {
    const noticeLine = rawLines.shift() ?? "";
    serverOutputTruncated = true;
    if (rawLines[0] === "") {
      rawLines.shift();
    }
    const match = /showing last (\d+) of (\d+) lines/u.exec(noticeLine);
    if (match) {
      const shown = Number.parseInt(match[1] ?? "0", 10);
      const total = Number.parseInt(match[2] ?? "0", 10);
      serverTruncatedCount = Math.max(0, total - shown);
    }
    const byteMatch = /showing last (\d+) of (\d+) bytes/u.exec(noticeLine);
    if (byteMatch) {
      const shown = Number.parseInt(byteMatch[1] ?? "0", 10);
      const total = Number.parseInt(byteMatch[2] ?? "0", 10);
      serverTruncatedBytes = Math.max(0, total - shown);
    }
  }

  const previewTruncated = rawLines.at(-1)?.trim() === "...[truncated]";
  if (previewTruncated) {
    rawLines.pop();
  }

  const lines = rawLines.map((line) => {
    const cleaned = stripHtmlSpans(line);
    const lineMatch = /^(\d+):\s?(.*)/u.exec(cleaned);
    if (!lineMatch) {
      return cleaned;
    }
    const lineNumber = lineMatch[1] ?? "";
    const content = lineMatch[2] ?? "";
    return content ? `${lineNumber}  ${content}` : lineNumber;
  });

  const localTruncatedCount = Math.max(0, lines.length - maxLines);
  let visibleLines = lines.slice(0, maxLines);
  const joinedVisible = visibleLines.join("\n");
  let characterTruncated = false;
  if (joinedVisible.length > limit) {
    characterTruncated = true;
    const suffix = options.interactive && options.canExpand && !options.expanded
      ? " ...[truncated] (ctrl+o to expand)"
      : " ...[truncated]";
    visibleLines = [
      `${joinedVisible.slice(0, Math.max(0, limit - suffix.length))}${suffix}`,
    ];
  }

  if (!options.interactive) {
    if (characterTruncated) {
      return visibleLines.join("\n");
    }
    const truncatedCount = localTruncatedCount + serverTruncatedCount;
    if (truncatedCount > 0) {
      visibleLines.push("");
      visibleLines.push(
        `... +${truncatedCount.toLocaleString()} lines truncated`,
      );
    }
    return visibleLines.join("\n");
  }

  if (!characterTruncated && localTruncatedCount > 0) {
    visibleLines.push("");
    visibleLines.push(
      options.canExpand && !options.expanded
        ? `... +${localTruncatedCount.toLocaleString()} lines hidden (ctrl+o to expand)`
        : `... +${localTruncatedCount.toLocaleString()} lines hidden`,
    );
  }
  if (serverTruncatedCount > 0) {
    visibleLines.push("");
    visibleLines.push(
      `... +${serverTruncatedCount.toLocaleString()} lines unavailable (server limit)`,
    );
  }
  if (serverTruncatedBytes > 0) {
    visibleLines.push("");
    visibleLines.push(
      `... +${serverTruncatedBytes.toLocaleString()} bytes unavailable (server limit)`,
    );
  }
  if (
    serverOutputTruncated &&
    serverTruncatedCount === 0 &&
    serverTruncatedBytes === 0
  ) {
    visibleLines.push("");
    visibleLines.push("... earlier output unavailable (server limit)");
  }
  if (previewTruncated && !options.canExpand) {
    visibleLines.push("");
    visibleLines.push("... additional output unavailable");
  }
  return visibleLines.join("\n");
}

function stripHtmlSpans(value: string): string {
  return value.replace(/<\/?span\b[^>]*>/giu, "");
}

function commandOutputPreviewLimit(columns: number): number {
  const treeIndentWidth = 5;
  return Math.max(240, Math.min(1200, (columns - treeIndentWidth) * 5));
}
