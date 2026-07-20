import process from "node:process";

export function preferredSpinnerFrames(): string[] {
  if (process.platform === "win32") {
    return ["-", "\\", "|", "/"];
  }
  return ["✶", "✸", "✹", "✺", "✹", "✷"];
}
