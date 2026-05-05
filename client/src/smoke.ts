#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

async function main(): Promise<void> {
  const resumeOutput = await run(["src/chump.ts", "-s", "smoke-session"], "/quit\n");
  if (!resumeOutput.includes("chump -s smoke-session")) {
    throw new Error("resume command was not printed on quit");
  }
  await run(["src/chump.ts", "status"]);
  await run(["src/chump.ts", "stop"]);
}

async function run(args: string[], input?: string): Promise<string> {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "inherit"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    process.stdout.write(chunk);
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

  return stdout;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
