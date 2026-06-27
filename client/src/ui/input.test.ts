import assert from "node:assert/strict";
import { test } from "node:test";

import { isLikelyRawPaste } from "./input.ts";

test("does not mistake a coalesced typed line and Enter for a paste", () => {
  assert.equal(isLikelyRawPaste("typed quickly\r"), false);
  assert.equal(isLikelyRawPaste("typed quickly\n"), false);
  assert.equal(isLikelyRawPaste("\r"), false);
});

test("detects actual unbracketed multiline pastes", () => {
  assert.equal(isLikelyRawPaste("first line\rsecond line"), true);
  assert.equal(isLikelyRawPaste("first line\nsecond line\n"), true);
});
