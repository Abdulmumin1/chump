import { spawn } from "node:child_process";

import {
  ensureLocalProjectTarget,
} from "./local-service.ts";
import { resolveWorkspaceRoot } from "./config.ts";
import {
  DEFAULT_CHUMP_WEB_URL,
  TRUSTED_CHUMP_WEB_ORIGINS,
} from "./app-config.ts";

export { DEFAULT_CHUMP_WEB_URL };

export type AppCommandOptions = {
  webUrl?: string;
  open?: boolean;
  json?: boolean;
};

export function parseAppCommand(argv: string[]): AppCommandOptions {
  const options: AppCommandOptions = {
    open: true,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--web-url") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("missing URL after --web-url");
      }
      options.webUrl = nextValue;
      index += 1;
      continue;
    }
    if (value === "--no-open") {
      options.open = false;
      continue;
    }
    if (value === "--json") {
      options.json = true;
      options.open = false;
      continue;
    }
    throw new Error(`unexpected app argument: ${value}`);
  }

  return options;
}

export async function runAppCommand(
  options: AppCommandOptions,
): Promise<string> {
  const target = await ensureLocalProjectTarget(
    resolveWorkspaceRoot(process.cwd()),
  );
  const { service, project } = target;

  const webUrl = options.webUrl ?? process.env.CHUMP_WEB_URL ??
    DEFAULT_CHUMP_WEB_URL;
  const connectUrl = buildServiceConnectUrl(
    webUrl,
    service.url,
    service.token,
    project.id,
  );

  if (options.open !== false && connectUrl) {
    openUrl(connectUrl);
  }

  if (options.json) {
    return JSON.stringify(
      {
        serviceUrl: service.url,
        serviceToken: service.token,
        projectId: project.id,
        webUrl,
        connectUrl,
      },
      null,
      2,
    );
  }

  const lines = [
    `service: ${service.url}`,
    `web:    ${webUrl}`,
  ];
  if (options.open !== false) {
    lines.push("opened web app");
  } else {
    lines.push("use --json to print the one-time connection URL");
  }
  return lines.join("\n");
}

export function buildServiceConnectUrl(
  webUrl: string,
  serviceUrl: string,
  serviceToken: string,
  projectId: string,
): string {
  const parsed = new URL(webUrl);
  assertAllowedWebUrl(parsed);
  const handoff = new URLSearchParams();
  handoff.set("serviceUrl", serviceUrl);
  handoff.set("serviceToken", serviceToken);
  handoff.set("projectId", projectId);
  parsed.hash = handoff.toString();
  return parsed.toString();
}

function assertAllowedWebUrl(url: URL): void {
  if (
    url.protocol === "https:" &&
    TRUSTED_CHUMP_WEB_ORIGINS.some((origin) => origin === url.origin)
  ) {
    return;
  }

  if (
    (url.protocol === "http:" || url.protocol === "https:") &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    return;
  }

  throw new Error(
    `app web URL must be ${DEFAULT_CHUMP_WEB_URL}, its legacy hosted URL, or a loopback URL`,
  );
}

function openUrl(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", url]
    : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}
