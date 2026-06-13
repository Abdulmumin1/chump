#!/usr/bin/env node

import { installClientDiagnostics } from "./app/diagnostics.ts";
import { runCli } from "./app/app.ts";
import { runFffSearchBridge } from "./app/fff-search.ts";
import { runDaemonProcess } from "./app/daemon-process.ts";

process.title = "Chump Agent (CLI)";

installClientDiagnostics();

const task = process.argv[2] === "__fff-search"
  ? runFffSearchBridge()
  : process.argv[2] === "__daemon"
    ? runDaemonProcess()
    : runCli();

task.catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
