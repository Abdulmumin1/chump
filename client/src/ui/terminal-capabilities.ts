import process from "node:process";

export function supportsSynchronizedOutput(): boolean {
  return process.platform !== "win32";
}

export function supportsStatusRowPatching(): boolean {
  return process.platform !== "win32";
}

export function preferredSpinnerFrames(): string[] {
  if (process.platform === "win32") {
    return ["-", "\\", "|", "/"];
  }
  return ["✶", "✸", "✹", "✺", "✹", "✷"];
}
