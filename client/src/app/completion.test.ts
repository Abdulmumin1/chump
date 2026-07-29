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

test("zsh completion passes array names to _describe", () => {
  const script = renderShellCompletion("zsh");
  assert.match(script, /_describe -t commands command commands/u);
  assert.match(script, /_describe -t options option global_options/u);
  assert.doesNotMatch(script, /_describe[^\n]*\$commands/u);
  assert.doesNotMatch(script, /_describe[^\n]*\$global_options/u);
});

test("print-only options are hidden unless -p/--print is already present", () => {
  for (const shell of ["bash", "fish", "powershell", "zsh"] as const) {
    const script = renderShellCompletion(shell);
    assert.match(script, /verbose/u);
  }
  // Each shell must gate --verbose behind a -p/--print guard.
  assert.match(renderShellCompletion("bash"), /has_print/u);
  assert.match(renderShellCompletion("fish"), /seen_argument.*-s p.*-l print/u);
  assert.match(renderShellCompletion("powershell"), /-p.*--print/u);
  assert.match(renderShellCompletion("zsh"), /has_print/u);
});

test("completion usage names every supported shell", () => {
  assert.equal(completionCommandUsage(), "chump completion <bash|fish|powershell|zsh>");
});
