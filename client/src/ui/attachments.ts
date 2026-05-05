import { execFile } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { ImageAttachment } from "../core/types.ts";

const execFileAsync = promisify(execFile);

const IMAGE_MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

export function normalizePastedText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function parsePastedPath(value: string): string | null {
  const trimmed = normalizePastedText(value).trim();
  if (!trimmed || trimmed.includes("\n")) {
    return null;
  }

  const unquoted = trimmed.replace(/^['"]|['"]$/g, "");
  if (unquoted.startsWith("file://")) {
    try {
      return fileURLToPath(unquoted);
    } catch {
      return null;
    }
  }

  return unquoted.replace(/\\(.)/g, "$1");
}

export async function readImageAttachment(
  pasted: string,
  workspaceRoot: string,
): Promise<ImageAttachment | null> {
  const parsedPath = parsePastedPath(pasted);
  if (!parsedPath) {
    return null;
  }

  const filePath = path.isAbsolute(parsedPath)
    ? parsedPath
    : path.resolve(workspaceRoot, parsedPath);
  const extension = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME_BY_EXTENSION.get(extension);
  if (!mime) {
    return null;
  }

  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    return null;
  }

  const data = await readFile(filePath);
  return {
    type: "image",
    label: `[Image: ${path.basename(filePath)}]`,
    filename: path.basename(filePath),
    mime,
    data: data.toString("base64"),
  };
}

export async function readClipboardImageAttachment(): Promise<ImageAttachment | null> {
  if (process.platform === "darwin") {
    return await readMacClipboardImage();
  }
  if (process.platform === "win32") {
    return await readWindowsClipboardImage();
  }
  if (process.platform === "linux") {
    return await readLinuxClipboardImage();
  }
  return null;
}

export async function readClipboardText(): Promise<string | null> {
  if (process.platform === "darwin") {
    return await readCommandText("pbpaste", []);
  }
  if (process.platform === "win32") {
    return await readCommandText(
      "powershell.exe",
      [
        "-NonInteractive",
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw",
      ],
    );
  }
  if (process.platform === "linux") {
    const wayland = await readCommandText("wl-paste", ["--no-newline"]);
    if (wayland !== null) {
      return wayland;
    }
    return await readCommandText("xclip", ["-selection", "clipboard", "-o"]);
  }
  return null;
}

async function readMacClipboardImage(): Promise<ImageAttachment | null> {
  const outputPath = path.join(tmpdir(), `chump-clipboard-${process.pid}-${Date.now()}.png`);
  try {
    await execFileAsync(
      "osascript",
      [
        "-e",
        'set imageData to the clipboard as "PNGf"',
        "-e",
        `set fileRef to open for access POSIX file "${outputPath}" with write permission`,
        "-e",
        "set eof fileRef to 0",
        "-e",
        "write imageData to fileRef",
        "-e",
        "close access fileRef",
      ],
      { timeout: 2000, maxBuffer: 1024 * 32 },
    );
    const data = await readFile(outputPath);
    if (data.length === 0) {
      return null;
    }
    return {
      type: "image",
      label: "[Image: clipboard.png]",
      filename: "clipboard.png",
      mime: "image/png",
      data: data.toString("base64"),
    };
  } catch {
    return null;
  } finally {
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

async function readWindowsClipboardImage(): Promise<ImageAttachment | null> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$img = [System.Windows.Forms.Clipboard]::GetImage();",
    "if ($img) {",
    "$ms = New-Object System.IO.MemoryStream;",
    "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);",
    "[System.Convert]::ToBase64String($ms.ToArray())",
    "}",
  ].join(" ");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NonInteractive", "-NoProfile", "-Command", script],
      { timeout: 2000, maxBuffer: 1024 * 1024 * 32 },
    );
    const data = stdout.trim();
    if (!data) {
      return null;
    }
    return {
      type: "image",
      label: "[Image: clipboard.png]",
      filename: "clipboard.png",
      mime: "image/png",
      data,
    };
  } catch {
    return null;
  }
}

async function readLinuxClipboardImage(): Promise<ImageAttachment | null> {
  if (release().includes("WSL")) {
    const windows = await readWindowsClipboardImage();
    if (windows) {
      return windows;
    }
  }
  const wayland = await readCommandImage("wl-paste", ["-t", "image/png"]);
  if (wayland) {
    return wayland;
  }
  return await readCommandImage("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
}

async function readCommandText(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      command,
      args,
      {
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 1024 * 1024 * 16,
      },
    );
    return stdout.length > 0 ? normalizePastedText(stdout) : null;
  } catch {
    return null;
  }
}

async function readCommandImage(command: string, args: string[]): Promise<ImageAttachment | null> {
  try {
    const { stdout } = await execFileAsync(
      command,
      args,
      {
        encoding: "buffer",
        timeout: 2000,
        maxBuffer: 1024 * 1024 * 32,
      },
    );
    if (!Buffer.isBuffer(stdout) || stdout.length === 0) {
      return null;
    }
    return {
      type: "image",
      label: "[Image: clipboard.png]",
      filename: "clipboard.png",
      mime: "image/png",
      data: stdout.toString("base64"),
    };
  } catch {
    return null;
  }
}
