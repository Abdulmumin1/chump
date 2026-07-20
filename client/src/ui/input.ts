import type { Interface } from "node:readline/promises";
import { stdin as input } from "node:process";

import type {
  ChatAttachment,
  FileSearchResult,
  PromptSubmission,
  SessionSummary,
  SlashCommandMenuContext,
} from "../core/types.ts";
import { normalizePastedText } from "./attachments.ts";
import type { StatusDisplay } from "./status.ts";
import { createPiPromptReader } from "./tui/shell.ts";

export { attachmentsForDraft } from "./tui/editor.ts";

export type PromptReader = {
  read: () => Promise<PromptSubmission | null>;
  close: () => void;
  popQueuedDisplay: () => void;
  removeQueuedDisplay: (content: string) => void;
  setQueuedDisplay: (submissions: PromptSubmission[]) => void;
  setQueuedLinePopHandler: (handler: (() => void) | null) => void;
  setModelSuggestions: (models: SlashCommandMenuContext["models"]) => void;
  setSkillSuggestions: (skills: SlashCommandMenuContext["skills"]) => void;
  setAbortHandler: (handler: (() => void) | null) => void;
  setSessionSuggestions: (sessions: SessionSummary[]) => void;
  setStatus: (status: StatusDisplay) => void;
  setFooter: (footer: string | null) => void;
  setRuleBadge: (badge: string | null) => void;
  setFileSearch: (
    search: ((query: string) => Promise<FileSearchResult[]>) | null,
  ) => void;
};

export async function readPrompt(
  fallbackRl: Interface | null,
): Promise<string | null> {
  if (input.isTTY) {
    const reader = createPiPromptReader();
    try {
      return (await reader.read())?.text ?? null;
    } finally {
      reader.close();
    }
  }
  try {
    return await (fallbackRl?.question("✦  ") ?? null);
  } catch (error) {
    if (error instanceof Error && error.message === "readline was closed") {
      return null;
    }
    throw error;
  }
}

export function createPromptReader(
  fallbackRl: Interface | null,
): PromptReader {
  if (input.isTTY) {
    return createPiPromptReader();
  }
  return createFallbackPromptReader(fallbackRl);
}

function createFallbackPromptReader(fallbackRl: Interface | null): PromptReader {
  return {
    read: async () => {
      const text = await readPrompt(fallbackRl);
      return text === null ? null : buildSubmission(text, []);
    },
    close: () => fallbackRl?.close(),
    popQueuedDisplay: () => {},
    removeQueuedDisplay: () => {},
    setQueuedDisplay: () => {},
    setQueuedLinePopHandler: () => {},
    setModelSuggestions: () => {},
    setSkillSuggestions: () => {},
    setAbortHandler: () => {},
    setSessionSuggestions: () => {},
    setStatus: () => {},
    setFooter: () => {},
    setRuleBadge: () => {},
    setFileSearch: () => {},
  };
}

function buildSubmission(
  text: string,
  attachments: ChatAttachment[],
): PromptSubmission {
  let cleanText = text;
  for (const attachment of attachments) {
    if (attachment.type === "text") {
      cleanText = cleanText.replace(attachment.label, attachment.text);
    }
  }
  return {
    text: cleanText.replace(/[ \t]+\n/g, "\n").replace(/\s+$/u, ""),
    attachments: [...attachments],
  };
}

export function isLikelyRawPaste(value: string): boolean {
  const normalized = normalizePastedText(value);
  const trimmed = normalized.trim();
  const withoutSingleTrailingNewline = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;
  if (trimmed.length > 0 && withoutSingleTrailingNewline.includes("\n")) {
    return true;
  }
  return /\.(?:png|jpe?g|webp|gif)(?:["']?\s*)$/iu.test(trimmed);
}
