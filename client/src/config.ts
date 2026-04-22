import os from "node:os";
import path from "node:path";

import type { ChumpConfig } from "./types.ts";

export function loadConfig(): ChumpConfig {
  const workspaceRoot = process.cwd();
  const defaultAgentId = path.basename(workspaceRoot) || "default";

  return {
    agentId: process.env.CHUMP_AGENT_ID ?? defaultAgentId,
    serverUrl: process.env.CHUMP_SERVER_URL ?? "http://127.0.0.1:8080",
    workspaceRoot,
  };
}

export function renderBanner(config: ChumpConfig): string {
  return [
    "chump",
    `agent: ${config.agentId}`,
    `server: ${config.serverUrl}`,
    `workspace: ${config.workspaceRoot.replace(os.homedir(), "~")}`,
    "",
    "Live chat, status, state, clear, and event-stream wiring are enabled.",
    "Type /help for commands or /quit to exit.",
  ].join("\n");
}
