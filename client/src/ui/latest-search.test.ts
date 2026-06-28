import assert from "node:assert/strict";
import { test } from "node:test";

import { LatestSearch } from "./latest-search.ts";

test("runs immediately and coalesces busy input to the latest query", async () => {
  const requests: Array<{
    query: string;
    resolve: (result: string[]) => void;
  }> = [];
  const results: Array<{ query: string; result: string[] }> = [];
  const search = new LatestSearch<string, string[]>(
    (query) => new Promise((resolve) => requests.push({ query, resolve })),
    (query, result) => results.push({ query, result }),
    () => assert.fail("search should not fail"),
  );

  search.request("g");
  assert.deepEqual(requests.map(({ query }) => query), ["g"]);

  search.request("ge");
  search.request("gen");
  assert.deepEqual(requests.map(({ query }) => query), ["g"]);

  requests[0]!.resolve(["old"]);
  await nextTurn();
  assert.deepEqual(results, []);
  assert.deepEqual(requests.map(({ query }) => query), ["g", "gen"]);

  requests[1]!.resolve(["generated-version.ts"]);
  await nextTurn();
  assert.deepEqual(results, [
    { query: "gen", result: ["generated-version.ts"] },
  ]);
});

test("cancel suppresses an in-flight result", async () => {
  let resolveRequest!: (result: string[]) => void;
  const results: string[][] = [];
  const search = new LatestSearch<string, string[]>(
    () => new Promise((resolve) => {
      resolveRequest = resolve;
    }),
    (_query, result) => results.push(result),
    () => assert.fail("search should not fail"),
  );

  search.request("query");
  search.cancel();
  resolveRequest(["ignored"]);
  await nextTurn();

  assert.deepEqual(results, []);
});

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
