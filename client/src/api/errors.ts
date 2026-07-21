export class ServerHttpError extends Error {
  readonly status: number;

  constructor(
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "ServerHttpError";
    this.status = status;
  }
}

export class ServerStreamInterruptedError extends Error {
  constructor(message = "server stream ended before a terminal event") {
    super(message);
    this.name = "ServerStreamInterruptedError";
  }
}

export function isTransientServerError(error: unknown): boolean {
  if (error instanceof ServerStreamInterruptedError) {
    return true;
  }
  if (error instanceof ServerHttpError) {
    return [502, 503, 504].includes(error.status);
  }

  return collectErrorMessages(error).some((message) => {
    const normalized = message.toLowerCase();
    return normalized.includes("fetch failed") ||
      normalized.includes("failed to fetch") ||
      normalized.includes("econnrefused") ||
      normalized.includes("econnreset") ||
      normalized.includes("socket hang up") ||
      normalized.includes("other side closed") ||
      normalized.includes("connection refused") ||
      normalized.includes("networkerror");
  });
}

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }
    if ("cause" in current) {
      current = current.cause;
      continue;
    }
    break;
  }

  if (messages.length === 0) {
    messages.push(error instanceof Error ? error.message : String(error));
  }
  return messages;
}
