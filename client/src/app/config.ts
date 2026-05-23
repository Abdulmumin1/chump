import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ChumpConfig } from "../core/types.ts";
import { globalAuthFilePath } from "./auth.ts";

export interface ResolvedConfig {
  provider: string;
  model: string;
  max_steps: number;
  command_timeout: number;
  reasoning_effort?: string;
  reasoning_budget?: number;
  theme?: string;
  serverUrl?: string;
  port?: number;
}

export function globalConfigDir(): string {
  if (process.env.CHUMP_AGENT_DIR) {
    return path.resolve(process.env.CHUMP_AGENT_DIR);
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "chump");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "chump");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      "chump",
    );
  }
  return path.join(os.homedir(), ".chump");
}

export function globalConfigFilePath(): string {
  return process.env.CHUMP_CONFIG_FILE ?? path.join(globalConfigDir(), "config.json");
}

function loadJsonConfig(filePath: string): any {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function getResolvedConfig(workspaceRoot: string): ResolvedConfig {
  const globalConfig = loadJsonConfig(globalConfigFilePath());
  const localConfig = loadJsonConfig(path.join(workspaceRoot, ".chump", "config.json"));
  const authConfig = loadJsonConfig(globalAuthFilePath());

  const provider =
    process.env.CHUMP_PROVIDER ??
    localConfig.provider ??
    globalConfig.provider ??
    authConfig.provider ??
    "chump_cloud";

  const envModel = process.env.CHUMP_MODEL;
  const configModel =
    localConfig.model ??
    globalConfig.model ??
    authConfig.model;

  const DEFAULT_MODELS: Record<string, string> = {
    codex: "gpt-5.4",
    openai: "gpt-5.4",
    chump_cloud: "deepseek-v4-flash",
    google: "gemini-3.5-flash",
    anthropic: "claude-sonnet-4-20250514",
    workers_ai: "@cf/moonshotai/kimi-k2.5",
    deepseek: "deepseek-v4-pro",
  };

  const model = envModel ?? configModel ?? DEFAULT_MODELS[provider] ?? "deepseek-v4-flash";

  const maxStepsRaw =
    process.env.CHUMP_MAX_STEPS ??
    localConfig.max_steps ??
    globalConfig.max_steps;
  const max_steps = maxStepsRaw !== undefined ? Number(maxStepsRaw) : 64;

  const commandTimeoutRaw =
    process.env.CHUMP_COMMAND_TIMEOUT ??
    localConfig.command_timeout ??
    globalConfig.command_timeout;
  const command_timeout = commandTimeoutRaw !== undefined ? Number(commandTimeoutRaw) : 120;

  let reasoning_effort: string | undefined;
  let reasoning_budget: number | undefined;

  const effort = process.env.CHUMP_REASONING_EFFORT;
  const budget = process.env.CHUMP_REASONING_BUDGET;

  const configuredReasoning =
    localConfig.reasoning ??
    globalConfig.reasoning ??
    authConfig.reasoning;

  if (effort) {
    reasoning_effort = effort;
  }
  if (budget) {
    reasoning_budget = Number(budget);
  }
  if (!reasoning_effort && !reasoning_budget && configuredReasoning && typeof configuredReasoning === "object") {
    if (typeof configuredReasoning.effort === "string") {
      reasoning_effort = configuredReasoning.effort;
    }
    if (configuredReasoning.budget !== undefined) {
      reasoning_budget = Number(configuredReasoning.budget);
    }
  }

  const theme =
    process.env.CHUMP_THEME ??
    localConfig.theme ??
    globalConfig.theme;

  if (theme && !process.env.CHUMP_THEME) {
    process.env.CHUMP_THEME = String(theme);
  }

  const serverUrl =
    localConfig.serverUrl ??
    localConfig.server_url ??
    globalConfig.serverUrl ??
    globalConfig.server_url;

  const portRaw =
    process.env.CHUMP_PORT ??
    localConfig.port ??
    globalConfig.port;
  const port = portRaw !== undefined ? Number(portRaw) : undefined;

  return {
    provider,
    model,
    max_steps,
    command_timeout,
    reasoning_effort,
    reasoning_budget,
    theme,
    serverUrl,
    port,
  };
}

export function loadConfig(
  overrides: Partial<Pick<ChumpConfig, "agentId" | "serverUrl" | "serverSource">> = {},
): ChumpConfig {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const sessionId =
    overrides.agentId ??
    process.env.CHUMP_SESSION_ID ??
    process.env.CHUMP_AGENT_ID ??
    createSessionId(workspaceRoot);

  const resolved = getResolvedConfig(workspaceRoot);

  return {
    agentId: sessionId,
    serverUrl:
      overrides.serverUrl ??
      process.env.CHUMP_SERVER_URL ??
      resolved.serverUrl ??
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
    "Live chat, tool activity, sessions, share, and clear commands are enabled.",
    "Type /help for commands, /new for a fresh session, or /quit to exit.",
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
