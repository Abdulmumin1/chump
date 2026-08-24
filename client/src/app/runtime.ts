import type {
  ChumpConfig,
  CliMode,
  CliOptions,
} from "../core/types.ts";
import { getResolvedConfig } from "./config.ts";
import {
  ensureLocalProjectTarget,
  readHealthyLocalService,
  registerLocalProjectTarget,
  type ServiceRegistration,
} from "./local-service.ts";

const DEFAULT_SERVER_URL = "http://127.0.0.1:8080";

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
  console.log("chump completion <bash|fish|powershell|zsh>");
  console.log("chump app [--web-url <url>]");
  console.log("chump providers");
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
  apiTarget: ChumpConfig["apiTarget"];
}> {
  if (options.connectUrl) {
    const localTarget = await localServiceTargetForUrl(workspaceRoot, options.connectUrl);
    if (localTarget) return localTarget;
    await assertServerHealthy(options.connectUrl);
    return directTarget(options.connectUrl);
  }

  const envServerUrl = process.env.CHUMP_SERVER_URL;
  if (envServerUrl) {
    const localTarget = await localServiceTargetForUrl(workspaceRoot, envServerUrl);
    if (localTarget) return localTarget;
    await assertServerHealthy(envServerUrl);
    return directTarget(envServerUrl);
  }

  if (options.autoStartServer) {
    const target = await ensureLocalProjectTarget(workspaceRoot);
    return serviceTarget(target.service.url, target.project.id, target.service.token);
  }

  const runningService = await readHealthyLocalService();
  if (runningService) {
    return await localServiceProjectTarget(workspaceRoot, runningService);
  }

  const configuredServerUrl = getResolvedConfig(workspaceRoot).serverUrl ?? DEFAULT_SERVER_URL;
  await assertServerHealthy(configuredServerUrl);
  return directTarget(configuredServerUrl);
}

function directTarget(url: string): {
  serverUrl: string;
  apiTarget: ChumpConfig["apiTarget"];
} {
  const serverUrl = normalizeServerBaseUrl(url);
  return {
    serverUrl,
    apiTarget: { kind: "direct" },
  };
}

async function localServiceTargetForUrl(
  workspaceRoot: string,
  url: string,
): Promise<{
  serverUrl: string;
  apiTarget: ChumpConfig["apiTarget"];
} | null> {
  const service = await readHealthyLocalService();
  if (!service || normalizeServerBaseUrl(url) !== service.url) return null;
  return await localServiceProjectTarget(workspaceRoot, service);
}

async function localServiceProjectTarget(
  workspaceRoot: string,
  service: ServiceRegistration,
): Promise<{
  serverUrl: string;
  apiTarget: ChumpConfig["apiTarget"];
}> {
  const target = await registerLocalProjectTarget(service, workspaceRoot);
  return serviceTarget(service.url, target.project.id, service.token);
}

function serviceTarget(
  serverUrl: string,
  projectId: string,
  token: string,
): {
  serverUrl: string;
  apiTarget: ChumpConfig["apiTarget"];
} {
  return {
    serverUrl,
    apiTarget: {
      kind: "service",
      projectId,
      token,
    },
  };
}

async function assertServerHealthy(url: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (await isServerHealthy(url, 2_000)) {
      return;
    }
    if (attempt < 3) {
      await sleep(250 * attempt);
    }
  }
  throw new Error(`could not reach server at ${url}`);
}

async function isServerHealthy(url: string, timeoutMs = 1_000): Promise<boolean> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
