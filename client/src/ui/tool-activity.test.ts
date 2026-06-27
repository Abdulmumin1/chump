import assert from "node:assert/strict";
import { test } from "node:test";

import { ToolActivityRenderer } from "./tool-activity.ts";

test("renders consecutive searches as a compact run without blank lines", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall(searchCall("CHUMP_FFF_COMMAND"));
  renderer.renderToolResult(searchResult("CHUMP_FFF_COMMAND", 4));
  renderer.renderToolCall(searchCall("fff|FFF", "./client"));
  renderer.renderToolResult(searchResult("fff|FFF", 0));

  assert.equal(output.length, 2);
  assert.match(output[0] ?? "", /\n.*CHUMP_FFF_COMMAND.*4 matches/s);
  assert.match(output[1] ?? "", /fff\|FFF.*\.\/client.*no matches/s);
  assert.equal(output[1]?.startsWith("\n"), false);
  assert.equal(output.includes(""), false);
});

function searchCall(query: string, path = ""): Record<string, unknown> {
  return {
    name: "search",
    args: { query, path },
  };
}

function searchResult(query: string, totalMatched: number): Record<string, unknown> {
  const matches = Array.from({ length: totalMatched }, () => ({
        path: "client/src/app/runtime.ts",
        line: 1,
        column: 0,
        text: query,
      }));
  return {
    name: "search",
    status: "ok",
    preview: totalMatched > 0 ? query : "No matches found.",
    metadata: { matches, totalMatched, totalFiles: 1 },
  };
}
