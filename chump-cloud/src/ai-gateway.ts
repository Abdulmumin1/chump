export type UpstreamTarget = {
  provider: "deepseek" | "google";
  gatewayProvider: "deepseek" | "google-ai-studio";
  endpoint: string;
  model: string;
  byokAlias: string;
};

export type ChatCompletionRequest = Record<string, unknown> & {
  model?: unknown;
  stream?: unknown;
};

export type GeminiOperation = "generateContent" | "streamGenerateContent";

export const AI_GATEWAY_ID = "chump_cloud_ai_gateway";

export const SUPPORTED_MODELS: Record<string, UpstreamTarget> = {
  "deepseek-v4-flash": {
    provider: "deepseek",
    gatewayProvider: "deepseek",
    endpoint: "chat/completions",
    model: "deepseek-v4-flash",
    byokAlias: "default",
  },
  "deepseek-v4-pro": {
    provider: "deepseek",
    gatewayProvider: "deepseek",
    endpoint: "chat/completions",
    model: "deepseek-v4-pro",
    byokAlias: "default",
  },
  "gemini-3.7-flash": {
    provider: "google",
    gatewayProvider: "google-ai-studio",
    endpoint: "v1beta/openai/chat/completions",
    model: "gemini-3.7-flash",
    byokAlias: "default2",
  },
};

export function buildGatewayRequest(body: ChatCompletionRequest, target: UpstreamTarget) {
  return {
    provider: target.gatewayProvider,
    endpoint: target.endpoint,
    headers: {
      "Content-Type": "application/json",
      "cf-aig-byok-alias": target.byokAlias,
    },
    query: { ...body, model: target.model },
  };
}

export function buildGeminiGatewayRequest(
  body: Record<string, unknown>,
  target: UpstreamTarget,
  operation: GeminiOperation,
) {
  const streaming = operation === "streamGenerateContent";
  return {
    provider: target.gatewayProvider,
    endpoint: `v1beta/models/${target.model}:${operation}${streaming ? "?alt=sse" : ""}`,
    headers: {
      "Content-Type": "application/json",
      "cf-aig-byok-alias": target.byokAlias,
    },
    query: body,
  };
}

export function normalizeGeminiSseLine(
  line: string,
  choicesWithToolCalls: Set<number>,
): string {
  if (!line.startsWith("data:")) {
    return line;
  }

  const data = line.slice("data:".length).trimStart();
  if (!data || data === "[DONE]") {
    return line;
  }

  let chunk: unknown;
  try {
    chunk = JSON.parse(data);
  } catch {
    return line;
  }

  normalizeGeminiChoices(chunk, choicesWithToolCalls);
  return `data: ${JSON.stringify(chunk)}`;
}

export function normalizeGeminiChoices(
  body: unknown,
  choicesWithToolCalls = new Set<number>(),
): void {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    return;
  }

  body.choices.forEach((choice, choicePosition) => {
    if (!isRecord(choice)) {
      return;
    }
    const choiceIndex = typeof choice.index === "number" ? choice.index : choicePosition;
    const message = isRecord(choice.message) ? choice.message : null;
    const delta = isRecord(choice.delta) ? choice.delta : null;
    const toolCalls = message?.tool_calls ?? delta?.tool_calls;

    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      choicesWithToolCalls.add(choiceIndex);
      toolCalls.forEach((toolCall, toolCallIndex) => {
        if (isRecord(toolCall) && typeof toolCall.index !== "number") {
          toolCall.index = toolCallIndex;
        }
      });
    }

    if (choice.finish_reason === "stop" && choicesWithToolCalls.has(choiceIndex)) {
      choice.finish_reason = "tool_calls";
    }
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
