import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listModelChoices } from "./models.ts";

test("filters model suggestions to server-advertised capabilities", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "chump-model-catalog-"));
  const catalogPath = path.join(cacheDir, "models.json");
  await writeFile(
    catalogPath,
    JSON.stringify({
      google: {
        id: "google",
        name: "Google",
        models: {
          "gemini-3.6-flash": {
            id: "gemini-3.6-flash",
            reasoning: true,
          },
          "gemini-3.5-flash": {
            id: "gemini-3.5-flash",
            reasoning: true,
          },
        },
      },
    }),
  );
  const previousModelsFile = process.env.CHUMP_MODELS_FILE;
  process.env.CHUMP_MODELS_FILE = catalogPath;
  try {
    const choices = await listModelChoices(["google"], {
      google: ["gemini-3.5-flash"],
    });

    assert.deepEqual(choices.map((choice) => choice.model), ["gemini-3.5-flash"]);
  } finally {
    if (previousModelsFile === undefined) {
      delete process.env.CHUMP_MODELS_FILE;
    } else {
      process.env.CHUMP_MODELS_FILE = previousModelsFile;
    }
  }
});
