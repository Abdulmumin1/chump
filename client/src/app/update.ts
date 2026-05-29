import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { globalConfigDir } from "./config.ts";
import { CHUMP_CLIENT_VERSION } from "./generated-version.ts";

const PACKAGE_NAME = "chump-agent";
const NPM_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const GITHUB_RELEASE_BASE = "https://github.com/Abdulmumin1/chump/releases/download";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2_500;

type LatestPackage = {
  version?: unknown;
};

type UpdateCache = {
  checkedAt: number;
  latestVersion: string;
};

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
};

export function currentClientVersion(): string {
  return CHUMP_CLIENT_VERSION;
}

export async function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  if (!options.force && updateCheckDisabled()) {
    return null;
  }

  const currentVersion = currentClientVersion();
  const latestVersion =
    !options.force
      ? await readCachedLatestVersion()
      : null;

  const resolvedLatest = latestVersion ?? await fetchLatestVersion();
  if (resolvedLatest) {
    await writeUpdateCache(resolvedLatest).catch(() => {});
  }

  if (!resolvedLatest) {
    return null;
  }

  return {
    currentVersion,
    latestVersion: resolvedLatest,
    updateAvailable: compareVersions(resolvedLatest, currentVersion) > 0,
  };
}

export async function maybeRenderUpdateNotice(): Promise<string | null> {
  const info = await checkForUpdate().catch(() => null);
  if (!info?.updateAvailable) {
    return null;
  }
  return `update available: chump ${info.currentVersion} -> ${info.latestVersion}; run \`chump update\``;
}

export async function runUpdateCommand(): Promise<void> {
  const info = await checkForUpdate({ force: true });
  if (!info) {
    throw new Error("could not check for updates");
  }

  if (!info.updateAvailable && process.env.CHUMP_UPDATE_FORCE !== "1") {
    console.log(`chump is up to date (${info.currentVersion})`);
    return;
  }

  if (isStandaloneBinary()) {
    await updateStandaloneBinary(info.latestVersion);
    console.log(`updated chump to ${info.latestVersion}`);
    return;
  }

  if (isSourceCheckout()) {
    console.log("this chump command is running from a source checkout");
    console.log("update with: git pull && pnpm install && pnpm --filter chump-agent run build");
    return;
  }

  await updateNpmInstall();
}

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(NPM_LATEST_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as LatestPackage;
    return typeof payload.version === "string" ? payload.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function updateStandaloneBinary(version: string): Promise<void> {
  const asset = releaseAssetName();
  if (!asset) {
    throw new Error(`no standalone binary asset is available for ${process.platform}/${process.arch}`);
  }

  if (process.platform === "win32") {
    console.log("Windows cannot safely replace a running .exe in place.");
    console.log("update with: powershell -ExecutionPolicy ByPass -c \"irm https://chump.yaqeen.me/install.ps1 | iex\"");
    return;
  }

  const tag = `chump-agent@${version}`;
  const url = `${GITHUB_RELEASE_BASE}/${encodeURIComponent(tag)}/${asset}`;
  const installPath = process.execPath;
  const tempPath = path.join(path.dirname(installPath), `.${path.basename(installPath)}.update-${process.pid}`);

  await downloadFile(url, tempPath);
  await chmod(tempPath, 0o755);
  try {
    await rename(tempPath, installPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw new Error(
      `failed to replace ${installPath}: ${error instanceof Error ? error.message : String(error)}\n` +
        "try: curl -fsSL https://chump.yaqeen.me/install.sh | bash",
    );
  }
}

async function updateNpmInstall(): Promise<void> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await runCommand(npm, ["install", "-g", `${PACKAGE_NAME}@latest`]);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown status"}`));
    });
  });
}

async function downloadFile(url: string, targetPath: string): Promise<void> {
  const response = await fetch(url, { headers: { accept: "application/octet-stream" } });
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, body);
}

function releaseAssetName(): string | null {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "chump-darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "chump-darwin-x64";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "chump-linux-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "chump-linux-x64";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "chump-windows-x64.exe";
  }
  return null;
}

function isStandaloneBinary(): boolean {
  const name = path.basename(process.execPath).toLowerCase();
  if (name === "node" || name === "node.exe" || name === "bun" || name === "bun.exe") {
    return false;
  }
  return name === "chump" || name === "chump.exe" || name.startsWith("chump-");
}

function isSourceCheckout(): boolean {
  const entrypoint = process.argv[1] ?? "";
  if (entrypoint.includes(`${path.sep}node_modules${path.sep}`)) {
    return false;
  }
  return entrypoint.includes(`${path.sep}client${path.sep}src${path.sep}`) ||
    entrypoint.includes(`${path.sep}client${path.sep}dist${path.sep}`);
}

async function readCachedLatestVersion(): Promise<string | null> {
  const cache = await readUpdateCache();
  if (!cache) {
    return null;
  }
  if (Date.now() - cache.checkedAt > UPDATE_CHECK_INTERVAL_MS) {
    return null;
  }
  return cache.latestVersion;
}

async function readUpdateCache(): Promise<UpdateCache | null> {
  try {
    const raw = await readFile(updateCachePath(), "utf8");
    const cache = JSON.parse(raw) as UpdateCache;
    return typeof cache.latestVersion === "string" && Number.isFinite(cache.checkedAt) ? cache : null;
  } catch {
    return null;
  }
}

async function writeUpdateCache(latestVersion: string): Promise<void> {
  const cachePath = updateCachePath();
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify({ checkedAt: Date.now(), latestVersion }, null, 2)}\n`, "utf8");
}

function updateCachePath(): string {
  return path.join(globalConfigDir(), "update-check.json");
}

function updateCheckDisabled(): boolean {
  return process.stdout.isTTY !== true ||
    process.env.CI === "true" ||
    process.env.CHUMP_NO_UPDATE_CHECK === "1" ||
    process.env.CHUMP_DISABLE_UPDATE_CHECK === "1";
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => Number.isFinite(part) ? part : 0);
}
