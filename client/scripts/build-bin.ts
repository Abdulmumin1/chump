import { $ } from "bun";
import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

await mkdir("dist/bin", { recursive: true });
await mkdir("dist/packages", { recursive: true });

const target = currentTarget();

console.log(`Building chump package for ${target.platform}...`);

const outfile = path.join("dist", "bin", cliAssetName(target.platform));
await $`bun build ./src/chump.ts --compile --target ${target.bunTarget} --outfile ${outfile}`;
await packageTarget({ platform: target.platform, cliBinary: outfile, cliName: target.cliName });

console.log("Build complete!");

type BuildTarget = {
  bunTarget: string;
  platform: string;
  cliName: string;
};

function currentTarget(): BuildTarget {
  const platform = platformSuffix();
  const bunPlatform = platform.startsWith("windows") ? "windows" : platform.split("-")[0];
  const bunArch = platform.endsWith("arm64") ? "arm64" : "x64";
  return {
    bunTarget: `bun-${bunPlatform}-${bunArch}`,
    platform,
    cliName: platform.startsWith("windows") ? "chump.exe" : "chump",
  };
}

function platformSuffix(): string {
  const platform =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "windows"
        : process.platform === "linux"
          ? "linux"
          : null;
  if (!platform) {
    throw new Error(`unsupported platform: ${process.platform}`);
  }
  const machine = os.arch();
  const arch = machine === "x64" ? "x64" : machine === "arm64" ? "arm64" : null;
  if (!arch) {
    throw new Error(`unsupported architecture: ${machine}`);
  }
  return `${platform}-${arch}`;
}

async function packageTarget({
  platform,
  cliBinary,
  cliName,
}: {
  platform: string;
  cliBinary: string;
  cliName: string;
}): Promise<void> {
  const serverBinary = serverBinaryPath(platform);
  if (!serverBinary) {
    throw new Error(`missing bundled server binary for ${platform}`);
  }

  const packageRoot = path.join("dist", "packages", `chump-${platform}`);
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });
  await copyFile(cliBinary, path.join(packageRoot, cliName));
  await copyFile(serverBinary, path.join(packageRoot, serverExecutableName(platform)));
  if (!platform.startsWith("windows")) {
    await chmod(path.join(packageRoot, cliName), 0o755);
    await chmod(path.join(packageRoot, serverExecutableName(platform)), 0o755);
  }

  const archive = `chump-${platform}.tar.gz`;
  await $`tar -czf ${archive} -C dist/packages chump-${platform}`;
  await rm(path.join("dist", "packages", archive), { force: true });
  await copyFile(archive, path.join("dist", "packages", archive));
  await rm(archive, { force: true });
}

function serverBinaryPath(platform: string): string | null {
  const candidates = [
    path.join("..", "server", "dist", "bin", serverExecutableName(platform)),
    path.join("vendor", "chump-server", serverExecutableName(platform)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function serverExecutableName(platform: string): string {
  return platform.startsWith("windows")
    ? `chump-server-${platform}.exe`
    : `chump-server-${platform}`;
}

function cliAssetName(platform: string): string {
  return platform.startsWith("windows") ? "chump-windows-x64.exe" : `chump-${platform}`;
}
