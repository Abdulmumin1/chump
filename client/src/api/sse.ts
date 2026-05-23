import { randomUUID } from "node:crypto";
import type { ChumpConfig, SseEvent } from "../core/types.ts";

const EVENT_STREAM_CLIENT_ID = `cli-${randomUUID()}`;

export async function openEventStream(
  config: ChumpConfig,
  handlers: {
    onEvent: (event: SseEvent) => void;
    onError?: (error: Error) => void;
  },
  options: {
    reconnectDelayMs?: number;
    idleTimeoutMs?: number;
  } = {},
): Promise<() => void> {
  const reconnectDelayMs = options.reconnectDelayMs ?? 1000;
  // Server sends `: keepalive` comments every 30s. If we go ~60s without any
  // bytes, tear the connection down and reconnect.
  const idleTimeoutMs = options.idleTimeoutMs ?? 60000;
  let closed = false;
  let lastEventId = 0;
  let controller: AbortController | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const armIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      controller?.abort();
    }, idleTimeoutMs);
  };

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const connect = async (): Promise<void> => {
    while (!closed) {
      controller = new AbortController();
      armIdleTimer();
      try {
        const urlStr = `${buildAgentUrl(config)}/events`;
        const requestUrl = new URL(urlStr);
        requestUrl.searchParams.set("client_id", EVENT_STREAM_CLIENT_ID);
        if (lastEventId > 0) {
          requestUrl.searchParams.set("last_event_id", String(lastEventId));
        }

        const response = await fetch(requestUrl.toString(), {
          signal: controller.signal,
          headers: {
            accept: "text/event-stream",
          },
        });

        if (!response.ok) {
          throw new Error(`event stream failed with ${response.status}`);
        }

        await consumeSse(
          response,
          (event) => {
            if (event.id) {
              const parsed = Number(event.id);
              if (Number.isFinite(parsed)) {
                lastEventId = parsed;
              }
            }
            handlers.onEvent(event);
          },
          armIdleTimer,
        );
      } catch (error) {
        if (closed) {
          break;
        }
        // Aborted is a deliberate restart (e.g. idle watchdog), don't trigger onError
        if (controller && !controller.signal.aborted) {
          handlers.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      } finally {
        clearIdleTimer();
      }

      if (closed) {
        break;
      }

      await delay(reconnectDelayMs);
    }
  };

  void connect();

  return () => {
    closed = true;
    clearIdleTimer();
    controller?.abort();
  };
}

export async function consumeSse(
  response: Response,
  onEvent: (event: SseEvent) => void,
  onActivity?: () => void,
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

    onActivity?.();

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
