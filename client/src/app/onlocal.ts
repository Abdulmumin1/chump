// @ts-ignore
import { startTunnel as startOnlocalTunnel } from "onlocal";

export type StartedTunnelHandle = {
  url: string;
  stop: () => Promise<void>;
};

export type OnlocalVerbosity = "silent" | "normal" | "verbose";

export async function startTunnel(options: {
  port: number;
  domain?: string;
  verbosity?: OnlocalVerbosity;
  readyTimeoutMs?: number;
}): Promise<StartedTunnelHandle> {
  return await startOnlocalTunnel(options);
}
