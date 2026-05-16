import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export type WorkspaceStatePaths = {
  dataDir: string;
  metadataPath: string;
  lockDir: string;
  logPath: string;
  clientLogPath: string;
};

export function getWorkspaceStatePaths(workspaceRoot: string): WorkspaceStatePaths {
  const dataDir = workspaceStateDir(workspaceRoot);
  migrateLegacyWorkspaceState(workspaceRoot, dataDir);
  return {
    dataDir,
    metadataPath: path.join(dataDir, "server.json"),
    lockDir: path.join(dataDir, "server.lock"),
    logPath: path.join(dataDir, "server.log"),
    clientLogPath: path.join(dataDir, "client.log"),
  };
}

function workspaceStateDir(workspaceRoot: string): string {
  if (process.env.CHUMP_STATE_DIR) {
    return path.resolve(process.env.CHUMP_STATE_DIR);
  }
  return path.join(stateBaseDir(), "workspaces", workspaceStateSlug(workspaceRoot));
}

function stateBaseDir(): string {
  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, "chump");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "chump");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "chump");
  }
  return path.join(os.homedir(), ".local", "state", "chump");
}

function workspaceStateSlug(workspaceRoot: string): string {
  const name = sanitizeSegment(path.basename(path.resolve(workspaceRoot)) || "workspace");
  const digest = createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 16);
  return `${name}-${digest}`;
}

function sanitizeSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "workspace";
}

function migrateLegacyWorkspaceState(workspaceRoot: string, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const legacyDir = path.join(workspaceRoot, ".chump");
  const legacyPaths = [
    path.join(workspaceRoot, ".chump.sqlite3"),
    path.join(legacyDir, "chump.sqlite3"),
    path.join(legacyDir, "server.json"),
    path.join(legacyDir, "server.log"),
    path.join(legacyDir, "server.lock"),
    path.join(legacyDir, "client.log"),
  ];

  for (const source of legacyPaths) {
    moveLegacyPath(source, path.join(dataDir, path.basename(source)));
  }
}

function moveLegacyPath(source: string, destination: string): void {
  if (!existsSync(source)) {
    return;
  }
  if (path.resolve(source) === path.resolve(destination)) {
    return;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    return;
  }
  try {
    renameSync(source, destination);
  } catch (error) {
    if (!isCrossDeviceError(error)) {
      throw error;
    }
    const stats = statSync(source);
    if (stats.isDirectory()) {
      cpSync(source, destination, { recursive: true });
      rmSync(source, { recursive: true, force: true });
      return;
    }
    copyFileSync(source, destination);
    rmSync(source, { force: true });
  }
}

function isCrossDeviceError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EXDEV";
}
