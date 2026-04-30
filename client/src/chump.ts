#!/usr/bin/env node

import { installClientDiagnostics } from "./app/diagnostics.ts";
import { runCli } from "./app/app.ts";

installClientDiagnostics();

runCli().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
