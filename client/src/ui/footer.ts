import type { ChumpConfig, ShareStatus } from "../core/types.ts";

type FooterStatus = {
  provider: string;
  model: string;
  reasoning: Record<string, unknown> | null;
  git_branch?: string;
};

const REASONING_BUDGET_LABELS = new Map<number, string>([
  [512, "minimal"],
  [1024, "low"],
  [4096, "medium"],
  [8192, "high"],
  [16384, "xhigh"],
]);

export function renderSessionFooter(
  config: Pick<ChumpConfig, "workspaceRoot" | "serverSource">,
  status: FooterStatus,
  share: ShareStatus | null,
): string {
  const location = status.git_branch
    ? `${formatFooterWorkspace(config.workspaceRoot)} (${status.git_branch})`
    : formatFooterWorkspace(config.workspaceRoot);
  const reasoning = renderFooterReasoning(status.provider, status.reasoning);
  const metadata = [
    `${status.provider}/${status.model}`,
    `thinking ${reasoning}`,
    share ? "shared" : "",
    config.serverSource === "direct" ? "remote" : "",
  ].filter(Boolean).join(" · ");
  return `${location}\n${metadata}`;
}

function formatFooterWorkspace(workspaceRoot: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    return workspaceRoot;
  }
  if (workspaceRoot === home) {
    return "~";
  }
  if (
    workspaceRoot.startsWith(`${home}/`) ||
    workspaceRoot.startsWith(`${home}\\`)
  ) {
    return `~${workspaceRoot.slice(home.length)}`;
  }
  return workspaceRoot;
}

function renderFooterReasoning(
  provider: string,
  reasoning: Record<string, unknown> | null,
): string {
  if (!reasoning) {
    return provider === "chump_cloud" ? "auto" : "off";
  }
  const parts = [
    typeof reasoning.effort === "string" ? reasoning.effort : null,
    typeof reasoning.budget === "number"
      ? REASONING_BUDGET_LABELS.get(reasoning.budget) ?? `${reasoning.budget} tok`
      : null,
  ].filter(Boolean);
  return parts.join(" ") || "off";
}
