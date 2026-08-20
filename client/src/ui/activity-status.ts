import { LiveReasoningTokenCounter } from "./reasoning.ts";
import {
  renderAccent,
  renderDanger,
  renderMuted,
  renderThinkingActivity,
} from "./render.ts";
import { createSpinner } from "./spinner.ts";
import type { StatusDisplay } from "./status.ts";
import type {
  DelegatedSessionProgress,
  DelegatedToolResultEvent,
} from "../core/delegated-session-progress.ts";
import { parseDelegatedSessionProgress } from "../core/delegated-session-progress.ts";
import { parseChumpEvent } from "../core/events.ts";
import type { StoredEvent } from "../core/types.ts";
import {
  mergeReasoningText,
  renderReasoningActivityPreview,
} from "./reasoning.ts";
import {
  formatDelegatedToolPreview,
  readStartedSessionId,
  readStartedSessionResultPreview,
  parseStartedSessionPayload,
  readToolCallId,
  readToolIdentity,
  type StartedSessionPayload,
} from "./tool-activity.ts";

const MAX_VISIBLE_TOOL_ROWS = 4;
const DEFAULT_DELEGATED_TOOL_REVEAL_DELAY_MS = 3_000;
const DEFAULT_DELEGATED_STATUS_MIN_VISIBLE_MS = 3_000;

type ActivityTimer = object | number;

type ActivityClock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => ActivityTimer;
  clearTimeout: (timer: ActivityTimer) => void;
};

type ActivityStatusOptions = {
  label?: string;
  workspaceRoot?: string;
  delegatedToolRevealDelayMs?: number;
  delegatedStatusMinVisibleMs?: number;
  clock?: ActivityClock;
};

type ToolState = "running" | "completed" | "failed" | "aborting";

type ToolActivity = {
  preview: string;
  state: ToolState;
  callId: string | null;
  delegated?: DelegatedSessionActivity;
};

type DelegatedSessionActivity = {
  sessionId: string | null;
  model: string | null;
  phase: string;
  reasoningText: string;
  tools: Map<string, DelegatedToolActivity>;
  visibleStatus: DelegatedStatusLine;
  statusTimer: ActivityTimer | null;
};

type DelegatedToolActivity = {
  preview: string;
  state: "running" | "completed" | "failed";
  eligibleAt: number;
};

type DelegatedStatusLine = {
  key: string;
  value: string;
  shownAt: number;
};

const systemActivityClock: ActivityClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
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
  noteDelegatedSessionProgress: (progress: DelegatedSessionProgress) => void;
  rehydrate: (events: readonly StoredEvent[]) => void;
};

export function createActivityStatusController(
  setStatus: (status: StatusDisplay) => void,
  options: ActivityStatusOptions = {},
): ActivityStatusController {
  const label = options.label ?? "Transmogrifying";
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const delegatedToolRevealDelayMs = Math.max(
    0,
    options.delegatedToolRevealDelayMs ?? DEFAULT_DELEGATED_TOOL_REVEAL_DELAY_MS,
  );
  const delegatedStatusMinVisibleMs = Math.max(
    0,
    options.delegatedStatusMinVisibleMs ?? DEFAULT_DELEGATED_STATUS_MIN_VISIBLE_MS,
  );
  const clock = options.clock ?? systemActivityClock;
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
    const startedSession = parseStartedSessionPayload(payload);
    const delegated = startedSession
      ? current?.delegated ?? delegatedSessionFrom(startedSession, clock.now())
      : undefined;
    if (startedSession && delegated && !delegated.model) {
      delegated.model = startedSessionModel(startedSession);
    }
    tools.set(identity, {
      preview: startedSession ? toolPreview(startedSession, preview) : preview,
      state: current?.state === "aborting" ? "aborting" : "running",
      callId: readToolCallId(payload),
      delegated,
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
    const succeeded = toolResultSucceeded(payload);
    tool.state = succeeded ? "completed" : "failed";
    if (tool.delegated) {
      settleDelegatedSession(tool.delegated, payload, succeeded, clock);
    }
    return true;
  }

  function settleCompletedBatch(): void {
    if (countRunningTools(tools) > 0) {
      return;
    }
    clearToolActivities(tools, clock);
    activityPreview = renderThinkingActivity(reasoningTokenEstimate);
  }

  function refreshDelegatedStatus(delegated: DelegatedSessionActivity): void {
    reconcileDelegatedStatus(
      delegated,
      clock,
      delegatedStatusMinVisibleMs,
      () => {
        if (!active) {
          return;
        }
        spinner.refresh();
        syncStatus();
      },
    );
  }

  return {
    start() {
      active = true;
      aborting = false;
      clearToolActivities(tools, clock);
      activityPreview = null;
      reasoningTokenEstimate = 0;
      reasoningTokens.reset();
      spinner.start();
      syncStatus();
    },
    stop() {
      active = false;
      aborting = false;
      clearToolActivities(tools, clock);
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
      clearToolActivities(tools, clock);
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
      clearToolActivities(tools, clock);
      reasoningTokenEstimate = reasoningTokens.update(payload);
      activityPreview = renderThinkingActivity(reasoningTokenEstimate);
      spinner.refresh();
      syncStatus();
    },
    noteDelegatedSessionProgress(progress) {
      if (!active) {
        return;
      }
      const identity = `position:${progress.parentStep}:${progress.parentIndex}`;
      const tool = tools.get(identity);
      if (
        !tool?.delegated ||
        (tool.callId !== null && tool.callId !== progress.parentCallId)
      ) {
        return;
      }
      updateDelegatedSession(
        tool.delegated,
        progress,
        workspaceRoot,
        clock.now(),
        delegatedToolRevealDelayMs,
      );
      refreshDelegatedStatus(tool.delegated);
      tool.preview = renderSessionPreview(
        progress.sessionId,
        tool.delegated.model,
      );
      spinner.refresh();
      syncStatus();
    },
    rehydrate(events) {
      if (!active) {
        return;
      }
      for (const storedEvent of events) {
        if (storedEvent.type === "tool_execution.progress") {
          const progress = parseDelegatedSessionProgress(storedEvent.data);
          if (progress) {
            this.noteDelegatedSessionProgress(progress);
          }
          continue;
        }
        const event = parseChumpEvent(storedEvent.type, storedEvent.data);
        switch (event?.type) {
          case "assistant_text":
            this.beginTextStreaming();
            break;
          case "tool_call":
            this.noteToolActivity(
              formatDelegatedToolPreview(
                event.data.name,
                event.data.args,
                workspaceRoot,
              ),
              event.data,
            );
            break;
          case "tool_result":
            this.noteToolResult(event.data);
            break;
        }
        if (storedEvent.type === "reasoning") {
          this.noteReasoningActivity(storedEvent.data);
        }
      }
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

  const rows = visible.flatMap((tool, index) => {
    const hasOmittedRow = entries.length > visible.length;
    const last = index === visible.length - 1 && !hasOmittedRow;
    const lines = [
      `${last ? "└─" : "├─"} ${renderToolState(tool.state)} ${tool.preview}`,
    ];
    const nestedRows = tool.delegated ? renderDelegatedRows(tool.delegated) : [];
    for (const [nestedIndex, nested] of nestedRows.entries()) {
      const nestedLast = nestedIndex === nestedRows.length - 1;
      lines.push(
        `${last ? "   " : "│  "}${nestedLast ? "└─" : "├─"} ${nested}`,
      );
    }
    return lines;
  });
  const omitted = entries.length - visible.length;
  if (omitted > 0) {
    rows.push(`└─ ${renderMuted(`… ${omitted} more`)}`);
  }
  return rows;
}

function toolPreview(
  payload: StartedSessionPayload,
  fallback: string,
): string {
  const sessionId = readStartedSessionId(payload);
  const model = startedSessionModel(payload);
  return sessionId
    ? renderSessionPreview(sessionId, model)
    : `Session: ${model || "starting…"}`;
}

function delegatedSessionFrom(
  payload: StartedSessionPayload,
  now: number,
): DelegatedSessionActivity {
  const phase = "Starting delegated task";
  return {
    sessionId: readStartedSessionId(payload),
    model: startedSessionModel(payload),
    phase,
    reasoningText: "",
    tools: new Map(),
    visibleStatus: {
      key: `phase:${phase}`,
      value: phase,
      shownAt: now,
    },
    statusTimer: null,
  };
}

function settleDelegatedSession(
  delegated: DelegatedSessionActivity,
  payload: Record<string, unknown>,
  succeeded: boolean,
  clock: ActivityClock,
): void {
  if (delegated.statusTimer !== null) {
    clock.clearTimeout(delegated.statusTimer);
    delegated.statusTimer = null;
  }
  delegated.tools.clear();
  delegated.reasoningText = "";
  delegated.phase = succeeded ? "Completed" : "Failed";

  const result = readStartedSessionResultPreview(payload);
  const value = succeeded
    ? `Result: ${result ?? "Completed"}`
    : `Failed: ${result ?? "Delegated session failed"}`;
  delegated.visibleStatus = {
    key: `result:${succeeded ? "ok" : "error"}:${result ?? ""}`,
    value: renderMuted(value),
    shownAt: clock.now(),
  };
}

function startedSessionModel(payload: StartedSessionPayload): string | null {
  const args = payload.args ?? payload.payload;
  const model = [args?.provider, args?.model]
    .filter((part): part is string => Boolean(part))
    .join("/");
  return model || null;
}

function renderSessionPreview(sessionId: string, model: string | null): string {
  return `Session: ${sessionId}${model ? ` · ${renderMuted(model)}` : ""}`;
}

function updateDelegatedSession(
  delegated: DelegatedSessionActivity,
  progress: DelegatedSessionProgress,
  workspaceRoot: string,
  now: number,
  toolRevealDelayMs: number,
): void {
  delegated.sessionId = progress.sessionId;
  const event = progress.event;
  switch (event.type) {
    case "session_starting":
      delegated.phase = "Starting delegated task";
      return;
    case "reasoning":
      delegated.reasoningText = mergeReasoningText(delegated.reasoningText, event.text);
      delegated.phase = "Thinking";
      removeSettledDelegatedTools(delegated.tools);
      return;
    case "tool_call":
      delegated.tools.set(event.callId, {
        preview: formatDelegatedToolPreview(event.name, event.args, workspaceRoot),
        state: "running",
        eligibleAt: now + toolRevealDelayMs,
      });
      delegated.phase = "Working";
      return;
    case "tool_result":
      finishDelegatedTool(delegated.tools, event);
      return;
    case "assistant_text":
      removeSettledDelegatedTools(delegated.tools);
      delegated.phase = "Writing response";
      return;
    case "status":
      if (event.phase === "step_start" && delegated.tools.size === 0) {
        delegated.phase = `Working on step ${event.step}`;
      }
      return;
    case "turn_error":
      delegated.tools.clear();
      delegated.phase = `Failed: ${event.message}`;
      return;
  }
}

function finishDelegatedTool(
  tools: Map<string, DelegatedToolActivity>,
  event: DelegatedToolResultEvent,
): void {
  const tool = tools.get(event.callId);
  if (tool) {
    tool.state = event.status === "ok" ? "completed" : "failed";
  }
}

function removeSettledDelegatedTools(tools: Map<string, DelegatedToolActivity>): void {
  for (const [callId, tool] of tools) {
    if (tool.state !== "running") {
      tools.delete(callId);
    }
  }
}

function reconcileDelegatedStatus(
  delegated: DelegatedSessionActivity,
  clock: ActivityClock,
  minimumVisibleMs: number,
  onStatusChange: () => void,
): void {
  if (delegated.statusTimer !== null) {
    clock.clearTimeout(delegated.statusTimer);
    delegated.statusTimer = null;
  }

  const now = clock.now();
  const desired = delegatedStatusCandidate(delegated, now);
  const canReplaceAt = delegated.visibleStatus.shownAt + minimumVisibleMs;
  let pendingReplacementAt: number | null = null;

  if (desired.key !== delegated.visibleStatus.key) {
    if (now >= canReplaceAt) {
      delegated.visibleStatus = { ...desired, shownAt: now };
      onStatusChange();
    } else {
      pendingReplacementAt = canReplaceAt;
    }
  }

  const nextToolRevealAt = [...delegated.tools.values()]
    .filter((tool) => tool.state === "running" && tool.eligibleAt > now)
    .reduce<number | null>(
      (earliest, tool) => earliest === null
        ? tool.eligibleAt
        : Math.min(earliest, tool.eligibleAt),
      null,
    );
  const nextUpdateAt = [pendingReplacementAt, nextToolRevealAt]
    .filter((deadline): deadline is number => deadline !== null)
    .reduce<number | null>(
      (earliest, deadline) => earliest === null
        ? deadline
        : Math.min(earliest, deadline),
      null,
    );
  if (nextUpdateAt === null) {
    return;
  }

  delegated.statusTimer = clock.setTimeout(() => {
    delegated.statusTimer = null;
    reconcileDelegatedStatus(
      delegated,
      clock,
      minimumVisibleMs,
      onStatusChange,
    );
  }, Math.max(0, nextUpdateAt - now));
}

function delegatedStatusCandidate(
  delegated: DelegatedSessionActivity,
  now: number,
): Pick<DelegatedStatusLine, "key" | "value"> {
  const childTool = [...delegated.tools.entries()]
    .reverse()
    .find(([, tool]) =>
      tool.state === "failed" ||
      (tool.state === "running" && tool.eligibleAt <= now)
    );
  if (childTool) {
    const [callId, tool] = childTool;
    return {
      key: `tool:${callId}:${tool.state}`,
      value: `${renderDelegatedToolState(tool.state)} ${tool.preview}`,
    };
  }

  const reasoning = renderReasoningActivityPreview(delegated.reasoningText);
  if (reasoning) {
    return {
      key: `reasoning:${delegated.reasoningText}`,
      value: reasoning,
    };
  }
  return {
    key: `phase:${delegated.phase}`,
    value: delegated.phase,
  };
}

function clearToolActivities(
  tools: Map<string, ToolActivity>,
  clock: ActivityClock,
): void {
  for (const tool of tools.values()) {
    if (tool.delegated && tool.delegated.statusTimer !== null) {
      clock.clearTimeout(tool.delegated.statusTimer);
      tool.delegated.statusTimer = null;
    }
  }
  tools.clear();
}

function renderDelegatedRows(delegated: DelegatedSessionActivity): string[] {
  return [delegated.visibleStatus.value];
}

function renderDelegatedToolState(
  state: DelegatedToolActivity["state"],
): string {
  if (state === "running") return renderAccent("◐");
  if (state === "failed") return renderDanger("×");
  return renderAccent("✓");
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
