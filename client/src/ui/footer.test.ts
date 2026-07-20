import assert from "node:assert/strict";
import { test } from "node:test";

import type { ShareStatus } from "../core/types.ts";
import { renderSessionFooter } from "./footer.ts";

const status = {
  provider: "workers_ai",
  model: "@cf/moonshotai/kimi-k2.7-code",
  reasoning: { effort: "low" },
  git_branch: "main",
};

test("keeps the normal local footer focused on workspace and model", () => {
  const footer = renderSessionFooter(
    { workspaceRoot: "/workspace/chump", serverSource: "managed" },
    status,
    null,
  );

  assert.equal(
    footer,
    "/workspace/chump (main)\nworkers_ai/@cf/moonshotai/kimi-k2.7-code · thinking low",
  );
  assert.doesNotMatch(footer, /managed|remote/);
});

test("shows remote and sharing only when those states are active", () => {
  const share: ShareStatus = {
    provider: "onlocal",
    publicUrl: "https://example.onlocal.dev",
    localUrl: "http://127.0.0.1:8080",
    connectUrl: null,
    startedAt: 1,
  };
  const footer = renderSessionFooter(
    { workspaceRoot: "/workspace/chump", serverSource: "direct" },
    status,
    share,
  );

  assert.equal(
    footer,
    "/workspace/chump (main)\nworkers_ai/@cf/moonshotai/kimi-k2.7-code · thinking low · shared · remote",
  );
});

test("shows an explicit thinking state when provider reasoning is null", () => {
  const automatic = renderSessionFooter(
    { workspaceRoot: "/workspace/chump", serverSource: "managed" },
    {
      ...status,
      provider: "chump_cloud",
      model: "deepseek-v4-pro",
      reasoning: null,
    },
    null,
  );
  const disabled = renderSessionFooter(
    { workspaceRoot: "/workspace/chump", serverSource: "managed" },
    { ...status, provider: "codex", reasoning: null },
    null,
  );

  assert.match(automatic, /thinking auto$/);
  assert.match(disabled, /thinking off$/);
});

test("renders known reasoning budgets as levels", () => {
  const footer = renderSessionFooter(
    { workspaceRoot: "/workspace/chump", serverSource: "managed" },
    { ...status, provider: "google", reasoning: { budget: 16384 } },
    null,
  );

  assert.match(footer, /thinking xhigh$/);
});
