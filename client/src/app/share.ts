import { startTunnel, type StartedTunnelHandle } from "./onlocal.ts";

import type { ChumpConfig } from "../core/types.ts";

const DEFAULT_ONLOCAL_DOMAIN = "wss://onlocal.dev";
const DEFAULT_SHARE_READY_TIMEOUT_MS = 15_000;

export type ActiveShare = {
  provider: "onlocal";
  publicUrl: string;
  localUrl: string;
  connectUrl: string | null;
  startedAt: number;
};

export class ShareManager {
  private active: (ActiveShare & { tunnel: StartedTunnelHandle }) | null = null;

  async start(config: ChumpConfig): Promise<{
    share: ActiveShare;
    reused: boolean;
  }> {
    const localUrl = assertShareableLocalServer(config.serverUrl);
    if (this.active && this.active.localUrl === localUrl) {
      return {
        share: this.snapshot(this.active),
        reused: true,
      };
    }

    await this.stop();

    const target = new URL(localUrl);
    const tunnel = await startTunnel({
      port: Number(target.port),
      domain:
        process.env.CHUMP_ONLOCAL_DOMAIN ||
        process.env.TUNNEL_DOMAIN ||
        DEFAULT_ONLOCAL_DOMAIN,
      verbosity: "silent",
      readyTimeoutMs: DEFAULT_SHARE_READY_TIMEOUT_MS,
    });

    this.active = {
      provider: "onlocal",
      publicUrl: tunnel.url,
      localUrl,
      connectUrl: buildConnectUrl(tunnel.url, config.agentId),
      startedAt: Date.now(),
      tunnel,
    };
    return {
      share: this.snapshot(this.active),
      reused: false,
    };
  }

  current(): ActiveShare | null {
    return this.active ? this.snapshot(this.active) : null;
  }

  async stop(): Promise<ActiveShare | null> {
    if (!this.active) {
      return null;
    }
    const current = this.active;
    this.active = null;
    await current.tunnel.stop();
    return this.snapshot(current);
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  private snapshot(value: ActiveShare): ActiveShare {
    return {
      provider: value.provider,
      publicUrl: value.publicUrl,
      localUrl: value.localUrl,
      connectUrl: value.connectUrl,
      startedAt: value.startedAt,
    };
  }
}

function buildConnectUrl(publicUrl: string, agentId: string): string | null {
  const base =
    process.env.CHUMP_SHARE_WEB_URL?.trim() || "https://chump.yaqeen.me";
  if (!base) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }

  url.searchParams.set("server", publicUrl);
  url.searchParams.set("session", agentId);
  return url.toString();
}

function assertShareableLocalServer(serverUrl: string): string {
  let target: URL;
  try {
    target = new URL(serverUrl);
  } catch {
    throw new Error(`server URL is invalid: ${serverUrl}`);
  }

  if (target.protocol !== "http:") {
    throw new Error("share currently only supports local http Chump servers");
  }

  if (!target.port) {
    throw new Error("share requires a concrete local server port");
  }

  if (target.pathname !== "/" || target.search || target.hash) {
    throw new Error("share requires a base server URL, not a nested path");
  }

  if (!isLoopbackHost(target.hostname)) {
    throw new Error("share currently only supports localhost-managed servers");
  }

  return target.toString().replace(/\/$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  );
}
