#!/usr/bin/env node

import { runCli } from "./app/app.ts";

runCli().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
