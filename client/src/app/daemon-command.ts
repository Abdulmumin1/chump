import { closeSync, mkdirSync, openSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { DaemonMetadataStore, type DaemonMetadata } from "./daemon-metadata.ts";
import { getGlobalStatePaths } from "./state-paths.ts";

const DAEMON_START_TIMEOUT_MS = 10_000;
const DAEMON_STOP_TIMEOUT_MS = 5_000;
const DAEMON_LOCK_STALE_MS = 30_000;

export type DaemonCommand = "start" | "status" | "stop";

export function parseDaemonCommand(argv: string[]): DaemonCommand {
  const [command = "status", ...extra] = argv;
  if (extra.length > 0) {
    throw new Error(`unexpected daemon argument: ${extra[0]}`);
  }
  if (command === "start" || command === "status" || command === "stop") {
    return command;
  }
  throw new Error(`unknown daemon command: ${command}`);
}

export async function runDaemonCommand(command: DaemonCommand): Promise<string> {
  if (command === "start") return await startDaemonProcess();
  if (command === "stop") return await stopDaemonProcess();
  const metadata = await readHealthyDaemon();
  return metadata
    ? `daemon running at ${metadata.url} (pid ${metadata.pid})`
    : "daemon is not running";
}

export function daemonCommandUsage(): string {
  return [
    "chump daemon start",
    "chump daemon status",
    "chump daemon stop",
  ].join("\n");
}

async function startDaemonProcess(): Promise<string> {
  return await withDaemonLock(async () => {
    const existing = await readHealthyDaemon();
    if (existing) {
      return `daemon already running at ${existing.url} (pid ${existing.pid})`;
    }

    const paths = getGlobalStatePaths();
    await mkdir(paths.dataDir, { recursive: true });
    const logFd = openSync(paths.daemonLogPath, "a", 0o600);
    try {
      const daemonProcess = daemonSpawnCommand(process.execPath, process.argv);
      const child = spawn(daemonProcess.file, daemonProcess.args, {
        detached: process.platform !== "win32",
        env: process.env,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
      });
      child.unref();

      try {
        const metadata = await waitForHealthyDaemon(DAEMON_START_TIMEOUT_MS);
        return `daemon started at ${metadata.url} (pid ${metadata.pid})`;
      } catch (error) {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process may already have exited.
        }
        throw new Error(
          `daemon failed to start; inspect ${paths.daemonLogPath}`,
          { cause: error },
        );
      }
    } finally {
      closeSync(logFd);
    }
  });
}

async function stopDaemonProcess(): Promise<string> {
  const store = new DaemonMetadataStore();
  const metadata = await store.readActive();
  if (!metadata) {
    return "daemon is not running";
  }

  signalProcess(metadata.pid, "SIGTERM");
  if (!(await waitForDaemonExit(metadata, DAEMON_STOP_TIMEOUT_MS))) {
    signalProcess(metadata.pid, "SIGKILL");
    if (!(await waitForDaemonExit(metadata, 2_000))) {
      throw new Error(`failed to stop daemon at ${metadata.url}`);
    }
  }
  await store.clear(metadata.pid);
  return `daemon stopped at ${metadata.url}`;
}

async function readHealthyDaemon(): Promise<DaemonMetadata | null> {
  const metadata = await new DaemonMetadataStore().readActive();
  if (!metadata) return null;
  return await daemonIsHealthy(metadata) ? metadata : null;
}

async function daemonIsHealthy(metadata: DaemonMetadata): Promise<boolean> {
  try {
    const response = await fetch(`${metadata.url}/health`, {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return false;
    const health = await response.json() as Record<string, unknown>;
    return (
      health.service === "chump-daemon" &&
      health.protocolVersion === metadata.protocolVersion
    );
  } catch {
    return false;
  }
}

async function waitForHealthyDaemon(timeoutMs: number): Promise<DaemonMetadata> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const metadata = await readHealthyDaemon();
    if (metadata) return metadata;
    await sleep(100);
  }
  throw new Error("timed out waiting for daemon health");
}

async function waitForDaemonExit(
  metadata: DaemonMetadata,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const store = new DaemonMetadataStore();
  while (Date.now() < deadline) {
    const current = await store.readActive();
    if (!current || current.pid !== metadata.pid) return true;
    await sleep(100);
  }
  return false;
}

async function withDaemonLock<T>(task: () => Promise<T>): Promise<T> {
  const lockDir = getGlobalStatePaths().daemonLockDir;
  await mkdir(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;

  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      if (await lockIsStale(lockDir)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("timed out waiting for daemon lock");
      }
      await sleep(100);
    }
  }

  try {
    return await task();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

export function daemonSpawnCommand(
  execPath: string,
  argv: string[],
): { file: string; args: string[] } {
  if (isStandaloneBinary(execPath)) {
    return { file: execPath, args: ["__daemon"] };
  }

  const executablePath = argv[1];
  if (!executablePath) {
    throw new Error("cannot determine Chump executable path");
  }
  return { file: execPath, args: [executablePath, "__daemon"] };
}

function isStandaloneBinary(execPath: string): boolean {
  const name = path.basename(execPath).toLowerCase();
  if (name === "node" || name === "node.exe" || name === "bun" || name === "bun.exe") {
    return false;
  }
  return name === "chump" || name === "chump.exe" || name.startsWith("chump-");
}

async function lockIsStale(lockDir: string): Promise<boolean> {
  try {
    const lockStats = await stat(lockDir);
    return Date.now() - lockStats.mtimeMs > DAEMON_LOCK_STALE_MS;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!isNodeError(error, "ESRCH")) throw error;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
