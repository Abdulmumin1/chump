import type { ChumpConfig, SseEvent } from "../core/types.ts";

export async function openEventStream(
  config: ChumpConfig,
  handlers: {
    onEvent: (event: SseEvent) => void;
    onError?: (error: Error) => void;
  },
): Promise<() => void> {
  const controller = new AbortController();

  const response = await fetch(`${buildAgentUrl(config)}/events`, {
    signal: controller.signal,
  });

  if (!response.ok) {
    throw new Error(`event stream failed with ${response.status}`);
  }

  void consumeSse(response, handlers.onEvent).catch((error: unknown) => {
    if (controller.signal.aborted) {
      return;
    }
    handlers.onError?.(
      error instanceof Error ? error : new Error(String(error)),
    );
  });

  return () => controller.abort();
}

export async function consumeSse(
  response: Response,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("response body is not readable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const parsed = parseSseEvent(rawEvent);
      if (parsed) {
        onEvent(parsed);
      }

      boundary = buffer.indexOf("\n\n");
    }
  }
}

function parseSseEvent(rawEvent: string): SseEvent | null {
  const lines = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith(":"));

  if (lines.length === 0) {
    return null;
  }

  let event = "message";
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    event,
    data: dataLines.join("\n"),
    id,
  };
}

function buildAgentUrl(config: ChumpConfig): string {
  return `${config.serverUrl}/agent/${config.agentId}`;
}
