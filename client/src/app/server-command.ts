import { existsSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  canInstallServerRuntime,
  installServerRuntime,
  installedServerRuntimePath,
} from "./server-runtime-install.ts";

export type ServerCommand = {
  file: string;
  args: string[];
  source: "env" | "local" | "bundled";
};

export async function resolveServerCommand(): Promise<ServerCommand> {
  const override = resolveServerCommandOverride();
  if (override) return override;

  const local = resolveLocalServerCommand();
  if (local) return local;

  const bundled = resolveBundledServerCommand();
  if (bundled) return bundled;

  if (canInstallServerRuntime()) {
    return {
      file: await installServerRuntime(),
      args: [],
      source: "bundled",
    };
  }

  throw new Error(
    "No chump-server runtime was found.\n\n" +
      "Reinstall Chump, or set CHUMP_SERVER_BIN to a server executable for development.",
  );
}

export function globalAuthFilePath(): string {
  if (process.env.CHUMP_AUTH_FILE) return process.env.CHUMP_AUTH_FILE;
  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, "chump", "auth.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "chump", "auth.json");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      "chump",
      "auth.json",
    );
  }
  return path.join(os.homedir(), ".local", "share", "chump", "auth.json");
}

export function fffSearchCommand(): string {
  const entrypoint = fileURLToPath(import.meta.url);
  const sourceEntrypoint = path.resolve(path.dirname(entrypoint), "..", "chump.ts");
  const command = process.execPath.endsWith("node")
    ? ["bun", sourceEntrypoint, "__fff-search"]
    : [process.execPath, "__fff-search"];
  return JSON.stringify(command);
}

export function rotateServerLog(logPath: string): void {
  if (!existsSync(logPath)) return;
  const previousPath = `${logPath}.previous`;
  try {
    rmSync(previousPath, { force: true });
    renameSync(logPath, previousPath);
  } catch {
    // Opening the active log with `w` still prevents unbounded accumulation.
  }
}

export function resolveLocalServerCommand(): ServerCommand | null {
  const sourcePath = fileURLToPath(import.meta.url);
  const appDir = path.dirname(sourcePath);
  const repoRoot = path.resolve(appDir, "..", "..", "..");
  const siblingServerDir = path.join(repoRoot, "server");
  const siblingProject = path.join(siblingServerDir, "pyproject.toml");

  if (!existsSync(siblingProject)) return null;
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

function resolveServerCommandOverride(): ServerCommand | null {
  const file = process.env.CHUMP_SERVER_BIN?.trim();
  if (!file) return null;
  return {
    file,
    args: parseServerArgs(process.env.CHUMP_SERVER_ARGS),
    source: "env",
  };
}

function resolveBundledServerCommand(): ServerCommand | null {
  for (const candidate of bundledServerCandidates()) {
    if (existsSync(candidate)) {
      return { file: candidate, args: [], source: "bundled" };
    }
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
  const installedRuntime = canInstallServerRuntime()
    ? installedServerRuntimePath()
    : null;
  if (installedRuntime) candidates.push(installedRuntime);
  for (const root of roots) {
    for (const name of names) candidates.push(path.join(root, name));
  }
  return [...new Set(candidates)];
}

function bundledServerExecutableNames(): string[] {
  const extension = process.platform === "win32" ? ".exe" : "";
  return [
    `chump-server-${platformAssetSuffix()}${extension}`,
    `chump-server${extension}`,
  ];
}

function platformAssetSuffix(): string {
  const platform = process.platform === "darwin"
    ? "darwin"
    : process.platform === "win32"
      ? "windows"
      : process.platform;
  const architecture = process.arch === "x64" ? "x64" : process.arch;
  return `${platform}-${architecture}`;
}

function parseServerArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (
    !Array.isArray(parsed) ||
    !parsed.every((value) => typeof value === "string")
  ) {
    throw new Error("CHUMP_SERVER_ARGS must be a JSON array of strings");
  }
  return parsed;
}

function commandIsAvailableSync(command: string): boolean {
  const shellCommand = process.platform === "win32" ? "where" : "which";
  try {
    return spawnSync(shellCommand, [command], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function getUvInstallInstructions(): string {
  if (process.platform === "win32") {
    return '  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"';
  }
  return "  curl -LsSf https://astral.sh/uv/install.sh | sh";
}
