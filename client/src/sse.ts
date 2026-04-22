import type { ChumpConfig } from "./types.ts";

export async function connectEventStream(config: ChumpConfig): Promise<void> {
  console.log(
    `[scaffold] event stream ${config.serverUrl}/agent/${config.agentId}/events`,
  );
}

