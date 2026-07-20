import { LiveReasoningTokenCounter } from "./reasoning.ts";
import {
  renderAccent,
  renderDanger,
  renderMuted,
  renderThinkingActivity,
} from "./render.ts";
import { createSpinner } from "./spinner.ts";
import type { StatusDisplay } from "./status.ts";
import { readToolIdentity } from "./tool-activity.ts";

const MAX_VISIBLE_TOOL_ROWS = 4;

type ToolState = "running" | "completed" | "failed" | "aborting";

type ToolActivity = {
  preview: string;
  state: ToolState;
};

export type ActivityStatusController = {
  start: () => void;
  stop: () => void;
  showAborting: () => void;
  beginTextStreaming: () => void;
  noteToolActivity: (
    preview: string,
    payload?: Record<string, unknown>,
  ) => void;
  noteToolCallPreview: (
    preview: string | null,
    payload?: Record<string, unknown>,
  ) => void;
  noteToolResult: (payload?: Record<string, unknown>) => void;
  noteReasoningActivity: (payload: Record<string, unknown>) => void;
};

export function createActivityStatusController(
  setStatus: (status: StatusDisplay) => void,
  options: { label?: string } = {},
): ActivityStatusController {
  const label = options.label ?? "Transmogrifying";
  const tools = new Map<string, ToolActivity>();
  let active = false;
  let aborting = false;
  let spinnerFrame: string | null = null;
  let activityPreview: string | null = null;
  let reasoningTokenEstimate = 0;
  const reasoningTokens = new LiveReasoningTokenCounter();

  const spinner = createSpinner((frame) => {
    spinnerFrame = frame;
    syncStatus();
  }, {
    label,
    renderLabel: () => renderSpinnerLabel(tools, activityPreview, label),
  });

  function syncStatus(): void {
    if (!active) {
      setStatus(null);
      return;
    }

    if (tools.size > 0 && countRunningTools(tools) > 0) {
      setStatus([
        spinnerFrame ?? renderMuted(toolSummary(tools)),
        ...renderToolRows(tools),
      ]);
      return;
    }

    if (aborting) {
      setStatus(renderMuted("Aborting..."));
      return;
    }

    setStatus(spinnerFrame ?? activityPreview ?? renderMuted(label));
  }

  function upsertTool(
    preview: string | null,
    payload?: Record<string, unknown>,
  ): boolean {
    if (!preview || !payload) {
      return false;
    }
    const identity = readToolIdentity(payload);
    if (!identity) {
      return false;
    }
    const current = tools.get(identity);
    tools.set(identity, {
      preview,
      state: current?.state === "aborting" ? "aborting" : "running",
    });
    return true;
  }

  function finishTool(payload?: Record<string, unknown>): boolean {
    if (!payload) {
      return false;
    }
    const identity = readToolIdentity(payload);
    const tool = identity ? tools.get(identity) : undefined;
    if (!tool) {
      return false;
    }
    tool.state = toolResultSucceeded(payload) ? "completed" : "failed";
    return true;
  }

  function settleCompletedBatch(): void {
    if (countRunningTools(tools) > 0) {
      return;
    }
    tools.clear();
    activityPreview = renderThinkingActivity(reasoningTokenEstimate);
  }

  return {
    start() {
      active = true;
      aborting = false;
      tools.clear();
      activityPreview = null;
      reasoningTokenEstimate = 0;
      reasoningTokens.reset();
      spinner.start();
      syncStatus();
    },
    stop() {
      active = false;
      aborting = false;
      tools.clear();
      spinner.stop();
      spinnerFrame = null;
      activityPreview = null;
      reasoningTokenEstimate = 0;
      reasoningTokens.reset();
      setStatus(null);
    },
    showAborting() {
      active = true;
      aborting = true;
      for (const tool of tools.values()) {
        if (tool.state === "running") {
          tool.state = "aborting";
        }
      }
      spinner.start();
      spinner.refresh();
      syncStatus();
    },
    beginTextStreaming() {
      if (!active) {
        return;
      }
      aborting = false;
      tools.clear();
      activityPreview = null;
      spinner.refresh();
      syncStatus();
    },
    noteToolActivity(preview, payload) {
      if (!active) {
        return;
      }
      aborting = false;
      if (!upsertTool(preview, payload)) {
        activityPreview = preview;
      }
      spinner.refresh();
      syncStatus();
    },
    noteToolCallPreview(preview, payload) {
      if (!active) {
        return;
      }
      aborting = false;
      if (!upsertTool(preview, payload)) {
        activityPreview = preview;
      }
      spinner.refresh();
      syncStatus();
    },
    noteToolResult(payload) {
      if (!active) {
        return;
      }
      aborting = false;
      if (!finishTool(payload) && tools.size === 0) {
        activityPreview = renderThinkingActivity(reasoningTokenEstimate);
      }
      settleCompletedBatch();
      spinner.refresh();
      syncStatus();
    },
    noteReasoningActivity(payload) {
      if (!active) {
        return;
      }
      aborting = false;
      tools.clear();
      reasoningTokenEstimate = reasoningTokens.update(payload);
      activityPreview = renderThinkingActivity(reasoningTokenEstimate);
      spinner.refresh();
      syncStatus();
    },
  };
}

function renderSpinnerLabel(
  tools: ReadonlyMap<string, ToolActivity>,
  activityPreview: string | null,
  label: string,
): string {
  if (tools.size > 0 && countRunningTools(tools) > 0) {
    return renderMuted(toolSummary(tools));
  }
  return activityPreview ?? renderMuted(label);
}

function toolSummary(tools: ReadonlyMap<string, ToolActivity>): string {
  const running = countRunningTools(tools);
  const completed = [...tools.values()].filter((tool) =>
    tool.state === "completed"
  ).length;
  const failed = [...tools.values()].filter((tool) => tool.state === "failed").length;
  const suffix = [
    completed > 0 ? `${completed} done` : null,
    failed > 0 ? `${failed} failed` : null,
  ].filter((value): value is string => value !== null);
  const runningLabel = `${running} tool${running === 1 ? "" : "s"} running`;
  return suffix.length > 0 ? `${runningLabel} · ${suffix.join(" · ")}` : runningLabel;
}

function renderToolRows(tools: ReadonlyMap<string, ToolActivity>): string[] {
  const entries = [...tools.values()];
  const visible = entries.slice(0, MAX_VISIBLE_TOOL_ROWS);
  const hiddenFailure = entries.slice(MAX_VISIBLE_TOOL_ROWS).find((tool) =>
    tool.state === "failed"
  );
  if (hiddenFailure && visible.length > 0) {
    visible[visible.length - 1] = hiddenFailure;
  }

  const rows = visible.map((tool, index) => {
    const hasOmittedRow = entries.length > visible.length;
    const last = index === visible.length - 1 && !hasOmittedRow;
    return `${last ? "└─" : "├─"} ${renderToolState(tool.state)} ${tool.preview}`;
  });
  const omitted = entries.length - visible.length;
  if (omitted > 0) {
    rows.push(`└─ ${renderMuted(`… ${omitted} more`)}`);
  }
  return rows;
}

function renderToolState(state: ToolState): string {
  switch (state) {
    case "running":
      return renderAccent("◐");
    case "completed":
      return renderAccent("✓");
    case "failed":
      return renderDanger("×");
    case "aborting":
      return renderMuted("–");
  }
}

function countRunningTools(tools: ReadonlyMap<string, ToolActivity>): number {
  return [...tools.values()].filter((tool) =>
    tool.state === "running" || tool.state === "aborting"
  ).length;
}

function toolResultSucceeded(payload: Record<string, unknown>): boolean {
  if (typeof payload.status === "string") {
    return payload.status === "ok";
  }
  return payload.ok === true;
}
