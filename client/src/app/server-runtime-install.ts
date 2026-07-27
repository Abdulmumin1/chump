import { existsSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { CHUMP_SERVER_VERSION } from "./generated-version.ts";

const RELEASE_BASE_URL = "https://github.com/Abdulmumin1/chump/releases/download";
const DOWNLOAD_TIMEOUT_MS = 120_000;

export type ServerRuntimeInstallOptions = {
  version: string;
  platform: string;
  executableName: string;
  dataRoot: string;
  releaseBaseUrl: string;
  fetchArchive: (url: string) => Promise<Uint8Array>;
  extractArchive: (archivePath: string, destination: string) => Promise<void>;
  log: (message: string) => void;
};

export function installedServerRuntimePath(): string | null {
  const platform = platformSuffix();
  if (!platform) return null;
  return runtimeExecutablePath(runtimeInstallOptions(platform));
}

export function canInstallServerRuntime(): boolean {
  if (!platformSuffix()) return false;
  const sourcePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(sourcePath), "..", "..");
  return existsSync(path.join(packageRoot, "package.json")) &&
    !existsSync(path.join(packageRoot, "..", "server", "pyproject.toml"));
}

export async function installServerRuntime(): Promise<string> {
  const platform = platformSuffix();
  if (!platform) {
    throw new Error(`no chump-server runtime is available for ${process.platform}/${process.arch}`);
  }
  return await installServerRuntimeWith(runtimeInstallOptions(platform));
}

export async function prepareNpmServerRuntime(): Promise<void> {
  if (process.env.CHUMP_SERVER_BIN || !canInstallServerRuntime()) return;
  const installed = installedServerRuntimePath();
  if (installed && existsSync(installed)) return;
  await installServerRuntime();
}

export async function installServerRuntimeWith(options: ServerRuntimeInstallOptions): Promise<string> {
  validateReleaseSegment(options.version, "server version");
  validateReleaseSegment(options.platform, "platform");
  validateExecutableName(options.executableName);

  const installedExecutable = runtimeExecutablePath(options);
  if (existsSync(installedExecutable)) return installedExecutable;

  const archiveName = `chump-server-${options.platform}.tar.gz`;
  const releaseTag = `chump-server-v${options.version}`;
  const archiveUrl = `${options.releaseBaseUrl}/${releaseTag}/${archiveName}`;
  const temporaryRoot = path.join(
    os.tmpdir(),
    `chump-server-install-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const archivePath = path.join(temporaryRoot, archiveName);
  const extractedRuntime = path.join(temporaryRoot, `chump-server-${options.platform}`);
  const extractedExecutable = path.join(extractedRuntime, options.executableName);
  const runtimeRoot = path.dirname(installedExecutable);

  await mkdir(temporaryRoot, { recursive: true });
  try {
    options.log(`First run: downloading chump-server ${options.version} for ${options.platform}...`);
    const archive = await options.fetchArchive(archiveUrl);
    await writeFile(archivePath, archive, { mode: 0o600 });
    await options.extractArchive(archivePath, temporaryRoot);
    if (!existsSync(extractedExecutable)) {
      throw new Error(`release archive is missing ${options.executableName}`);
    }
    if (!options.platform.startsWith("windows-")) {
      await chmod(extractedExecutable, 0o755);
    }

    await mkdir(path.dirname(runtimeRoot), { recursive: true });
    try {
      await rename(extractedRuntime, runtimeRoot);
    } catch (error) {
      if (!existsSync(installedExecutable)) throw error;
    }
    options.log(`Installed chump-server ${options.version}.`);
    return installedExecutable;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function runtimeInstallOptions(platform: string): ServerRuntimeInstallOptions {
  return {
    version: CHUMP_SERVER_VERSION,
    platform,
    executableName: process.platform === "win32" ? "chump-server.exe" : "chump-server",
    dataRoot: runtimeDataRoot(),
    releaseBaseUrl: RELEASE_BASE_URL,
    fetchArchive: downloadArchive,
    extractArchive,
    log: console.error,
  };
}

function runtimeExecutablePath(options: ServerRuntimeInstallOptions): string {
  return path.join(
    options.dataRoot,
    "runtimes",
    `chump-server-${options.version}-${options.platform}`,
    options.executableName,
  );
}

async function downloadArchive(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: {
      accept: "application/octet-stream",
      "user-agent": "chump-agent-runtime-installer",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`server download failed with HTTP ${response.status}: ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archivePath, "-C", destination], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited with ${code ?? "unknown status"}`));
      }
    });
  });
}

function runtimeDataRoot(): string {
  if (process.env.CHUMP_DATA_DIR) return path.resolve(process.env.CHUMP_DATA_DIR);
  if (process.env.XDG_DATA_HOME) return path.join(process.env.XDG_DATA_HOME, "chump");
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "chump");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "chump",
    );
  }
  return path.join(os.homedir(), ".local", "share", "chump");
}

function platformSuffix(): string | null {
  const platform = process.platform === "darwin"
    ? "darwin"
    : process.platform === "win32"
      ? "windows"
      : process.platform === "linux"
        ? "linux"
        : null;
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  return platform && arch ? `${platform}-${arch}` : null;
}

function validateReleaseSegment(value: string, name: string): void {
  if (!/^[a-zA-Z0-9.-]+$/u.test(value)) {
    throw new Error(`invalid ${name}: ${value}`);
  }
}

function validateExecutableName(value: string): void {
  if (value !== "chump-server" && value !== "chump-server.exe") {
    throw new Error(`invalid server executable name: ${value}`);
  }
}
