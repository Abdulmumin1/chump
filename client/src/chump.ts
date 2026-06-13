#!/usr/bin/env node

import { installClientDiagnostics } from "./app/diagnostics.ts";
import { runCli } from "./app/app.ts";
import { runFffSearchBridge } from "./app/fff-search.ts";

process.title = "Chump Agent (CLI)";

installClientDiagnostics();

const task = process.argv[2] === "__fff-search"
  ? runFffSearchBridge()
  : runCli();

task.catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
