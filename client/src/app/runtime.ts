import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type {
  CliMode,
  CliOptions,
  ManagedServerMetadata,
} from "../core/types.ts";
import { getWorkspaceStatePaths } from "./state-paths.ts";

const DEFAULT_SERVER_URL = "http://127.0.0.1:8080";
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const SERVER_WAIT_MS = 15_000;
const DEFAULT_MANAGED_IDLE_TIMEOUT_SECONDS = 30;

export function parseCliArgs(argv: string[]): CliOptions {
  let mode: CliMode = "interactive";
  let connectUrl: string | null = null;
  let sessionId: string | null = null;
  let autoStartServer = process.env.CHUMP_SERVER_URL ? false : true;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "-h" || value === "--help") {
      mode = "help";
      continue;
    }

    if (value === "-c" || value === "--connect") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("missing server URL after -c/--connect");
      }
      connectUrl = nextValue;
      autoStartServer = false;
      index += 1;
      continue;
    }

    if (value === "-s" || value === "--session") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("missing session id after -s/--session");
      }
      sessionId = nextValue;
      index += 1;
      continue;
    }

    if (value === "client" || value === "server" || value === "status" || value === "stop" || value === "connect") {
      mode = value;
      if (value !== "server") {
        autoStartServer = false;
      }
      continue;
    }

    throw new Error(`unknown argument: ${value}`);
  }

  if (connectUrl) {
    autoStartServer = false;
  }

  if (mode === "client" || mode === "status" || mode === "stop" || mode === "connect") {
    autoStartServer = false;
  }

  return { mode, connectUrl, sessionId, autoStartServer };
}

export function printCliUsage(): void {
  console.log("chump [-s <session-id>]");
  console.log("chump -c <server-url> [-s <session-id>]");
  console.log("chump client [-c <server-url>] [-s <session-id>]");
  console.log("chump server");
  console.log("chump connect");
  console.log("chump status [-c <server-url>] [-s <session-id>]");
  console.log("chump stop");
}

export async function ensureServerTarget(
  workspaceRoot: string,
  options: CliOptions,
): Promise<{
  serverUrl: string;
  serverSource: "managed" | "direct";
  note: string | null;
  metadata: ManagedServerMetadata | null;
}> {
  if (options.connectUrl) {
    await assertServerHealthy(options.connectUrl);
    return {
      serverUrl: options.connectUrl,
      serverSource: "direct",
      note: null,
      metadata: null,
    };
  }

  const metadata = await readManagedServerMetadata(workspaceRoot);
  if (metadata && await isServerHealthy(metadata.url)) {
    if (!(await managedServerIsReusable(metadata))) {
      await stopManagedServer(workspaceRoot);
    } else {
      return {
        serverUrl: metadata.url,
        serverSource: "managed",
        note: null,
        metadata,
      };
    }
  }

  const refreshedMetadata = await readManagedServerMetadata(workspaceRoot);
  if (
    refreshedMetadata &&
    await isServerHealthy(refreshedMetadata.url) &&
    await managedServerIsReusable(refreshedMetadata)
  ) {
    return {
      serverUrl: refreshedMetadata.url,
      serverSource: "managed",
      note: null,
      metadata: refreshedMetadata,
    };
  }

  const envServerUrl = process.env.CHUMP_SERVER_URL;
  if (envServerUrl) {
    await assertServerHealthy(envServerUrl);
    return {
      serverUrl: envServerUrl,
      serverSource: "direct",
      note: null,
      metadata: null,
    };
  }

  if (!options.autoStartServer) {
    const fallbackUrl = metadata?.url ?? DEFAULT_SERVER_URL;
    await assertServerHealthy(fallbackUrl);
    return {
      serverUrl: fallbackUrl,
      serverSource: metadata ? "managed" : "direct",
      note: null,
      metadata,
    };
  }

  const started = await ensureManagedServer(workspaceRoot);
  return {
    serverUrl: started.metadata.url,
    serverSource: "managed",
    note: started.started ? `started local server at ${started.metadata.url}` : `reusing local server at ${started.metadata.url}`,
    metadata: started.metadata,
  };
}

export async function startServerCommand(workspaceRoot: string): Promise<{
  started: boolean;
  metadata: ManagedServerMetadata;
}> {
  return await runForegroundServer(workspaceRoot);
}

export async function stopManagedServer(workspaceRoot: string): Promise<string> {
  const metadata = await readManagedServerMetadata(workspaceRoot);
  if (!metadata) {
    return "no managed server metadata found";
  }

  if (metadata.pid) {
    try {
      process.kill(metadata.pid, "SIGTERM");
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  }

  const stopped = await waitForServerExit(metadata.url, 5_000);
  if (!stopped && metadata.pid) {
    try {
      process.kill(metadata.pid, "SIGKILL");
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
    await waitForServerExit(metadata.url, 2_000);
  }

  await clearManagedServerMetadata(workspaceRoot);
  return `stopped ${metadata.url}`;
}

async function ensureManagedServer(workspaceRoot: string): Promise<{
  started: boolean;
  metadata: ManagedServerMetadata;
}> {
  const current = await readManagedServerMetadata(workspaceRoot);
  if (
    current &&
    await isServerHealthy(current.url) &&
    await managedServerIsReusable(current)
  ) {
    return { started: false, metadata: current };
  }

  return await withWorkspaceLock(workspaceRoot, async () => {
    const existing = await readManagedServerMetadata(workspaceRoot);
    if (
      existing &&
      await isServerHealthy(existing.url) &&
      await managedServerIsReusable(existing)
    ) {
      return { started: false, metadata: existing };
    }

    if (existing && await isServerHealthy(existing.url)) {
      await stopManagedServer(workspaceRoot);
    }

    const metadata = await spawnManagedServer(workspaceRoot);
    return { started: true, metadata };
  });
}

async function runForegroundServer(workspaceRoot: string): Promise<{
  started: boolean;
  metadata: ManagedServerMetadata;
}> {
  return await withWorkspaceLock(workspaceRoot, async () => {
    const existing = await readManagedServerMetadata(workspaceRoot);
    if (existing && await isServerHealthy(existing.url)) {
      return { started: false, metadata: existing };
    }

    const port = await findAvailablePort();
    const paths = getWorkspaceStatePaths(workspaceRoot);
    const command = resolveServerCommand();
    await mkdir(paths.dataDir, { recursive: true });

    const child = spawn(command.file, command.args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CHUMP_WORKSPACE_ROOT: workspaceRoot,
        CHUMP_STATE_DIR: paths.dataDir,
        CHUMP_AUTH_FILE: globalAuthFilePath(),
        CHUMP_HOST: "127.0.0.1",
        CHUMP_PORT: String(port),
      },
      stdio: "inherit",
    });

    const metadata: ManagedServerMetadata = {
      url: buildServerUrl(port),
      port,
      pid: child.pid ?? null,
      command: command.file,
      command_args: command.args,
      command_source: command.source,
      workspace_root: workspaceRoot,
      data_dir: paths.dataDir,
      log_path: paths.logPath,
      started_at: new Date().toISOString(),
    };

    await waitForHealthyServer(metadata.url, SERVER_WAIT_MS);
    await writeManagedServerMetadata(workspaceRoot, metadata);

    const cleanup = async () => {
      const current = await readManagedServerMetadata(workspaceRoot);
      if (current?.pid === metadata.pid) {
        await clearManagedServerMetadata(workspaceRoot);
      }
    };

    child.on("exit", () => {
      void cleanup();
    });

    await new Promise<void>((resolve, reject) => {
      child.on("exit", (code, signal) => {
        if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
          resolve();
          return;
        }
        reject(new Error(`server exited with code ${code ?? "unknown"}`));
      });
      child.on("error", reject);
    });

    return { started: true, metadata };
  });
}

async function spawnManagedServer(workspaceRoot: string): Promise<ManagedServerMetadata> {
  const port = await findAvailablePort();
  const command = resolveServerCommand();
  const paths = getWorkspaceStatePaths(workspaceRoot);
  await mkdir(paths.dataDir, { recursive: true });

  const logFd = openSync(paths.logPath, "a");
  try {
    const child = spawn(command.file, command.args, {
      cwd: workspaceRoot,
      detached: true,
      env: {
        ...process.env,
        CHUMP_WORKSPACE_ROOT: workspaceRoot,
        CHUMP_STATE_DIR: paths.dataDir,
        CHUMP_AUTH_FILE: globalAuthFilePath(),
        CHUMP_HOST: "127.0.0.1",
        CHUMP_PORT: String(port),
        CHUMP_MANAGED_SERVER_IDLE_TIMEOUT: managedIdleTimeoutSeconds(),
      },
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();

    const metadata: ManagedServerMetadata = {
      url: buildServerUrl(port),
      port,
      pid: child.pid ?? null,
      command: command.file,
      command_args: command.args,
      command_source: command.source,
      workspace_root: workspaceRoot,
      data_dir: paths.dataDir,
      log_path: paths.logPath,
      started_at: new Date().toISOString(),
    };

    try {
      await waitForHealthyServer(metadata.url, SERVER_WAIT_MS);
    } catch (error) {
      throw new Error(
        `server failed to start at ${metadata.url}; inspect ${paths.logPath}`,
        { cause: error },
      );
    }

    await writeManagedServerMetadata(workspaceRoot, metadata);
    return metadata;
  } finally {
    closeSync(logFd);
  }
}

async function withWorkspaceLock<T>(
  workspaceRoot: string,
  task: () => Promise<T>,
): Promise<T> {
  const lockDir = getWorkspaceStatePaths(workspaceRoot).lockDir;
  await mkdir(path.dirname(lockDir), { recursive: true });
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      if (await isStaleLock(lockDir)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - startedAt > LOCK_WAIT_MS) {
        throw new Error("timed out waiting for local server lock");
      }
      await sleep(150);
    }
  }

  try {
    return await task();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function readManagedServerMetadata(
  workspaceRoot: string,
): Promise<ManagedServerMetadata | null> {
  const metadataPath = getWorkspaceStatePaths(workspaceRoot).metadataPath;
  try {
    const raw = await readFile(metadataPath, "utf-8");
    return JSON.parse(raw) as ManagedServerMetadata;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeManagedServerMetadata(
  workspaceRoot: string,
  metadata: ManagedServerMetadata,
): Promise<void> {
  const paths = getWorkspaceStatePaths(workspaceRoot);
  await mkdir(paths.dataDir, { recursive: true });
  const tempPath = `${paths.metadataPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
  await rename(tempPath, paths.metadataPath);
}

async function clearManagedServerMetadata(workspaceRoot: string): Promise<void> {
  const metadataPath = getWorkspaceStatePaths(workspaceRoot).metadataPath;
  await rm(metadataPath, { force: true });
}

function globalAuthFilePath(): string {
  if (process.env.CHUMP_AUTH_FILE) {
    return process.env.CHUMP_AUTH_FILE;
  }
  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, "chump", "auth.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "chump", "auth.json");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "chump", "auth.json");
  }
  return path.join(os.homedir(), ".local", "share", "chump", "auth.json");
}

function managedIdleTimeoutSeconds(): string {
  return process.env.CHUMP_MANAGED_SERVER_IDLE_TIMEOUT ?? String(DEFAULT_MANAGED_IDLE_TIMEOUT_SECONDS);
}

type ServerCommand = {
  file: string;
  args: string[];
  source: "local" | "installed";
};

function resolveServerCommand(): ServerCommand {
  const sourcePath = fileURLToPath(import.meta.url);
  const appDir = path.dirname(sourcePath);
  const repoRoot = path.resolve(appDir, "..", "..", "..");
  const siblingServerDir = path.join(repoRoot, "server");
  const siblingProject = path.join(siblingServerDir, "pyproject.toml");

  let command: ServerCommand;
  if (existsSync(siblingProject)) {
    command = {
      file: "uv",
      args: ["run", "--directory", siblingServerDir, "chump-server"],
      source: "local",
    };
  } else {
    command = {
      file: "uvx",
      args: ["--from", "chump-server", "chump-server"],
      source: "installed",
    };
  }

  if (!commandIsAvailableSync(command.file)) {
    throw new Error(
      `${command.file} is not installed or not in PATH.\n\nInstall uv:\n${getUvInstallInstructions()}`,
    );
  }

  return command;
}

function commandIsAvailableSync(command: string): boolean {
  const shellCmd = process.platform === "win32" ? "where" : "which";
  try {
    return spawnSync(shellCmd, [command], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function getUvInstallInstructions(): string {
  if (process.platform === "win32") {
    return '  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"';
  }
  return '  curl -LsSf https://astral.sh/uv/install.sh | sh';
}

async function isStaleLock(lockDir: string): Promise<boolean> {
  try {
    const stats = await stat(lockDir);
    return Date.now() - stats.mtimeMs > LOCK_STALE_MS;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to resolve local server port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForHealthyServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerHealthy(url)) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for server at ${url}`);
}

async function waitForServerExit(url: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isServerHealthy(url))) {
      return true;
    }
    await sleep(150);
  }
  return false;
}

async function isServerHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function assertServerHealthy(url: string): Promise<void> {
  if (await isServerHealthy(url)) {
    return;
  }
  throw new Error(`could not reach server at ${url}`);
}

async function readServerHealth(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function managedServerMatchesEnvironment(url: string): Promise<boolean> {
  const health = await readServerHealth(url);
  if (!health) {
    return false;
  }

  return [
    matchesEnvString("CHUMP_PROVIDER", health.provider),
    matchesEnvString("CHUMP_MODEL", health.model),
    matchesEnvNumber("CHUMP_MAX_STEPS", health.max_steps),
    matchesEnvNumber("CHUMP_COMMAND_TIMEOUT", health.command_timeout),
    matchesReasoningEnv(health.reasoning),
  ].every(Boolean);
}

async function managedServerIsReusable(metadata: ManagedServerMetadata): Promise<boolean> {
  return managedServerMatchesCommand(metadata) &&
    await managedServerMatchesEnvironment(metadata.url);
}

function managedServerMatchesCommand(metadata: ManagedServerMetadata): boolean {
  const expected = resolveServerCommand();
  return metadata.command === expected.file &&
    metadata.command_source === expected.source &&
    JSON.stringify(metadata.command_args) === JSON.stringify(expected.args);
}

function matchesEnvString(name: string, actual: unknown): boolean {
  const expected = process.env[name];
  if (expected === undefined) {
    return true;
  }
  if (name === "CHUMP_PROVIDER") {
    return normalizeProviderName(actual) === normalizeProviderName(expected);
  }
  return actual === expected;
}

function matchesEnvNumber(name: string, actual: unknown): boolean {
  const rawExpected = process.env[name];
  if (rawExpected === undefined) {
    return true;
  }
  return actual === Number(rawExpected);
}

function matchesReasoningEnv(actual: unknown): boolean {
  const expectedEffort = process.env.CHUMP_REASONING_EFFORT;
  const expectedBudget = process.env.CHUMP_REASONING_BUDGET;
  if (expectedEffort === undefined && expectedBudget === undefined) {
    return true;
  }
  if (!actual || typeof actual !== "object") {
    return false;
  }
  const reasoning = actual as Record<string, unknown>;
  if (expectedEffort !== undefined && reasoning.effort !== expectedEffort) {
    return false;
  }
  if (expectedBudget !== undefined && reasoning.budget !== Number(expectedBudget)) {
    return false;
  }
  return true;
}

function buildServerUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function normalizeProviderName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "workersai") {
    return "workers_ai";
  }
  return normalized;
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isMissingProcessError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
