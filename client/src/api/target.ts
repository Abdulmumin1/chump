import type { ChumpConfig } from "../core/types.ts";

export function buildProjectUrl(config: ChumpConfig, path: string): string {
  if (config.apiTarget.kind === "direct") {
    return `${config.serverUrl}${path}`;
  }
  return `${config.serverUrl}/projects/${encodeURIComponent(config.apiTarget.projectId)}${path}`;
}

export function buildAgentUrl(config: ChumpConfig): string {
  if (config.apiTarget.kind === "direct") {
    return `${config.serverUrl}/agent/${encodeURIComponent(config.agentId)}`;
  }
  return `${config.serverUrl}/projects/${
    encodeURIComponent(config.apiTarget.projectId)
  }/sessions/${encodeURIComponent(config.agentId)}`;
}

export function targetHeaders(
  config: ChumpConfig,
  headers: Record<string, string> = {},
): Record<string, string> {
  if (config.apiTarget.kind === "direct") return headers;
  return {
    ...headers,
    authorization: `Bearer ${config.apiTarget.token}`,
  };
}
