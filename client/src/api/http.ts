import type {
  AgentEventLogResponse,
  AgentMessagesResponse,
  AgentStateResponse,
  ChumpConfig,
  ChumpHealth,
  ChumpStatus,
  ChatAttachment,
  SessionsResponse,
} from "../core/types.ts";
import { consumeSse } from "./sse.ts";

export async function streamChat(
  config: ChumpConfig,
  message: string,
  attachments: ChatAttachment[] = [],
  callbacks: {
    onStart?: () => void;
    onChunk?: (chunk: string) => void;
    onEnd?: (fullText: string) => void;
    onError?: (message: string) => void;
  } = {},
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${buildAgentUrl(config)}/chat?stream=true`,
    {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ message, attachments: serializeAttachments(attachments) }),
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }

  let fullText = "";
  await consumeSse(response, (event) => {
    switch (event.event) {
      case "start":
        callbacks.onStart?.();
        break;
      case "chunk": {
        const chunk = JSON.parse(event.data) as string;
        fullText += chunk;
        callbacks.onChunk?.(chunk);
        break;
      }
      case "end": {
        const finalText = JSON.parse(event.data) as string;
        callbacks.onEnd?.(finalText || fullText);
        break;
      }
      case "error":
        callbacks.onError?.(safeParseString(event.data));
        break;
    }
  });
}

export async function getStatus(config: ChumpConfig): Promise<ChumpStatus> {
  return await invokeAction<ChumpStatus>(config, "status");
}

export async function getHealth(config: ChumpConfig): Promise<ChumpHealth> {
  const response = await fetch(`${config.serverUrl}/health`);
  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }
  return (await response.json()) as ChumpHealth;
}

export async function getSessions(
  config: ChumpConfig,
): Promise<SessionsResponse> {
  const response = await fetch(`${config.serverUrl}/sessions`);
  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }
  return (await response.json()) as SessionsResponse;
}

export async function clearMessages(
  config: ChumpConfig,
): Promise<{ status: string }> {
  return await invokeAction<{ status: string }>(config, "clear_messages");
}

export async function getState(
  config: ChumpConfig,
): Promise<AgentStateResponse> {
  const response = await fetch(`${buildAgentUrl(config)}/state`);
  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }
  return (await response.json()) as AgentStateResponse;
}

export async function getMessages(
  config: ChumpConfig,
): Promise<AgentMessagesResponse> {
  const response = await fetch(`${buildAgentUrl(config)}/messages`);
  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }
  return (await response.json()) as AgentMessagesResponse;
}

export async function getEventLog(
  config: ChumpConfig,
): Promise<AgentEventLogResponse> {
  return await invokeAction<AgentEventLogResponse>(config, "event_log");
}

export async function abortCurrentTurn(
  config: ChumpConfig,
): Promise<{ status: string }> {
  return await invokeAction<{ status: string }>(config, "abort_current_turn");
}

export async function steerCurrentTurn(
  config: ChumpConfig,
  message: string,
  attachments: ChatAttachment[] = [],
): Promise<{ status: string }> {
  return await invokeAction<{ status: string }>(config, "steer_current_turn", {
    message,
    attachments,
  });
}

export async function cancelLastSteering(
  config: ChumpConfig,
): Promise<{ status: string }> {
  return await invokeAction<{ status: string }>(config, "cancel_last_steering");
}

export async function setModel(
  config: ChumpConfig,
  provider: string,
  model: string,
): Promise<ChumpStatus> {
  return await invokeAction<ChumpStatus>(config, "set_model", { provider, model });
}

export async function setReasoning(
  config: ChumpConfig,
  mode: string,
): Promise<ChumpStatus> {
  return await invokeAction<ChumpStatus>(config, "set_reasoning", { mode });
}

async function invokeAction<T>(
  config: ChumpConfig,
  actionName: string,
  body: object = {},
): Promise<T> {
  const response = await fetch(
    `${buildAgentUrl(config)}/action/${actionName}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(serializeActionBody(body)),
    },
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(await readErrorResponse(response));
  }

  const data = (await response.json()) as { result?: T; error?: string };
  if (!response.ok || data.error) {
    throw new Error(data.error ?? `action failed with ${response.status}`);
  }

  if (data.result === undefined) {
    throw new Error("action response missing result");
  }

  return data.result;
}

function buildAgentUrl(config: ChumpConfig): string {
  return `${config.serverUrl}/agent/${config.agentId}`;
}

function safeParseString(value: string): string {
  try {
    return JSON.parse(value) as string;
  } catch {
    return value;
  }
}

async function readErrorResponse(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  if (body) {
    return body;
  }
  return `request failed with ${response.status}`;
}

function serializeActionBody(body: object): object {
  if (!("attachments" in body)) {
    return body;
  }
  const candidate = body as { attachments?: unknown };
  if (!Array.isArray(candidate.attachments)) {
    return body;
  }
  return {
    ...body,
    attachments: serializeAttachments(candidate.attachments as ChatAttachment[]),
  };
}

function serializeAttachments(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments
    .filter((attachment) => attachment.type === "image")
    .map((attachment) => ({
      type: "image",
      label: attachment.label,
      filename: attachment.filename,
      mime: attachment.mime,
      data: attachment.data,
    }));
}
