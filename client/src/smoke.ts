#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

async function main(): Promise<void> {
  await run(["src/chump.ts"], "/quit\n");
  await run(["src/chump.ts", "status"]);
  await run(["src/chump.ts", "stop"]);
}

async function run(args: string[], input?: string): Promise<void> {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: ["pipe", "inherit", "inherit"],
  });

  if (input) {
    child.stdin.end(input);
  } else {
    child.stdin.end();
  }

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${args.join(" ")} exited with code ${code}`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
