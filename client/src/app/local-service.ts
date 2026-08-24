import { closeSync, mkdirSync, openSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { CHUMP_SERVER_VERSION } from "./generated-version.ts";
import {
  fffSearchCommand,
  globalAuthFilePath,
  resolveServerCommand,
  rotateServerLog,
  type ServerCommand,
} from "./server-command.ts";
import { prepareNpmServerRuntime } from "./server-runtime-install.ts";
import { getGlobalStatePaths } from "./state-paths.ts";

export const SERVICE_REGISTRATION_VERSION = 1;
export const DEFAULT_SERVICE_PORT = 38136;
const SERVICE_START_TIMEOUT_MS = 30_000;
const SERVICE_STOP_TIMEOUT_MS = 5_000;
const SERVICE_LOCK_STALE_MS = 30_000;

export type ServiceRegistration = {
  version: typeof SERVICE_REGISTRATION_VERSION;
  url: string;
  pid: number;
  serverVersion: string;
  instanceId: string;
  token: string;
  startedAt: string;
};

type ServiceHealth = {
  status: "ok";
  service: "chump-server";
  version: string;
  instance_id: string;
  process_id: number;
};

export type LocalProjectTarget = {
  service: ServiceRegistration;
  project: Project;
};

export type Project = {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: number;
  lastOpenedAt: number;
};

export class ServiceRegistrationStore {
  readonly path: string;

  constructor(registrationPath = getGlobalStatePaths().serviceRegistrationPath) {
    this.path = registrationPath;
  }

  async read(): Promise<ServiceRegistration | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
    try {
      return parseServiceRegistration(JSON.parse(raw), this.path);
    } catch {
      await rm(this.path, { force: true });
      return null;
    }
  }

  async clear(instanceId: string): Promise<boolean> {
    const current = await this.read();
    if (!current || current.instanceId !== instanceId) return false;
    await rm(this.path, { force: true });
    return true;
  }

}

export async function ensureLocalService(): Promise<ServiceRegistration> {
  await prepareNpmServerRuntime();
  return await withServiceLock(async () => {
    const command = await resolveServerCommand();
    const store = new ServiceRegistrationStore();
    const existing = await store.read();
    if (existing) {
      const health = await readServiceHealth(existing.url);
      if (serviceHealthMatchesRegistration(health, existing)) {
        if (serviceVersionIsCompatible(command.source, existing.serverVersion)) {
          return existing;
        }
        await requestServiceShutdown(existing);
        await waitForServiceExit(existing, SERVICE_STOP_TIMEOUT_MS);
        await store.clear(existing.instanceId);
      } else {
        await store.clear(existing.instanceId);
      }
    }
    return await spawnLocalService(command, store);
  });
}

export async function ensureLocalProjectTarget(
  workspacePath: string,
): Promise<LocalProjectTarget> {
  const service = await ensureLocalService();
  return await registerLocalProjectTarget(service, workspacePath);
}

export async function registerLocalProjectTarget(
  service: ServiceRegistration,
  workspacePath: string,
  name?: string,
): Promise<LocalProjectTarget> {
  const response = await fetch(`${service.url}/projects`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${service.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ workspacePath, approved: true, ...(name ? { name } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(value) || !isProject(value.project)) {
    throw new Error(`failed to register workspace (${response.status})`);
  }
  return { service, project: value.project };
}

export async function listLocalProjects(
  service: ServiceRegistration,
): Promise<Project[]> {
  const response = await fetch(`${service.url}/projects`, {
    headers: { authorization: `Bearer ${service.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const value: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !isRecord(value) ||
    !Array.isArray(value.projects) ||
    !value.projects.every(isProject)
  ) {
    throw new Error(`failed to list projects (${response.status})`);
  }
  return value.projects;
}

export async function removeLocalProject(
  service: ServiceRegistration,
  projectId: string,
): Promise<boolean> {
  const response = await fetch(
    `${service.url}/projects/${encodeURIComponent(projectId)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${service.token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`failed to remove project (${response.status})`);
  }
  return true;
}

export async function runLocalServiceForeground(): Promise<{
  started: boolean;
  registration: ServiceRegistration;
}> {
  await prepareNpmServerRuntime();
  const result = await withServiceLock(async () => {
    const store = new ServiceRegistrationStore();
    const existing = await store.read();
    if (existing) {
      const health = await readServiceHealth(existing.url);
      if (serviceHealthMatchesRegistration(health, existing)) {
        return { started: false as const, registration: existing, child: null };
      }
      await store.clear(existing.instanceId);
    }

    const command = await resolveServerCommand();
    const child = spawn(command.file, [...command.args, "--register"], {
      detached: false,
      env: serviceEnvironment(),
      stdio: "inherit",
      windowsHide: false,
    });
    const registration = await waitForStartedChild(
      child,
      store,
      command.source,
    );
    return { started: true as const, registration, child };
  });
  if (!result.started || result.child === null) return result;
  await waitForForegroundExit(result.child);
  return { started: true, registration: result.registration };
}

export async function readHealthyLocalService(): Promise<ServiceRegistration | null> {
  let registration: ServiceRegistration | null;
  try {
    registration = await new ServiceRegistrationStore().read();
  } catch {
    return null;
  }
  if (!registration) return null;
  const health = await readServiceHealth(registration.url);
  return serviceHealthMatchesRegistration(health, registration)
    ? registration
    : null;
}

export async function stopLocalService(): Promise<string> {
  return await withServiceLock(async () => {
    const store = new ServiceRegistrationStore();
    const registration = await store.read();
    if (!registration) return "service is not running";
    const health = await readServiceHealth(registration.url);
    if (!serviceHealthMatchesRegistration(health, registration)) {
      await store.clear(registration.instanceId);
      return "service is not running";
    }
    await requestServiceShutdown(registration);
    await waitForServiceExit(registration, SERVICE_STOP_TIMEOUT_MS);
    await store.clear(registration.instanceId);
    return `service stopped at ${registration.url}`;
  });
}

export function parseServiceRegistration(
  value: unknown,
  registrationPath = "service.json",
): ServiceRegistration {
  if (!isRecord(value)) {
    throw invalidRegistration(registrationPath);
  }
  const url = parseLoopbackServiceUrl(value.url, registrationPath);
  if (
    value.version !== SERVICE_REGISTRATION_VERSION ||
    !isPositiveInteger(value.pid) ||
    typeof value.serverVersion !== "string" ||
    !value.serverVersion ||
    typeof value.instanceId !== "string" ||
    !value.instanceId ||
    typeof value.token !== "string" ||
    value.token.length < 32 ||
    typeof value.startedAt !== "string" ||
    Number.isNaN(Date.parse(value.startedAt))
  ) {
    throw invalidRegistration(registrationPath);
  }
  return {
    version: SERVICE_REGISTRATION_VERSION,
    url,
    pid: value.pid,
    serverVersion: value.serverVersion,
    instanceId: value.instanceId,
    token: value.token,
    startedAt: value.startedAt,
  };
}

export function serviceHealthMatchesRegistration(
  health: ServiceHealth | null,
  registration: ServiceRegistration,
): boolean {
  return health !== null &&
    health.status === "ok" &&
    health.service === "chump-server" &&
    health.instance_id === registration.instanceId &&
    health.process_id === registration.pid &&
    health.version === registration.serverVersion;
}

export function serviceVersionIsCompatible(
  commandSource: ServerCommand["source"],
  actualVersion: string,
  expectedVersion = CHUMP_SERVER_VERSION,
): boolean {
  return commandSource !== "bundled" || actualVersion === expectedVersion;
}

async function spawnLocalService(
  command: ServerCommand,
  store: ServiceRegistrationStore,
): Promise<ServiceRegistration> {
  const paths = getGlobalStatePaths();
  await mkdir(paths.dataDir, { recursive: true });
  rotateServerLog(paths.serviceLogPath);
  const logDescriptor = openSync(paths.serviceLogPath, "w", 0o600);
  try {
    const child = spawn(command.file, [...command.args, "--register"], {
      detached: process.platform !== "win32",
      env: serviceEnvironment(),
      stdio: ["ignore", logDescriptor, logDescriptor],
      windowsHide: true,
    });
    child.unref();
    try {
      return await waitForStartedChild(child, store, command.source);
    } catch (error) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The child may already have exited.
      }
      throw new Error(
        `service failed to start; inspect ${paths.serviceLogPath}`,
        { cause: error },
      );
    }
  } finally {
    closeSync(logDescriptor);
  }
}

async function waitForStartedChild(
  child: ChildProcess,
  store: ServiceRegistrationStore,
  commandSource: ServerCommand["source"],
): Promise<ServiceRegistration> {
  const childFailure = new Promise<never>((_resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `service process exited before startup (${signal ?? code ?? "unknown"})`,
        ),
      );
    });
  });
  return await Promise.race([
    waitForHealthyRegistration(store, commandSource, SERVICE_START_TIMEOUT_MS),
    childFailure,
  ]);
}

async function waitForForegroundExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    if (child.exitCode === 0) return;
    throw new Error(`service exited with code ${child.exitCode}`);
  }
  if (child.signalCode === "SIGINT" || child.signalCode === "SIGTERM") return;
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
        resolve();
        return;
      }
      reject(new Error(`service exited with code ${code ?? "unknown"}`));
    });
  });
}

function serviceEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CHUMP_AUTH_FILE: globalAuthFilePath(),
    CHUMP_FFF_COMMAND: fffSearchCommand(),
    CHUMP_HOST: "127.0.0.1",
    CHUMP_SERVICE_PORT: String(configuredServicePort()),
  };
}

async function waitForHealthyRegistration(
  store: ServiceRegistrationStore,
  commandSource: ServerCommand["source"],
  timeoutMs: number,
): Promise<ServiceRegistration> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const registration = await store.read();
    if (registration) {
      const health = await readServiceHealth(registration.url);
      if (
        serviceHealthMatchesRegistration(health, registration) &&
        serviceVersionIsCompatible(commandSource, registration.serverVersion)
      ) {
        return registration;
      }
    }
    await sleep(100);
  }
  throw new Error("timed out waiting for Chump service health");
}

async function requestServiceShutdown(
  registration: ServiceRegistration,
): Promise<void> {
  const response = await fetch(`${registration.url}/service/shutdown`, {
    method: "POST",
    headers: { authorization: `Bearer ${registration.token}` },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    throw new Error(`service shutdown failed with ${response.status}`);
  }
}

async function waitForServiceExit(
  registration: ServiceRegistration,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await readServiceHealth(registration.url);
    if (!serviceHealthMatchesRegistration(health, registration)) return;
    await sleep(100);
  }
  throw new Error(`service did not stop at ${registration.url}`);
}

async function readServiceHealth(url: string): Promise<ServiceHealth | null> {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (
      !isRecord(value) ||
      value.status !== "ok" ||
      value.service !== "chump-server" ||
      typeof value.version !== "string" ||
      typeof value.instance_id !== "string" ||
      !isPositiveInteger(value.process_id)
    ) {
      return null;
    }
    return {
      status: "ok",
      service: "chump-server",
      version: value.version,
      instance_id: value.instance_id,
      process_id: value.process_id,
    };
  } catch {
    return null;
  }
}

async function withServiceLock<T>(task: () => Promise<T>): Promise<T> {
  const lockDir = getGlobalStatePaths().serviceLockDir;
  await mkdir(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + SERVICE_START_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(lockDir);
      await writeFile(
        path.join(lockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
        "utf8",
      );
      break;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      if (await serviceLockIsStale(lockDir)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("timed out waiting for Chump service lock");
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

async function serviceLockIsStale(lockDir: string): Promise<boolean> {
  try {
    const owner = JSON.parse(
      await readFile(path.join(lockDir, "owner.json"), "utf8"),
    ) as unknown;
    if (
      isRecord(owner) &&
      isPositiveInteger(owner.pid) &&
      !processIsRunning(owner.pid)
    ) {
      return true;
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT") && !(error instanceof SyntaxError)) {
      throw error;
    }
  }
  try {
    return Date.now() - (await stat(lockDir)).mtimeMs > SERVICE_LOCK_STALE_MS;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function configuredServicePort(): number {
  const raw = process.env.CHUMP_SERVICE_PORT;
  if (!raw) return DEFAULT_SERVICE_PORT;
  const port = Number(raw);
  if (!isPositiveInteger(port) || port > 65_535) {
    throw new Error(`invalid CHUMP_SERVICE_PORT: ${raw}`);
  }
  return port;
}

function parseLoopbackServiceUrl(value: unknown, registrationPath: string): string {
  if (typeof value !== "string") throw invalidRegistration(registrationPath);
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw invalidRegistration(registrationPath);
    }
    return value.replace(/\/$/, "");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid Chump")) {
      throw error;
    }
    throw invalidRegistration(registrationPath);
  }
}

function invalidRegistration(registrationPath: string): Error {
  return new Error(`invalid Chump service registration: ${registrationPath}`);
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, "EPERM");
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProject(value: unknown): value is Project {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.workspacePath === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.lastOpenedAt === "number";
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
