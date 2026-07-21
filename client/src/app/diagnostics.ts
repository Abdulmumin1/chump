import process from "node:process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { resolveWorkspaceRoot } from "./config.ts";
import { getWorkspaceStatePaths } from "./state-paths.ts";

let installed = false;
let clientLogPath: string | null = null;
const MAX_CLIENT_LOG_BYTES = 256 * 1024;
const debugDiagnostics = ["1", "true"].includes(
  (process.env.CHUMP_DEBUG_DIAGNOSTICS ?? "").toLowerCase(),
);

export function installClientDiagnostics(): void {
  if (installed) {
    return;
  }
  installed = true;

  process.on("uncaughtException", (error) => {
    logClientDiagnostic("uncaughtException", formatError(error));
    process.exitCode = 1;
  });

  process.on("unhandledRejection", (reason) => {
    logClientDiagnostic("unhandledRejection", formatUnknown(reason));
    process.exitCode = 1;
  });

  process.stdout.on("error", (error) => {
    logClientDiagnostic("stdoutError", formatError(error));
  });

  process.stderr.on("error", (error) => {
    logClientDiagnostic("stderrError", formatError(error));
  });
}

export function logClientEvent(kind: string, detail: string): void {
  if (!debugDiagnostics) {
    return;
  }
  logClientDiagnostic(kind, detail);
}

function logClientDiagnostic(kind: string, detail: string): void {
  try {
    if (!clientLogPath) {
      const workspaceRoot = resolveWorkspaceRoot(process.cwd());
      clientLogPath = getWorkspaceStatePaths(workspaceRoot).clientLogPath;
    }
    mkdirSync(path.dirname(clientLogPath), { recursive: true });
    rotateClientLogIfNeeded(clientLogPath);
    appendFileSync(
      clientLogPath,
      `${new Date().toISOString()} [${process.pid}] ${kind}: ${detail}\n`,
    );
  } catch {
    // Diagnostics must never become the reason the CLI exits.
  }
}

function rotateClientLogIfNeeded(logPath: string): void {
  if (!existsSync(logPath) || statSync(logPath).size < MAX_CLIENT_LOG_BYTES) {
    return;
  }
  const previousPath = `${logPath}.previous`;
  rmSync(previousPath, { force: true });
  renameSync(logPath, previousPath);
}

function formatUnknown(value: unknown): string {
  if (value instanceof Error) {
    return formatError(value);
  }
  return String(value);
}

function formatError(error: Error): string {
  const code = "code" in error ? ` code=${String(error.code)}` : "";
  return `${error.name}: ${error.message}${code}\n${error.stack ?? ""}`;
}
