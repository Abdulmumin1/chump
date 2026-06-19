import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getGlobalStatePaths } from "./state-paths.ts";

const DAEMON_AUTH_VERSION = 1;

type DaemonAuthFile = {
  version: typeof DAEMON_AUTH_VERSION;
  token: string;
  createdAt: string;
};

export type DaemonAuthStoreOptions = {
  authPath?: string;
  createToken?: () => string;
  now?: () => Date;
};

export class DaemonAuthStore {
  readonly authPath: string;
  private readonly createToken: () => string;
  private readonly now: () => Date;

  constructor(options: DaemonAuthStoreOptions = {}) {
    this.authPath = options.authPath ?? getGlobalStatePaths().daemonAuthPath;
    this.createToken = options.createToken ?? generateDaemonToken;
    this.now = options.now ?? (() => new Date());
  }

  async getOrCreateToken(): Promise<string> {
    const existing = await this.read();
    if (existing) return existing.token;

    const auth: DaemonAuthFile = {
      version: DAEMON_AUTH_VERSION,
      token: this.createToken(),
      createdAt: this.now().toISOString(),
    };
    validateAuthFile(auth);
    await this.write(auth);
    return auth.token;
  }

  async readToken(): Promise<string | null> {
    return (await this.read())?.token ?? null;
  }

  private async read(): Promise<DaemonAuthFile | null> {
    let raw: string;
    try {
      raw = await readFile(this.authPath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    validateAuthFile(parsed);
    return parsed;
  }

  private async write(auth: DaemonAuthFile): Promise<void> {
    await mkdir(path.dirname(this.authPath), { recursive: true });
    const temporaryPath = `${this.authPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(auth, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.authPath);
    await chmod(this.authPath, 0o600);
  }
}

export function authorizeBearerHeader(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const suppliedToken = authorization.slice("Bearer ".length);
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function generateDaemonToken(): string {
  return randomBytes(32).toString("base64url");
}

function validateAuthFile(value: unknown): asserts value is DaemonAuthFile {
  if (!value || typeof value !== "object") {
    throw new Error("invalid Chump daemon auth file");
  }
  const auth = value as Record<string, unknown>;
  if (
    auth.version !== DAEMON_AUTH_VERSION ||
    typeof auth.token !== "string" ||
    auth.token.length < 32 ||
    typeof auth.createdAt !== "string" ||
    Number.isNaN(Date.parse(auth.createdAt))
  ) {
    throw new Error("invalid Chump daemon auth file");
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
