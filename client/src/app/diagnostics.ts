import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

let installed = false;

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

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      logClientDiagnostic("signal", signal);
      process.exit(signal === "SIGINT" ? 130 : 128 + signalNumber(signal));
    });
  }

  process.stdout.on("error", (error) => {
    logClientDiagnostic("stdoutError", formatError(error));
  });

  process.stderr.on("error", (error) => {
    logClientDiagnostic("stderrError", formatError(error));
  });

  process.on("beforeExit", (code) => {
    logClientDiagnostic("beforeExit", `code=${code}`);
  });

  process.on("exit", (code) => {
    logClientDiagnostic("exit", `code=${code}`);
  });
}

export function logClientEvent(kind: string, detail: string): void {
  logClientDiagnostic(kind, detail);
}

function logClientDiagnostic(kind: string, detail: string): void {
  const dir = path.join(process.cwd(), ".chump");
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      path.join(dir, "client.log"),
      `${new Date().toISOString()} [${process.pid}] ${kind}: ${detail}\n`,
    );
  } catch {
    // Diagnostics must never become the reason the CLI exits.
  }
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

function signalNumber(signal: "SIGTERM" | "SIGHUP"): number {
  return signal === "SIGTERM" ? 15 : 1;
}
