import assert from "node:assert/strict";
import test from "node:test";

import {
  ServerHttpError,
  ServerStreamInterruptedError,
  isTransientServerError,
} from "./errors.ts";

test("classifies dead-runtime failures without retrying ordinary server errors", () => {
  assert.equal(isTransientServerError(new TypeError("fetch failed")), true);
  assert.equal(isTransientServerError(new ServerStreamInterruptedError()), true);
  assert.equal(isTransientServerError(new ServerHttpError("unavailable", 503)), true);
  assert.equal(isTransientServerError(new ServerHttpError("bug", 500)), false);
});
