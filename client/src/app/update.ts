import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { globalConfigDir } from "./config.ts";
import { CHUMP_CLIENT_VERSION } from "./generated-version.ts";

const PACKAGE_NAME = "chump-agent";
const NPM_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const GITHUB_RELEASES_API = "https://api.github.com/repos/Abdulmumin1/chump/releases?per_page=30";
const GITHUB_RELEASE_BASE = "https://github.com/Abdulmumin1/chump/releases/download";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2_500;

type LatestPackage = {
  version?: unknown;
};

type GitHubRelease = {
  tag_name?: unknown;
};

type UpdateCache = {
  checkedAt: number;
  latestVersion: string;
  latestServerVersion?: string;
};

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  currentServerVersion?: string | null;
  latestServerVersion?: string | null;
  serverUpdateAvailable?: boolean;
};

export function currentClientVersion(): string {
  return CHUMP_CLIENT_VERSION;
}

export async function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  if (!options.force && updateCheckDisabled()) {
    return null;
  }

  const currentVersion = currentClientVersion();
  const cached =
    !options.force
      ? await readUpdateCache()
      : null;

  const [resolvedLatest, latestServerVersion, currentServerVersion] = await Promise.all([
    cached?.latestVersion ?? fetchLatestVersion(),
    cached?.latestServerVersion ?? fetchLatestServerVersion(),
    isStandaloneBinary() ? readBundledServerVersion() : Promise.resolve(null),
  ]);
  if (resolvedLatest || latestServerVersion) {
    await writeUpdateCache({
      latestVersion: resolvedLatest ?? currentVersion,
      latestServerVersion: latestServerVersion ?? undefined,
    }).catch(() => {});
  }

  if (!resolvedLatest && !latestServerVersion) {
    return null;
  }

  return {
    currentVersion,
    latestVersion: resolvedLatest ?? currentVersion,
    updateAvailable: resolvedLatest !== null && compareVersions(resolvedLatest, currentVersion) > 0,
    currentServerVersion,
    latestServerVersion,
    serverUpdateAvailable: currentServerVersion !== null &&
      latestServerVersion !== null &&
      compareVersions(latestServerVersion, currentServerVersion) > 0,
  };
}

export async function maybeRenderUpdateNotice(): Promise<string | null> {
  const info = await checkForUpdate().catch(() => null);
  return formatUpdateNotice(info);
}

export function formatUpdateNotice(info: UpdateInfo | null): string | null {
  if (!info) {
    return null;
  }
  const notices: string[] = [];
  if (info.updateAvailable) {
    notices.push(`chump ${info.currentVersion} -> ${info.latestVersion}`);
  }
  if (info.serverUpdateAvailable && info.latestServerVersion) {
    const current = info.currentServerVersion ? ` ${info.currentServerVersion}` : "";
    notices.push(`server${current} -> ${info.latestServerVersion}`);
  }
  if (notices.length === 0) {
    return null;
  }
  return `update available: ${notices.join(", ")}; run \`chump update\``;
}

export async function runUpdateCommand(): Promise<void> {
  const info = await checkForUpdate({ force: true });
  if (!info) {
    throw new Error("could not check for updates");
  }

  const force = process.env.CHUMP_UPDATE_FORCE === "1";
  if (!info.updateAvailable && !info.serverUpdateAvailable && !force) {
    const serverSuffix = info.currentServerVersion
      ? `, server ${info.currentServerVersion}`
      : "";
    console.log(`chump is up to date (${info.currentVersion}${serverSuffix})`);
    return;
  }

  if (isStandaloneBinary()) {
    await updateStandaloneBinary(info);
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

async function fetchLatestServerVersion(): Promise<string | null> {
  const tag = await fetchLatestServerTag();
  return tag?.replace(/^chump-server-v/, "") ?? null;
}

async function fetchLatestServerTag(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(GITHUB_RELEASES_API, {
      headers: { accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const releases = await response.json() as GitHubRelease[];
    const tag = releases
      .map((release) => release.tag_name)
      .find((value): value is string => typeof value === "string" && value.startsWith("chump-server-v"));
    return tag ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function updateStandaloneBinary(info: UpdateInfo): Promise<void> {
  const suffix = releasePlatformSuffix();
  if (!suffix) {
    throw new Error(`no standalone package asset is available for ${process.platform}/${process.arch}`);
  }

  if (process.platform === "win32") {
    console.log("Windows cannot safely replace a running .exe in place.");
    console.log("update with: powershell -ExecutionPolicy ByPass -c \"irm https://chump.yaqeen.me/install.ps1 | iex\"");
    return;
  }

  const installDir = path.dirname(process.execPath);
  if (info.updateAvailable || process.env.CHUMP_UPDATE_FORCE === "1") {
    const tag = `chump-agent@${info.latestVersion}`;
    const assetUrl = `${GITHUB_RELEASE_BASE}/${encodeURIComponent(tag)}/chump-${suffix}.tar.gz`;
    console.log(`installing ${assetUrl}`);
    await runCommand("bash", [
      "-c",
      "curl -fsSL https://chump.yaqeen.me/install.sh | bash -s -- --install-dir \"$CHUMP_INSTALL_DIR\" --no-modify-path",
    ], {
      CHUMP_INSTALL_DIR: installDir,
      VERSION: tag,
    });
    console.log(`updated chump to ${info.latestVersion}`);
  }

  if (info.serverUpdateAvailable || process.env.CHUMP_UPDATE_FORCE === "1") {
    const latestServerTag = info.latestServerVersion
      ? `chump-server-v${info.latestServerVersion}`
      : await fetchLatestServerTag();
    if (!latestServerTag) {
      throw new Error("could not determine latest chump-server release");
    }
    await updateBundledServerBinary(latestServerTag, installDir, suffix);
    console.log(`updated bundled chump-server to ${latestServerTag.replace(/^chump-server-v/, "")}`);
  }
}

async function updateBundledServerBinary(tag: string, installDir: string, suffix: string): Promise<void> {
  const archiveName = serverArchiveAssetName(suffix);
  const archiveUrl = `${GITHUB_RELEASE_BASE}/${encodeURIComponent(tag)}/${archiveName}`;
  const stagedArchive = path.join(installDir, `.${archiveName}.update-${process.pid}`);
  if (await downloadFileIfExists(archiveUrl, stagedArchive)) {
    await installBundledServerArchive(stagedArchive, installDir, suffix);
    return;
  }

  const serverName = serverAssetName(suffix);
  const url = `${GITHUB_RELEASE_BASE}/${encodeURIComponent(tag)}/${serverName}`;
  const serverDir = path.join(installDir, "server");
  const target = path.join(serverDir, serverName);
  const staged = path.join(installDir, `.${serverName}.update-${process.pid}`);
  await mkdir(serverDir, { recursive: true });
  await downloadFile(url, staged);
  await runCommand("chmod", ["755", staged]);
  await rm(path.join(installDir, serverName), { force: true });
  await runCommand("mv", ["-f", staged, target]);
}

async function downloadFile(url: string, targetPath: string): Promise<void> {
  const response = await fetch(url, { headers: { accept: "application/octet-stream" } });
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
}

async function downloadFileIfExists(url: string, targetPath: string): Promise<boolean> {
  const response = await fetch(url, { headers: { accept: "application/octet-stream" } });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
  return true;
}

async function installBundledServerArchive(archivePath: string, installDir: string, suffix: string): Promise<void> {
  const extractDir = path.join(installDir, `.server.extract-${process.pid}`);
  const stagedServer = path.join(installDir, `.server.update-${process.pid}`);
  const runtimeDir = path.join(extractDir, `chump-server-${suffix}`);
  const executable = path.join(runtimeDir, serverExecutableName());

  await rm(extractDir, { recursive: true, force: true });
  await rm(stagedServer, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  try {
    await runCommand("tar", ["-xzf", archivePath, "-C", extractDir]);
    if (!existsSync(executable)) {
      throw new Error(`server archive is missing ${serverExecutableName()}`);
    }
    await chmod(executable, 0o755);
    await rename(runtimeDir, stagedServer);
    await rm(path.join(installDir, "server"), { recursive: true, force: true });
    await rm(path.join(installDir, serverAssetName(suffix)), { force: true });
    await rename(stagedServer, path.join(installDir, "server"));
  } finally {
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await rm(stagedServer, { recursive: true, force: true }).catch(() => {});
    await rm(archivePath, { force: true }).catch(() => {});
  }
}

async function updateNpmInstall(): Promise<void> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await runCommand(npm, ["install", "-g", `${PACKAGE_NAME}@latest`]);
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: "inherit",
      windowsHide: true,
    });
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

function releasePlatformSuffix(): string | null {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "darwin-x64";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "linux-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "windows-x64";
  }
  return null;
}

function serverAssetName(suffix: string): string {
  return process.platform === "win32"
    ? `chump-server-${suffix}.exe`
    : `chump-server-${suffix}`;
}

function serverArchiveAssetName(suffix: string): string {
  return `chump-server-${suffix}.tar.gz`;
}

function serverExecutableName(): string {
  return process.platform === "win32" ? "chump-server.exe" : "chump-server";
}

async function readBundledServerVersion(): Promise<string | null> {
  const serverPath = bundledServerPath();
  if (!existsSync(serverPath)) {
    return null;
  }
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  let failedToStart = false;
  const child = spawn(serverPath, [], {
    env: {
      ...process.env,
      CHUMP_PORT: String(port),
      CHUMP_MANAGED_SERVER_IDLE_TIMEOUT: "5",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {
    failedToStart = true;
  });
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const version = await fetchServerHealthVersion(port);
      if (version) {
        return version;
      }
      if (failedToStart || child.exitCode !== null) {
        return "0.0.0";
      }
      await delay(100);
    }
    return "0.0.0";
  } finally {
    child.kill();
  }
}

function bundledServerPath(): string {
  const suffix = releasePlatformSuffix();
  if (!suffix) {
    return "";
  }
  const installDir = path.dirname(process.execPath);
  const names = [
    serverAssetName(suffix),
    process.platform === "win32" ? "chump-server.exe" : "chump-server",
  ];
  const roots = [
    installDir,
    path.join(installDir, "server"),
  ];
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return path.join(installDir, serverAssetName(suffix));
}

async function fetchServerHealthVersion(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as { version?: unknown };
    return typeof payload.version === "string" ? normalizeReleaseVersion(payload.version) : null;
  } catch {
    return null;
  }
}

function normalizeReleaseVersion(version: string): string {
  if (version.includes(".dev") || version.includes("+")) {
    return "0.0.0";
  }
  return version.split(/[+-]/)[0].replace(/\.dev\d*$/, "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function readUpdateCache(): Promise<UpdateCache | null> {
  try {
    const raw = await readFile(updateCachePath(), "utf8");
    const cache = JSON.parse(raw) as UpdateCache;
    if (Date.now() - cache.checkedAt > UPDATE_CHECK_INTERVAL_MS) {
      return null;
    }
    return typeof cache.latestVersion === "string" && Number.isFinite(cache.checkedAt) ? cache : null;
  } catch {
    return null;
  }
}

async function writeUpdateCache(cache: Omit<UpdateCache, "checkedAt">): Promise<void> {
  const cachePath = updateCachePath();
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify({ checkedAt: Date.now(), ...cache }, null, 2)}\n`, "utf8");
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
