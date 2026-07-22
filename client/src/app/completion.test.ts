import assert from "node:assert/strict";
import test from "node:test";

import {
  completionCommandUsage,
  parseCompletionShell,
  renderShellCompletion,
} from "./completion.ts";

test("parses each supported completion shell", () => {
  assert.equal(parseCompletionShell("bash"), "bash");
  assert.equal(parseCompletionShell("fish"), "fish");
  assert.equal(parseCompletionShell("powershell"), "powershell");
  assert.equal(parseCompletionShell("zsh"), "zsh");
  assert.throws(() => parseCompletionShell("nushell"), /unknown completion shell/u);
  assert.throws(() => parseCompletionShell(undefined), /unknown completion shell/u);
});

test("renders static completion scripts without invoking the CLI", () => {
  for (const shell of ["bash", "fish", "powershell", "zsh"] as const) {
    const script = renderShellCompletion(shell);
    assert.match(script, /daemon/u);
    assert.match(script, /projects/u);
    assert.match(script, /none.*low.*high.*xhigh/u);
    assert.doesNotMatch(script, /\bchump __complete\b/u);
  }
});

test("completion usage names every supported shell", () => {
  assert.equal(completionCommandUsage(), "chump completion <bash|fish|powershell|zsh>");
});
