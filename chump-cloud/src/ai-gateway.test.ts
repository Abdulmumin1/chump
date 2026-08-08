import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGatewayRequest,
  buildGeminiGatewayRequest,
  normalizeGeminiChoices,
  normalizeGeminiSseLine,
  SUPPORTED_MODELS,
} from "./ai-gateway.ts";

test("builds DeepSeek requests with the explicit default BYOK alias", () => {
  const request = buildGatewayRequest(
    {
      model: "client-controlled-model",
      messages: [{ role: "user", content: "hello" }],
    },
    SUPPORTED_MODELS["deepseek-v4-flash"],
  );

  assert.deepEqual(request, {
    provider: "deepseek",
    endpoint: "chat/completions",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-byok-alias": "default",
    },
    query: {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
    },
  });
});

test("builds Gemini requests with the explicit Google BYOK alias", () => {
  const request = buildGatewayRequest(
    { model: "gemini-3.6-flash", messages: [] },
    SUPPORTED_MODELS["gemini-3.6-flash"],
  );

  assert.equal(request.provider, "google-ai-studio");
  assert.equal(request.endpoint, "v1beta/openai/chat/completions");
  assert.equal(request.headers["cf-aig-byok-alias"], "default2");
  assert.equal(request.query.model, "gemini-3.6-flash");
});

test("builds native streaming Gemini requests without changing the body", () => {
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ functionResponse: { name: "view_image", response: { result: "loaded" } } }],
      },
    ],
  };

  const request = buildGeminiGatewayRequest(
    body,
    SUPPORTED_MODELS["gemini-3.6-flash"],
    "streamGenerateContent",
  );

  assert.deepEqual(request, {
    provider: "google-ai-studio",
    endpoint: "v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-byok-alias": "default2",
    },
    query: body,
  });
});

test("normalizes non-streaming Gemini tool calls without losing extension metadata", () => {
  const body = {
    choices: [
      {
        index: 0,
        message: {
          tool_calls: [
            {
              index: undefined as number | undefined,
              id: "call_1",
              type: "function",
              function: { name: "example", arguments: "{}" },
              extra_content: { google: { thought_signature: "signed" } },
            },
          ],
        },
        finish_reason: "stop",
      },
    ],
  };

  normalizeGeminiChoices(body);

  assert.equal(body.choices[0].finish_reason, "tool_calls");
  assert.equal(body.choices[0].message.tool_calls[0].index, 0);
  assert.deepEqual(body.choices[0].message.tool_calls[0].extra_content, {
    google: { thought_signature: "signed" },
  });
});

test("normalizes streaming Gemini finish reasons across chunks", () => {
  const choicesWithToolCalls = new Set<number>();
  const toolCallLine = normalizeGeminiSseLine(
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"example","arguments":"{}"}}]},"finish_reason":null}]}',
    choicesWithToolCalls,
  );
  const finishLine = normalizeGeminiSseLine(
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    choicesWithToolCalls,
  );

  const toolCallChunk = JSON.parse(toolCallLine.slice("data: ".length));
  assert.equal(toolCallChunk.choices[0].delta.tool_calls[0].index, 0);
  assert.match(finishLine, /"finish_reason":"tool_calls"/);
  assert.equal(normalizeGeminiSseLine("data: [DONE]", choicesWithToolCalls), "data: [DONE]");
});
