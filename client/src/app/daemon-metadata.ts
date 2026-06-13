import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getGlobalStatePaths } from "./state-paths.ts";

export const DAEMON_PROTOCOL_VERSION = 1;

export type DaemonMetadata = {
  protocolVersion: typeof DAEMON_PROTOCOL_VERSION;
  pid: number;
  host: "127.0.0.1";
  port: number;
  url: string;
  startedAt: string;
};

export type DaemonMetadataStoreOptions = {
  metadataPath?: string;
  processIsAlive?: (pid: number) => boolean;
};

export class DaemonMetadataStore {
  readonly metadataPath: string;
  private readonly processIsAlive: (pid: number) => boolean;

  constructor(options: DaemonMetadataStoreOptions = {}) {
    this.metadataPath = options.metadataPath ?? getGlobalStatePaths().daemonMetadataPath;
    this.processIsAlive = options.processIsAlive ?? defaultProcessIsAlive;
  }

  async read(): Promise<DaemonMetadata | null> {
    let raw: string;
    try {
      raw = await readFile(this.metadataPath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isDaemonMetadata(parsed)) {
      throw new Error(`invalid Chump daemon metadata: ${this.metadataPath}`);
    }
    return parsed;
  }

  async readActive(): Promise<DaemonMetadata | null> {
    const metadata = await this.read();
    if (!metadata) return null;
    if (this.processIsAlive(metadata.pid)) return metadata;
    await this.clear(metadata.pid);
    return null;
  }

  async write(metadata: DaemonMetadata): Promise<void> {
    if (!isDaemonMetadata(metadata)) {
      throw new Error("refusing to write invalid Chump daemon metadata");
    }
    await mkdir(path.dirname(this.metadataPath), { recursive: true });
    const temporaryPath = `${this.metadataPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.metadataPath);
  }

  async clear(expectedPid?: number): Promise<boolean> {
    if (expectedPid !== undefined) {
      const current = await this.read();
      if (!current || current.pid !== expectedPid) return false;
    }
    try {
      await rm(this.metadataPath);
      return true;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }
}

export function createDaemonMetadata(
  pid: number,
  port: number,
  startedAt = new Date().toISOString(),
): DaemonMetadata {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`invalid daemon pid: ${pid}`);
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid daemon port: ${port}`);
  }
  return {
    protocolVersion: DAEMON_PROTOCOL_VERSION,
    pid,
    host: "127.0.0.1",
    port,
    url: `http://127.0.0.1:${port}`,
    startedAt,
  };
}

function isDaemonMetadata(value: unknown): value is DaemonMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  return (
    metadata.protocolVersion === DAEMON_PROTOCOL_VERSION &&
    typeof metadata.pid === "number" &&
    Number.isSafeInteger(metadata.pid) &&
    metadata.pid > 0 &&
    metadata.host === "127.0.0.1" &&
    typeof metadata.port === "number" &&
    Number.isSafeInteger(metadata.port) &&
    metadata.port >= 1 &&
    metadata.port <= 65_535 &&
    metadata.url === `http://127.0.0.1:${metadata.port}` &&
    typeof metadata.startedAt === "string" &&
    !Number.isNaN(Date.parse(metadata.startedAt))
  );
}

function defaultProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, "EPERM");
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
