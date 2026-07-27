import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version);
const serverChangelog = await readFile(path.join(root, "..", "server", "CHANGELOG.md"), "utf8");
const serverVersion = serverChangelog.match(/^## (\d+\.\d+\.\d+)$/m)?.[1];
if (!serverVersion) {
  throw new Error("server/CHANGELOG.md has no stable version heading");
}
const target = path.join(root, "src", "app", "generated-version.ts");

await writeFile(
  target,
  [
    `export const CHUMP_CLIENT_VERSION = ${JSON.stringify(version)};`,
    `export const CHUMP_SERVER_VERSION = ${JSON.stringify(serverVersion)};`,
    "",
  ].join("\n"),
  "utf8",
);
