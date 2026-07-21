import assert from "node:assert/strict";
import { test } from "node:test";

import { completeSlashCommand, parseSlashCommand } from "./commands.ts";

const context = {
  sessions: [],
  models: [],
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
