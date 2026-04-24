import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ChumpConfig } from "./types.ts";

export function loadConfig(
  overrides: Partial<Pick<ChumpConfig, "serverUrl" | "serverSource">> = {},
): ChumpConfig {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const sessionId =
    process.env.CHUMP_SESSION_ID ??
    process.env.CHUMP_AGENT_ID ??
    createSessionId(workspaceRoot);

  return {
    agentId: sessionId,
    serverUrl:
      overrides.serverUrl ??
      process.env.CHUMP_SERVER_URL ??
      "http://127.0.0.1:8080",
    serverSource: overrides.serverSource ?? "direct",
    workspaceRoot,
  };
}

export function renderBanner(config: ChumpConfig): string {
  const sourceLabel = config.serverSource === "managed" ? "managed" : "direct";
  return [
    "chump",
    `session: ${config.agentId}`,
    `server: ${config.serverUrl} (${sourceLabel})`,
    `workspace: ${config.workspaceRoot.replace(os.homedir(), "~")}`,
    "",
    "Live chat, tool activity, status, state, and clear commands are enabled.",
    "Type /help for commands, /session new for a fresh session, or /quit to exit.",
  ].join("\n");
}

export function createSessionId(workspaceRoot: string): string {
  const workspaceName = sanitizeSegment(path.basename(workspaceRoot) || "workspace");
  const stamp = Date.now().toString(36);
  const suffix = randomUUID().slice(0, 8);
  return `${workspaceName}-${stamp}-${suffix}`;
}

export function resolveWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function sanitizeSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "workspace";
}
