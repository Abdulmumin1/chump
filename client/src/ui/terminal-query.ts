const OSC11_PREFIX = "\x1b]11;";
const OSC_ST = "\x1b\\";
const OSC11_RGB_FRAGMENT = /(?:\x1b\]11;)?rgb:[0-9a-fA-F]+\/[0-9a-fA-F]+\/[0-9a-fA-F]+(?:\x07|\x1b\\)?/g;

let pendingUntil = 0;
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
let captureBuffer = "";
let capturing = false;

export function armOsc11ResponseFilter(timeoutMs: number = 300): void {
  pendingUntil = Date.now() + timeoutMs;
  captureBuffer = "";
  capturing = false;
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  timeoutHandle = setTimeout(() => {
    pendingUntil = 0;
    captureBuffer = "";
    capturing = false;
    timeoutHandle = null;
  }, timeoutMs);
}

export function stripPendingOsc11Response(chunk: string): string {
  if (!chunk) {
    return chunk;
  }

  if (!capturing && Date.now() > pendingUntil) {
    clearOsc11ResponseFilter();
    return chunk;
  }

  if (!capturing) {
    const start = chunk.indexOf(OSC11_PREFIX);
    if (start === -1) {
      return stripOsc11RgbFragments(chunk);
    }
    capturing = true;
    const before = chunk.slice(0, start);
    const remainder = consumeOsc11Capture(chunk.slice(start));
    return stripOsc11RgbFragments(before + remainder);
  }

  return stripOsc11RgbFragments(consumeOsc11Capture(chunk));
}

export function clearOsc11ResponseFilter(): void {
  pendingUntil = 0;
  captureBuffer = "";
  capturing = false;
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
}

function stripOsc11RgbFragments(chunk: string): string {
  if (!chunk || Date.now() > pendingUntil) {
    return chunk;
  }
  return chunk.replace(OSC11_RGB_FRAGMENT, "");
}

function consumeOsc11Capture(chunk: string): string {
  captureBuffer += chunk;

  const belIndex = captureBuffer.indexOf("\x07");
  const stIndex = captureBuffer.indexOf(OSC_ST);
  let endIndex = -1;
  let endLength = 0;

  if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
    endIndex = belIndex;
    endLength = 1;
  } else if (stIndex !== -1) {
    endIndex = stIndex;
    endLength = OSC_ST.length;
  }

  if (endIndex === -1) {
    return "";
  }

  const remainder = captureBuffer.slice(endIndex + endLength);
  clearOsc11ResponseFilter();
  return remainder;
}
