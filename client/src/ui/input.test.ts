import assert from "node:assert/strict";
import { test } from "node:test";

import { attachmentsForDraft, isLikelyRawPaste } from "./input.ts";

test("does not mistake a coalesced typed line and Enter for a paste", () => {
  assert.equal(isLikelyRawPaste("typed quickly\r"), false);
  assert.equal(isLikelyRawPaste("typed quickly\n"), false);
  assert.equal(isLikelyRawPaste("\r"), false);
});

test("detects actual unbracketed multiline pastes", () => {
  assert.equal(isLikelyRawPaste("first line\rsecond line"), true);
  assert.equal(isLikelyRawPaste("first line\nsecond line\n"), true);
});

test("drops image attachments when their draft labels are cleared", () => {
  const first = {
    type: "image" as const,
    label: "[Image 1: clipboard.png]",
    filename: "clipboard.png",
    mime: "image/png",
    data: "first",
  };
  const second = { ...first, label: "[Image 2: clipboard.png]", data: "second" };

  assert.deepEqual(attachmentsForDraft("", [first, second]), []);
  assert.deepEqual(attachmentsForDraft(`${second.label} `, [first, second]), [second]);
});
