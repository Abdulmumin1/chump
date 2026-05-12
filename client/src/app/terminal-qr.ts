import { qrcodegen } from "./qrcodegen.js";

const QUIET_ZONE = 2;

type TerminalQrCode = {
  size: number;
  getModule(x: number, y: number): boolean;
};

export function renderTerminalQr(value: string): string {
  const qr = qrcodegen.QrCode.encodeText(value, qrcodegen.QrCode.Ecc.MEDIUM);
  const size = qr.size + QUIET_ZONE * 2;
  const lines: string[] = [];

  for (let y = 0; y < size; y += 2) {
    let line = "";
    for (let x = 0; x < size; x++) {
      const top = isDark(qr, x - QUIET_ZONE, y - QUIET_ZONE);
      const bottom = isDark(qr, x - QUIET_ZONE, y + 1 - QUIET_ZONE);
      if (top && bottom) line += "█";
      else if (top) line += "▀";
      else if (bottom) line += "▄";
      else line += " ";
    }
    lines.push(line.trimEnd());
  }

  return lines.join("\n");
}

function isDark(qr: TerminalQrCode, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= qr.size || y >= qr.size) {
    return false;
  }
  return qr.getModule(x, y);
}
