import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version);
const target = path.join(root, "src", "app", "generated-version.ts");

await writeFile(target, `export const CHUMP_CLIENT_VERSION = ${JSON.stringify(version)};\n`, "utf8");
