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
import { getResolvedConfig } from "./config.ts";
import { ensureDaemonProjectTarget } from "./daemon-client.ts";

const DEFAULT_SERVER_URL = "http://127.0.0.1:8080";
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const SERVER_WAIT_MS = 30_000;
const DEFAULT_MANAGED_IDLE_TIMEOUT_SECONDS = 30;

export function parseCliArgs(argv: string[]): CliOptions {
  let mode: CliMode = "interactive";
  let connectUrl: string | null = null;
  let sessionId: string | null = null;
  let autoStartServer = process.env.CHUMP_SERVER_URL ? false : true;
  let verbose = false;
  let model: string | null = null;
  let thinking: string | null = null;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (value === "-h" || value === "--help") {
      mode = "help";
      continue;
    }

    if (value === "-p" || value === "--print") {
      mode = "print";
      continue;
    }

    if (value === "--verbose") {
      verbose = true;
      continue;
    }

    if (value === "--model" || value === "-m") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("missing model name after -m/--model");
      }
      model = nextValue;
      index += 1;
      continue;
    }

    if (value === "--thinking" || value === "-t") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("missing thinking mode after -t/--thinking");
      }
      if (nextValue !== "none" && nextValue !== "low" && nextValue !== "high" && nextValue !== "xhigh") {
        throw new Error("thinking mode must be one of: none, low, high, xhigh");
      }
      thinking = nextValue;
      index += 1;
      continue;
    }

    if (value === "-v" || value === "--version" || value === "version") {
      mode = "version";
      autoStartServer = false;
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

    if (
      mode !== "print" &&
      (
        value === "client" ||
        value === "server" ||
        value === "status" ||
        value === "stop" ||
        value === "connect" ||
        value === "providers" ||
        value === "update"
      )
    ) {
      mode = value;
      if (value !== "server") {
        autoStartServer = false;
      }
      continue;
    }

    if (!value.startsWith("-")) {
      positional.push(value);
      continue;
    }

    throw new Error(`unknown argument: ${value}`);
  }

  if (mode !== "print" && positional.length > 0) {
    throw new Error(`unknown argument: ${positional[0]}`);
  }

  if (mode !== "print" && mode !== "help" && verbose) {
    throw new Error("--verbose is only supported with -p/--print");
  }

  if (mode !== "print" && mode !== "help" && (model || thinking)) {
    throw new Error("--model and --thinking are only supported with -p/--print");
  }

  if (connectUrl) {
    autoStartServer = false;
  }

  if (mode === "client" || mode === "status" || mode === "stop" || mode === "connect" || mode === "providers") {
    autoStartServer = false;
  }

  return {
    mode,
    connectUrl,
    sessionId,
    autoStartServer,
    printPrompt: positional.length > 0 ? positional.join(" ") : null,
    verbose,
    model,
    thinking,
  };
}

export function printCliUsage(): void {
  console.log("chump [-s <session-id>]");
  console.log("chump -p [--verbose] [--model <provider>/<model>] [--thinking <none|low|high|xhigh>] <prompt>");
  console.log("chump -c <server-url> [-s <session-id>]");
  console.log("chump client [-c <server-url>] [-s <session-id>]");
  console.log("chump server");
  console.log("chump connect");
  console.log("chump app [--web-url <loopback-url>]");
  console.log("chump providers");
  console.log("chump daemon [start|status|stop]");
  console.log("chump projects [list|add|remove]");
  console.log("chump update");
  console.log("chump status [-c <server-url>] [-s <session-id>]");
  console.log("chump stop");
  console.log("chump --version");
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

  if (options.autoStartServer) {
    try {
      const daemonTarget = await ensureDaemonProjectTarget(workspaceRoot);
      return {
        serverUrl: daemonTarget.runtime.serverUrl,
        serverSource: "managed",
        note: `connected through daemon at ${daemonTarget.daemon.url}`,
        metadata: null,
      };
    } catch (error) {
      const started = await ensureManagedServer(workspaceRoot);
      const reason = error instanceof Error ? error.message : String(error);
      return {
        serverUrl: started.metadata.url,
        serverSource: "managed",
        note: `daemon unavailable (${reason}); using local server at ${started.metadata.url}`,
        metadata: started.metadata,
      };
    }
  }

  const metadata = await readManagedServerMetadata(workspaceRoot);
  if (metadata && await isServerHealthy(metadata.url)) {
    if (!(await managedServerIsReusable(metadata, workspaceRoot))) {
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
    await managedServerIsReusable(refreshedMetadata, workspaceRoot)
  ) {
    return {
      serverUrl: refreshedMetadata.url,
      serverSource: "managed",
      note: null,
      metadata: refreshedMetadata,
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

  throw new Error("unreachable server target state");
}

export async function recoverManagedServer(
  workspaceRoot: string,
  previousUrl: string | null = null,
): Promise<{
  started: boolean;
  metadata: ManagedServerMetadata;
}> {
  return await withWorkspaceLock(workspaceRoot, async () => {
    const existing = await readManagedServerMetadata(workspaceRoot);
    if (
      existing &&
      await isServerHealthy(existing.url) &&
      await managedServerIsReusable(existing, workspaceRoot)
    ) {
      return { started: false, metadata: existing };
    }

    const preferredPort =
      existing && (!previousUrl || existing.url === previousUrl) ? existing.port : null;
    const metadata = await spawnManagedServer(workspaceRoot, preferredPort);
    return { started: true, metadata };
  });
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
    const localServer = await findLocalServerWithoutMetadata(workspaceRoot);
    if (!localServer) {
      return "no managed server metadata found";
    }
    await stopServerTargets(localServer.url, [{ pid: localServer.pid }]);
    return `stopped ${localServer.url}`;
  }

  const health = await readServerHealth(metadata.url);
  const targets = stopTargetsForMetadata(metadata, health);
  await signalStopTargets(targets, "SIGTERM");

  let stopped = await waitForServerExit(metadata.url, 5_000);
  if (!stopped) {
    await signalStopTargets(targets, "SIGKILL");
    stopped = await waitForServerExit(metadata.url, 2_000);
  }

  if (!stopped) {
    throw new Error(`failed to stop ${metadata.url}`);
  }

  await clearManagedServerMetadata(workspaceRoot);
  return `stopped ${metadata.url}`;
}

type StopTarget = {
  pid: number;
  processGroup?: boolean;
};

function stopTargetsForMetadata(
  metadata: ManagedServerMetadata,
  health: Record<string, unknown> | null,
): StopTarget[] {
  const targets: StopTarget[] = [];

  if (metadata.process_group_id) {
    targets.push({ pid: metadata.process_group_id, processGroup: true });
  }
  if (metadata.pid) {
    targets.push({ pid: metadata.pid });
  }

  const serverPid = processIdFromHealth(health);
  if (serverPid) {
    targets.push({ pid: serverPid });
  }

  return uniqueStopTargets(targets);
}

function uniqueStopTargets(targets: StopTarget[]): StopTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.processGroup ? "group" : "pid"}:${target.pid}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function stopServerTargets(url: string, targets: StopTarget[]): Promise<void> {
  await signalStopTargets(targets, "SIGTERM");
  let stopped = await waitForServerExit(url, 5_000);
  if (!stopped) {
    await signalStopTargets(targets, "SIGKILL");
    stopped = await waitForServerExit(url, 2_000);
  }
  if (!stopped) {
    throw new Error(`failed to stop ${url}`);
  }
}

async function signalStopTargets(
  targets: StopTarget[],
  signal: NodeJS.Signals,
): Promise<void> {
  for (const target of targets) {
    signalStopTarget(target, signal);
  }
}

function signalStopTarget(target: StopTarget, signal: NodeJS.Signals): void {
  if (target.processGroup && process.platform === "win32") {
    return;
  }

  const pid = target.processGroup ? -target.pid : target.pid;
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

export async function ensureManagedServer(workspaceRoot: string): Promise<{
  started: boolean;
  metadata: ManagedServerMetadata;
}> {
  const current = await readManagedServerMetadata(workspaceRoot);
  if (
    current &&
    await isServerHealthy(current.url) &&
    await managedServerIsReusable(current, workspaceRoot)
  ) {
    return { started: false, metadata: current };
  }

  return await withWorkspaceLock(workspaceRoot, async () => {
    const existing = await readManagedServerMetadata(workspaceRoot);
    if (
      existing &&
      await isServerHealthy(existing.url) &&
      await managedServerIsReusable(existing, workspaceRoot)
    ) {
      return { started: false, metadata: existing };
    }

    if (existing && await isServerHealthy(existing.url)) {
      await stopManagedServer(workspaceRoot);
    }

    const metadata = await spawnManagedServer(workspaceRoot, existing?.port ?? null);
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
        CHUMP_FFF_COMMAND: fffSearchCommand(),
        CHUMP_HOST: "127.0.0.1",
        CHUMP_PORT: String(port),
      },
      stdio: "inherit",
    });

    const metadata: ManagedServerMetadata = {
      url: buildServerUrl(port),
      port,
      pid: child.pid ?? null,
      process_group_id: null,
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

async function spawnManagedServer(
  workspaceRoot: string,
  preferredPort: number | null = null,
): Promise<ManagedServerMetadata> {
  const resolved = getResolvedConfig(workspaceRoot);
  const port = await resolveManagedServerPort(preferredPort ?? resolved.port ?? null);
  const command = resolveServerCommand();
  const paths = getWorkspaceStatePaths(workspaceRoot);
  await mkdir(paths.dataDir, { recursive: true });

  const logFd = openSync(paths.logPath, "a");
  try {
    // On Windows, `detached: true` gives console children their own console
    // window. Keep the child non-detached there so the managed server can run
    // without opening a surprise PowerShell/cmd window; stdio is still routed
    // to the log file and the child is unref'd below.
    const child = spawn(command.file, command.args, {
      cwd: workspaceRoot,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        CHUMP_WORKSPACE_ROOT: workspaceRoot,
        CHUMP_STATE_DIR: paths.dataDir,
        CHUMP_AUTH_FILE: globalAuthFilePath(),
        CHUMP_FFF_COMMAND: fffSearchCommand(),
        CHUMP_HOST: "127.0.0.1",
        CHUMP_PORT: String(port),
        CHUMP_MANAGED_SERVER_IDLE_TIMEOUT: managedIdleTimeoutSeconds(),
      },
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    child.unref();

    const metadata: ManagedServerMetadata = {
      url: buildServerUrl(port),
      port,
      pid: child.pid ?? null,
      process_group_id: process.platform !== "win32" ? child.pid ?? null : null,
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
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore kill errors
      }
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

export async function readManagedServerMetadata(
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

function fffSearchCommand(): string {
  const entrypoint = fileURLToPath(import.meta.url);
  const sourceEntrypoint = path.resolve(path.dirname(entrypoint), "..", "chump.ts");
  const command = process.execPath.endsWith("node")
    ? ["bun", sourceEntrypoint, "__fff-search"]
    : [process.execPath, "__fff-search"];
  return JSON.stringify(command);
}

type ServerCommand = {
  file: string;
  args: string[];
  source: "env" | "local" | "bundled";
};

function resolveServerCommand(): ServerCommand {
  const override = resolveServerCommandOverride();
  if (override) {
    return override;
  }

  const bundled = resolveBundledServerCommand();
  if (bundled) {
    return bundled;
  }

  const sourcePath = fileURLToPath(import.meta.url);
  const appDir = path.dirname(sourcePath);
  const repoRoot = path.resolve(appDir, "..", "..", "..");
  const siblingServerDir = path.join(repoRoot, "server");
  const siblingProject = path.join(siblingServerDir, "pyproject.toml");

  if (existsSync(siblingProject)) {
    const command = {
      file: "uv",
      args: ["run", "--directory", siblingServerDir, "chump-server"],
      source: "local",
    } satisfies ServerCommand;
    if (!commandIsAvailableSync(command.file)) {
      throw new Error(
        `${command.file} is not installed or not in PATH.\n\nInstall uv for repository development:\n${getUvInstallInstructions()}`,
      );
    }
    return command;
  }

  throw new Error(
    "No bundled chump-server binary was found.\n\n" +
      "Install Chump from the platform archive, or set CHUMP_SERVER_BIN to a server executable for development.",
  );
}

function resolveServerCommandOverride(): ServerCommand | null {
  const file = process.env.CHUMP_SERVER_BIN?.trim();
  if (!file) {
    return null;
  }
  const args = parseServerArgs(process.env.CHUMP_SERVER_ARGS);
  return {
    file,
    args,
    source: "env",
  };
}

function resolveBundledServerCommand(): ServerCommand | null {
  for (const candidate of bundledServerCandidates()) {
    if (!existsSync(candidate)) {
      continue;
    }
    return {
      file: candidate,
      args: [],
      source: "bundled",
    };
  }
  return null;
}

function bundledServerCandidates(): string[] {
  const names = bundledServerExecutableNames();
  const execDir = path.dirname(process.execPath);
  const sourcePath = fileURLToPath(import.meta.url);
  const appDir = path.dirname(sourcePath);
  const packageRoot = path.resolve(appDir, "..", "..");
  const roots = [
    execDir,
    path.join(execDir, "server"),
    path.join(execDir, "vendor"),
    path.join(packageRoot, "vendor", "chump-server"),
    path.join(packageRoot, "dist", "server"),
  ];
  const candidates: string[] = [];
  for (const root of roots) {
    for (const name of names) {
      candidates.push(path.join(root, name));
    }
  }
  return [...new Set(candidates)];
}

function bundledServerExecutableNames(): string[] {
  const exe = process.platform === "win32" ? ".exe" : "";
  return [
    `chump-server-${platformAssetSuffix()}${exe}`,
    `chump-server${exe}`,
  ];
}

function platformAssetSuffix(): string {
  const platform =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "windows"
        : process.platform;
  const arch = process.arch === "x64" ? "x64" : process.arch;
  return `${platform}-${arch}`;
}

function parseServerArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error("CHUMP_SERVER_ARGS must be a JSON array of strings");
  }
  return parsed;
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

async function resolveManagedServerPort(preferredPort: number | null): Promise<number> {
  if (preferredPort !== null && await isPortAvailable(preferredPort)) {
    return preferredPort;
  }
  return await findAvailablePort();
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
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

async function isServerHealthy(url: string, timeoutMs: number = 1_000): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function assertServerHealthy(url: string): Promise<void> {
  // For remote or tunneled connections (like onlocal.dev), a single 1-second request can easily time out on a cold start
  // due to DNS resolution, SSL handshake, or tunnel wakeup latency.
  // We try up to 3 times with a 2-second timeout per attempt to make connection establishment highly resilient.
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await isServerHealthy(url, 2_000)) {
      return;
    }
    if (attempt < 3) {
      await sleep(250 * attempt);
    }
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

async function findLocalServerWithoutMetadata(
  workspaceRoot: string,
): Promise<{ url: string; pid: number } | null> {
  for (const url of localStopCandidateUrls(workspaceRoot)) {
    const health = await readServerHealth(url);
    if (!health || !serverHealthMatchesWorkspace(health, workspaceRoot)) {
      continue;
    }
    const pid = processIdFromHealth(health);
    if (pid) {
      return { url, pid };
    }
  }

  for (const candidate of localChumpServerProcessCandidates()) {
    const health = await readServerHealth(candidate.url);
    if (!health || !serverHealthMatchesWorkspace(health, workspaceRoot)) {
      continue;
    }
    const pid = processIdFromHealth(health) ?? candidate.pid;
    return { url: candidate.url, pid };
  }

  return null;
}

function localStopCandidateUrls(workspaceRoot: string): string[] {
  const resolved = getResolvedConfig(workspaceRoot);
  const urls = [
    process.env.CHUMP_SERVER_URL,
    resolved.serverUrl,
    buildServerUrl(resolved.port ?? 8080),
  ].filter((url): url is string => typeof url === "string" && url.length > 0);

  return [...new Set(urls.map(normalizeServerBaseUrl).filter(isLocalServerUrl))];
}

function localChumpServerProcessCandidates(): Array<{ url: string; pid: number }> {
  if (process.platform === "win32") {
    return [];
  }

  const pids = localChumpServerPids();
  const candidates: Array<{ url: string; pid: number }> = [];
  for (const pid of pids) {
    for (const url of listeningUrlsForPid(pid)) {
      candidates.push({ url, pid });
    }
  }
  return candidates;
}

function localChumpServerPids(): number[] {
  const result = spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  const currentPid = process.pid;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      const pid = Number(match[1]);
      const command = match[2];
      if (
        !Number.isInteger(pid) ||
        pid <= 0 ||
        pid === currentPid ||
        !/Chump Agent \(Server\)|chump-server/.test(command)
      ) {
        return null;
      }
      return pid;
    })
    .filter((pid): pid is number => pid !== null);
}

function listeningUrlsForPid(pid: number): string[] {
  const result = spawnSync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  const urls: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/TCP\s+(?:\[::1\]|::1|127\.0\.0\.1|localhost):(\d+)\s+\(LISTEN\)/);
    if (!match) {
      continue;
    }
    urls.push(buildServerUrl(Number(match[1])));
  }
  return [...new Set(urls)];
}

function normalizeServerBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function isLocalServerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function serverHealthMatchesWorkspace(
  health: Record<string, unknown>,
  workspaceRoot: string,
): boolean {
  return typeof health.workspace_root === "string" &&
    path.resolve(health.workspace_root) === path.resolve(workspaceRoot);
}

function processIdFromHealth(health: Record<string, unknown> | null): number | null {
  const pid = Number(health?.process_id);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return null;
  }
  return pid;
}

async function managedServerMatchesEnvironment(url: string, workspaceRoot: string): Promise<boolean> {
  const health = await readServerHealth(url);
  if (!health) {
    return false;
  }
  const resolved = getResolvedConfig(workspaceRoot);

  return [
    matchesValueString(resolved.provider, health.provider),
    matchesValueString(resolved.model, health.model),
    matchesValueNumber(resolved.max_steps, health.max_steps),
    matchesValueNumber(resolved.command_timeout, health.command_timeout),
    matchesResolvedReasoning(resolved.reasoning_effort, resolved.reasoning_budget, health.reasoning),
  ].every(Boolean);
}

async function managedServerIsReusable(metadata: ManagedServerMetadata, workspaceRoot: string): Promise<boolean> {
  return managedServerMatchesCommand(metadata) &&
    await managedServerMatchesEnvironment(metadata.url, workspaceRoot);
}

function managedServerMatchesCommand(metadata: ManagedServerMetadata): boolean {
  const expected = resolveServerCommand();
  return metadata.command === expected.file &&
    metadata.command_source === expected.source &&
    JSON.stringify(metadata.command_args) === JSON.stringify(expected.args);
}

function matchesValueString(expected: string | undefined, actual: unknown): boolean {
  if (expected === undefined) {
    return true;
  }
  return String(actual).toLowerCase() === expected.toLowerCase();
}

function matchesValueNumber(expected: number | undefined, actual: unknown): boolean {
  if (expected === undefined) {
    return true;
  }
  return Number(actual) === expected;
}

function matchesResolvedReasoning(
  expectedEffort: string | undefined,
  expectedBudget: number | undefined,
  actual: unknown,
): boolean {
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
  if (expectedBudget !== undefined && reasoning.budget !== expectedBudget) {
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
