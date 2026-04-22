#!/usr/bin/env node

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { sendChat } from "./api.ts";
import { runLocalCommand } from "./commands.ts";
import { loadConfig, renderBanner } from "./config.ts";

async function main(): Promise<void> {
  let config = loadConfig();
  const rl = readline.createInterface({ input, output });

  console.log(renderBanner(config));

  while (true) {
    const line = (await rl.question("> ")).trim();
    if (!line) {
      continue;
    }

    const result = runLocalCommand(config, line);
    if (result.handled) {
      if (result.nextConfig) {
        config = result.nextConfig;
        console.log(`switched agent to ${config.agentId}`);
      }
      if (result.shouldExit) {
        break;
      }
      continue;
    }

    await sendChat(config, line);
  }

  rl.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

