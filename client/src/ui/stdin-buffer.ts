/**
 * StdinBuffer — buffers raw stdin chunks and emits complete key sequences.
 *
 * Two classes of bugs this fixes that a stateless splitter cannot:
 *
 *  1. Escape sequences split across stdin 'data' events. On slow terminals
 *     (VS Code, Kitty under load, JetBrains, etc.) a chunk like "\x1b[D"
 *     can arrive as ["\x1b", "[D"]. A stateless splitter sees "\x1b" alone,
 *     emits it as a bare ESC, and then interprets "[D" as two literal
 *     characters — pasting them into the draft or mis-firing shortcuts.
 *     StdinBuffer keeps incomplete tails in an internal buffer and waits
 *     for the rest (with a 10ms flush timeout as a safety net).
 *
 *  2. Out-of-order dispatch within a single coalesced chunk. A burst like
 *     "\x1b\x1b" (double-ESC for abort) arrives as one event; the old
 *     dispatcher matched the entire chunk against single-key patterns and
 *     silently dropped anything unmatched. The buffer extracts complete
 *     sequences one at a time and emits them in order.
 *
 * Ported from pi-mono (MIT) — https://github.com/badlogic/pi-mono
 * Originally based on OpenTUI (MIT) — https://github.com/anomalyco/opentui
 */

import { EventEmitter } from "node:events";

const ESC = "\x1b";
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

type SequenceStatus = "complete" | "incomplete" | "not-escape";

function isCompleteSequence(data: string): SequenceStatus {
  if (!data.startsWith(ESC)) return "not-escape";
  if (data.length === 1) return "incomplete";

  const afterEsc = data.slice(1);

  // Meta-prefixed escape: ESC ESC ... (legacy Alt+CSI, Alt+SS3 forms like
  // "\x1b\x1b[D" for Alt+Left on xterm without kitty protocol). Parse the
  // inner sequence recursively so we wait for the full meta-CSI instead of
  // greedily emitting "\x1b\x1b" on its own. This is critical for keeping
  // Alt+Arrow etc. intact AND for letting rapid double-ESC (which DOES
  // arrive as bare "\x1b\x1b") hit the 10ms flush timeout and get split
  // into two ESCs by the dispatcher.
  if (afterEsc.startsWith(ESC)) {
    return isCompleteSequence(afterEsc);
  }

  // CSI sequences: ESC [
  if (afterEsc.startsWith("[")) {
    // Old-style mouse: ESC [ M + 3 bytes
    if (afterEsc.startsWith("[M")) {
      return data.length >= 6 ? "complete" : "incomplete";
    }
    return isCompleteCsiSequence(data);
  }

  // OSC: ESC ] ... ST
  if (afterEsc.startsWith("]")) return isCompleteOscSequence(data);

  // DCS: ESC P ... ST
  if (afterEsc.startsWith("P")) return isCompleteDcsSequence(data);

  // APC: ESC _ ... ST (Kitty graphics etc.)
  if (afterEsc.startsWith("_")) return isCompleteApcSequence(data);

  // SS3: ESC O X
  if (afterEsc.startsWith("O")) {
    return afterEsc.length >= 2 ? "complete" : "incomplete";
  }

  // Meta / Alt+key: ESC + one char
  if (afterEsc.length === 1) return "complete";

  // Unknown — treat as complete so we don't stall forever.
  return "complete";
}

function isCompleteCsiSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}[`)) return "complete";
  if (data.length < 3) return "incomplete";

  const payload = data.slice(2);
  const lastChar = payload[payload.length - 1]!;
  const lastCharCode = lastChar.charCodeAt(0);

  if (lastCharCode >= 0x40 && lastCharCode <= 0x7e) {
    // SGR mouse reports: CSI < B ; X ; Y [Mm]
    if (payload.startsWith("<")) {
      if (/^<\d+;\d+;\d+[Mm]$/.test(payload)) return "complete";
      if (lastChar === "M" || lastChar === "m") {
        const parts = payload.slice(1, -1).split(";");
        if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
          return "complete";
        }
      }
      return "incomplete";
    }
    return "complete";
  }

  return "incomplete";
}

function isCompleteOscSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}]`)) return "complete";
  if (data.endsWith(`${ESC}\\`) || data.endsWith("\x07")) return "complete";
  return "incomplete";
}

function isCompleteDcsSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}P`)) return "complete";
  if (data.endsWith(`${ESC}\\`)) return "complete";
  return "incomplete";
}

function isCompleteApcSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}_`)) return "complete";
  if (data.endsWith(`${ESC}\\`)) return "complete";
  return "incomplete";
}

function extractCompleteSequences(
  buffer: string,
): { sequences: string[]; remainder: string } {
  const sequences: string[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const remaining = buffer.slice(pos);

    if (remaining.startsWith(ESC)) {
      // Walk forward until we have a complete escape sequence.
      let seqEnd = 1;
      let consumed = false;
      while (seqEnd <= remaining.length) {
        const candidate = remaining.slice(0, seqEnd);
        const status = isCompleteSequence(candidate);
        if (status === "complete") {
          sequences.push(candidate);
          pos += seqEnd;
          consumed = true;
          break;
        }
        if (status === "incomplete") {
          seqEnd += 1;
          continue;
        }
        // "not-escape" — shouldn't happen when candidate starts with ESC.
        sequences.push(candidate);
        pos += seqEnd;
        consumed = true;
        break;
      }
      if (!consumed) {
        // Ran off the end without completing — keep the tail for next chunk.
        return { sequences, remainder: remaining };
      }
      continue;
    }

    // Non-escape byte: emit one character at a time. Callers can group
    // printable runs themselves if desired, but most dispatchers want
    // per-event granularity for correctness (e.g. so that Enter in the
    // middle of a typed run still submits at the right moment).
    sequences.push(remaining[0]!);
    pos += 1;
  }

  return { sequences, remainder: "" };
}

export interface StdinBufferOptions {
  /** Max time to hold an incomplete sequence before flushing it (default 10ms). */
  timeout?: number;
}

export interface StdinBufferEventMap {
  data: [string];
  paste: [string];
}

/**
 * Accumulates stdin bytes, emits `data` per complete key sequence and
 * `paste` for bracketed paste content. Call `process()` with each raw
 * chunk received from stdin.
 */
export class StdinBuffer extends EventEmitter<StdinBufferEventMap> {
  private buffer = "";
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly timeoutMs: number;
  private pasteMode = false;
  private pasteBuffer = "";

  constructor(options: StdinBufferOptions = {}) {
    super();
    this.timeoutMs = options.timeout ?? 10;
  }

  process(data: string | Buffer): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    let str: string;
    if (Buffer.isBuffer(data)) {
      // A lone high byte is sometimes a meta-encoded ESC + (byte - 128).
      if (data.length === 1 && data[0]! > 127) {
        str = `\x1b${String.fromCharCode(data[0]! - 128)}`;
      } else {
        str = data.toString("utf8");
      }
    } else {
      str = data;
    }

    if (str.length === 0 && this.buffer.length === 0) {
      return;
    }

    this.buffer += str;

    // Bracketed paste is a distinct mode — accumulate until the end marker.
    if (this.pasteMode) {
      this.pasteBuffer += this.buffer;
      this.buffer = "";
      this.flushPasteIfComplete();
      return;
    }

    const startIndex = this.buffer.indexOf(BRACKETED_PASTE_START);
    if (startIndex !== -1) {
      if (startIndex > 0) {
        const before = this.buffer.slice(0, startIndex);
        const extracted = extractCompleteSequences(before);
        for (const seq of extracted.sequences) this.emit("data", seq);
        // Any incomplete tail before the paste marker is lost — acceptable
        // because a paste marker itself terminates whatever came before.
      }
      this.buffer = this.buffer.slice(startIndex + BRACKETED_PASTE_START.length);
      this.pasteMode = true;
      this.pasteBuffer = this.buffer;
      this.buffer = "";
      this.flushPasteIfComplete();
      return;
    }

    const result = extractCompleteSequences(this.buffer);
    this.buffer = result.remainder;
    for (const seq of result.sequences) this.emit("data", seq);

    // If we have an incomplete sequence pending, set a safety-net timeout.
    // If no more bytes arrive within timeoutMs, flush the partial content so
    // the user isn't stuck with a hung key.
    if (this.buffer.length > 0) {
      this.timeoutHandle = setTimeout(() => {
        this.timeoutHandle = null;
        const flushed = this.flush();
        for (const seq of flushed) this.emit("data", seq);
      }, this.timeoutMs);
    }
  }

  private flushPasteIfComplete(): void {
    const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
    if (endIndex === -1) return;
    const pasted = this.pasteBuffer.slice(0, endIndex);
    const remaining = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);
    this.pasteMode = false;
    this.pasteBuffer = "";
    this.emit("paste", pasted);
    if (remaining.length > 0) {
      this.process(remaining);
    }
  }

  /** Force-flush any pending incomplete sequence. Returns what was flushed. */
  flush(): string[] {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.buffer.length === 0) return [];
    const sequences = [this.buffer];
    this.buffer = "";
    return sequences;
  }

  clear(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.buffer = "";
    this.pasteMode = false;
    this.pasteBuffer = "";
  }

  isInPasteMode(): boolean {
    return this.pasteMode;
  }

  destroy(): void {
    this.clear();
    this.removeAllListeners();
  }
}
