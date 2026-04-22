import type { ChumpConfig } from "./types.ts";

export async function sendChat(
  config: ChumpConfig,
  message: string,
): Promise<void> {
  console.log(
    `[scaffold] send "${message}" to ${config.serverUrl}/agent/${config.agentId}/chat?stream=true`,
  );
}

