import assert from "node:assert/strict";
import { test } from "node:test";

import {
  completeSlashCommand,
  parseSlashCommand,
  resolveSubagentTarget,
} from "./commands.ts";

const context = {
  sessions: [],
  models: [],
  mcps: [],
  skills: [
    {
      name: "release",
      description: "Publish the current project.",
    },
    {
      name: "review",
      description: "Review the current changes.",
    },
    {
      name: "animate-text",
      description: "Animate interface text.",
    },
  ],
};

test("lists discovered skills as Pi-style slash commands", () => {
  const [root] = completeSlashCommand("/", context);
  assert.equal(
    root.some((item) => item.command === "/skill:release"),
    true,
  );
  assert.equal(
    root.some((item) => item.command === "/reload"),
    true,
  );

  const [filtered] = completeSlashCommand("/skill:rel", context);
  assert.deepEqual(
    filtered.map((item) => item.command),
    ["/skill:release"],
  );

  const [naturalSearch] = completeSlashCommand("/animate text", context);
  assert.deepEqual(
    naturalSearch.map((item) => item.command),
    ["/skill:animate-text"],
  );
});

test("parses a skill command while preserving its arguments", () => {
  assert.deepEqual(parseSlashCommand("/skill:release publish patch now"), {
    command: "skill",
    args: ["release", "publish patch now"],
  });
  assert.deepEqual(parseSlashCommand("/skill:review"), {
    command: "skill",
    args: ["review"],
  });
});

test("parses the reload command", () => {
  assert.deepEqual(parseSlashCommand("/reload"), {
    command: "reload",
    args: [],
  });
});

test("completes sub-agent targets with the main-session parent", () => {
  const [, , suggestions] = completeSlashCommand("/sub ", {
    ...context,
    subagents: ["inspect-api", "review-types"],
  });
  assert.deepEqual(
    suggestions.map((item) => item.command),
    ["/sub ..", "/sub inspect-api", "/sub review-types"],
  );
  assert.deepEqual(parseSlashCommand("/sub .."), {
    command: "sub",
    args: [".."],
  });
  assert.equal(
    resolveSubagentTarget("..", "main-session", ["inspect-api"]),
    "main-session",
  );
  assert.equal(
    resolveSubagentTarget("inspect-api", "main-session", ["inspect-api"]),
    "inspect-api",
  );
  assert.equal(
    resolveSubagentTarget("missing", "main-session", ["inspect-api"]),
    null,
  );
});
