import { spawn } from "node:child_process";

import { DaemonAuthStore } from "./daemon-auth.ts";
import { runDaemonCommand } from "./daemon-command.ts";
import { DaemonMetadataStore } from "./daemon-metadata.ts";

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
  await runDaemonCommand("start");
  const [daemon, token] = await Promise.all([
    new DaemonMetadataStore().readActive(),
    new DaemonAuthStore().readToken(),
  ]);
  if (!daemon) {
    throw new Error("daemon metadata is unavailable after startup");
  }
  if (!token) {
    throw new Error("daemon credential is unavailable after startup");
  }

  const webUrl = options.webUrl ?? process.env.CHUMP_WEB_URL ?? null;
  const connectUrl = webUrl
    ? buildDaemonConnectUrl(webUrl, daemon.url, token)
    : null;

  if (options.open !== false && connectUrl) {
    openUrl(connectUrl);
  }

  if (options.json) {
    return JSON.stringify(
      {
        daemonUrl: daemon.url,
        daemonToken: token,
        webUrl,
        connectUrl,
      },
      null,
      2,
    );
  }

  const lines = [
    `daemon: ${daemon.url}`,
    `token:  ${token}`,
  ];
  if (connectUrl) {
    lines.push(`web:    ${connectUrl}`);
    if (options.open !== false) {
      lines.push("opened web app");
    }
  } else {
    lines.push("");
    lines.push("Set CHUMP_WEB_URL or pass --web-url to open the web app automatically.");
    lines.push("Example: chump app --web-url http://localhost:5173");
  }
  return lines.join("\n");
}

export function buildDaemonConnectUrl(
  webUrl: string,
  daemonUrl: string,
  daemonToken: string,
): string {
  const parsed = new URL(webUrl);
  assertLoopbackWebUrl(parsed);
  const handoff = new URLSearchParams();
  handoff.set("daemonUrl", daemonUrl);
  handoff.set("daemonToken", daemonToken);
  parsed.hash = handoff.toString();
  return parsed.toString();
}

function assertLoopbackWebUrl(url: URL): void {
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("app web URL must be a loopback URL");
  }
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
