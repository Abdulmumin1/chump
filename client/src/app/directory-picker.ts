import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function pickDirectory(): Promise<string | null> {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync(
        "osascript",
        [
          "-e",
          'POSIX path of (choose folder with prompt "Choose a Chump project")',
        ],
        pickerOptions(),
      );
      return normalizeSelection(stdout);
    }
    if (process.platform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
        "$dialog.Description = 'Choose a Chump project';",
        "if ($dialog.ShowDialog() -eq 'OK') { $dialog.SelectedPath }",
      ].join(" ");
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NonInteractive", "-NoProfile", "-Command", script],
        pickerOptions(),
      );
      return normalizeSelection(stdout);
    }
    if (process.platform === "linux") {
      const { stdout } = await execFileAsync(
        "zenity",
        ["--file-selection", "--directory", "--title=Choose a Chump project"],
        pickerOptions(),
      );
      return normalizeSelection(stdout);
    }
    throw new Error(`directory picker is unsupported on ${process.platform}`);
  } catch (error) {
    if (isCancelledPicker(error)) return null;
    throw error;
  }
}

function pickerOptions() {
  return {
    encoding: "utf8" as const,
    timeout: 5 * 60 * 1_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  };
}

function normalizeSelection(value: string): string | null {
  const selected = value.trim().replace(/\/+$/, "");
  return selected || null;
}

function isCancelledPicker(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; stderr?: unknown };
  if (candidate.code === 1) return true;
  return (
    typeof candidate.stderr === "string" &&
    /cancel|user canceled/i.test(candidate.stderr)
  );
}
