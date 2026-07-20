import type { ChumpHealth, ChumpStatus, UsageSummary } from "$lib/chump/types";

export const FALLBACK_MODELS: Record<string, any> = {
  codex: {
    id: "codex",
    name: "Codex",
    models: {
      "gpt-5.6": { id: "gpt-5.6", name: "GPT-5.6", reasoning: true, limit: { context: 1_050_000, output: 128_000 } },
      "gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", reasoning: true, limit: { context: 1_050_000, output: 128_000 } },
      "gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", reasoning: true, limit: { context: 1_050_000, output: 128_000 } },
      "gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", reasoning: true, limit: { context: 1_050_000, output: 128_000 } },
      "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", reasoning: true },
      "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
      "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", reasoning: true },
      "gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", reasoning: true },
      "gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2", reasoning: true },
      "gpt-5.2-codex": { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", reasoning: true },
      "gpt-5.1-codex": { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", reasoning: true },
      "gpt-5.1-codex-max": { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", reasoning: true },
      "gpt-5.1-codex-mini": { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", reasoning: true },
      "gpt-5-codex": { id: "gpt-5-codex", name: "GPT-5 Codex", reasoning: true },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-5.6": { id: "gpt-5.6", name: "GPT-5.6", reasoning: true, limit: { context: 1_050_000, output: 128_000 } },
      "gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", reasoning: true, limit: { context: 1_050_000, output: 128_000 } },
      "gpt-5.6-terra": { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", reasoning: true, limit: { context: 1_050_000, output: 128_000 } },
      "gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", reasoning: true, limit: { context: 1_050_000, output: 128_000 } },
      "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", reasoning: true },
      "gpt-5.4-pro": { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", reasoning: true },
      "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
      "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", reasoning: true },
      "gpt-5.4-nano": { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", reasoning: true },
      "gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", reasoning: true },
      "gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2", reasoning: true },
      "gpt-5.2-pro": { id: "gpt-5.2-pro", name: "GPT-5.2 Pro", reasoning: true },
      "gpt-5.1": { id: "gpt-5.1", name: "GPT-5.1", reasoning: true },
      "gpt-5": { id: "gpt-5", name: "GPT-5", reasoning: true },
      "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 Mini", reasoning: true },
      "gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano", reasoning: true },
      "gpt-5-codex": { id: "gpt-5-codex", name: "GPT-5 Codex", reasoning: true },
    },
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    models: {
      "claude-sonnet-4-20250514": {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        reasoning: true,
      },
    },
  },
  google: {
    id: "google",
    name: "Google",
    models: {
      "gemini-3.5-flash": {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        reasoning: true,
        limit: { context: 1_048_576, output: 65_536 },
      },
      "gemini-3.1-pro-preview": { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", reasoning: true },
      "gemini-3-pro-preview": { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview", reasoning: true },
      "gemini-3-flash-preview": { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview", reasoning: true },
      "gemini-2.5-flash": { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", reasoning: true },
      "gemini-2.5-pro": { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", reasoning: true },
      "gemini-2.5-flash-lite": { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", reasoning: true },
    },
  },
  workers_ai: {
    id: "workers_ai",
    name: "Cloudflare Workers AI",
    models: {
      "@cf/zai-org/glm-4.7-flash": {
        id: "@cf/zai-org/glm-4.7-flash",
        name: "GLM 4.7 Flash",
        reasoning: true,
      },
      "@cf/nvidia/nemotron-3-120b-a12b": {
        id: "@cf/nvidia/nemotron-3-120b-a12b",
        name: "Nemotron 3 120B",
        reasoning: true,
      },
      "@cf/moonshotai/kimi-k2.5": {
        id: "@cf/moonshotai/kimi-k2.5",
        name: "Kimi K2.5",
        reasoning: true,
      },
      "@cf/moonshotai/kimi-k2.6": {
        id: "@cf/moonshotai/kimi-k2.6",
        name: "Kimi K2.6",
        reasoning: true,
      },
      "@cf/moonshotai/kimi-k2.7-code": {
        id: "@cf/moonshotai/kimi-k2.7-code",
        name: "Kimi K2.7 Code",
        reasoning: true,
        limit: { context: 262_144, output: 262_144 },
      },
    },
  },
  chump_cloud: {
    id: "chump_cloud",
    name: "Chump Cloud",
    models: {
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        limit: { context: 1_000_000, output: 384_000 },
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        reasoning: true,
        limit: { context: 1_000_000, output: 384_000 },
      },
    },
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    models: {
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        limit: { context: 1_000_000, output: 384_000 },
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        reasoning: true,
        limit: { context: 1_000_000, output: 384_000 },
      },
    },
  },
};

const CODEX_MODELS = new Set([
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5-codex",
]);

const SUPPORTED_MODELS: Record<string, Set<string>> = {
  codex: new Set(CODEX_MODELS),
  openai: new Set([
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4-pro",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.3-codex",
    "gpt-5.2",
    "gpt-5.2-pro",
    "gpt-5.1",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5-codex",
  ]),
  chump_cloud: new Set(["deepseek-v4-pro", "deepseek-v4-flash"]),
  google: new Set([
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
  ]),
  anthropic: new Set(["claude-sonnet-4-20250514"]),
  workers_ai: new Set([
    "@cf/zai-org/glm-4.7-flash",
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/moonshotai/kimi-k2.5",
    "@cf/moonshotai/kimi-k2.6",
    "@cf/moonshotai/kimi-k2.7-code",
  ]),
  deepseek: new Set(["deepseek-v4-pro", "deepseek-v4-flash"]),
};

function modelCatalogProviderId(provider: string): string {
  if (provider === "codex") {
    return "openai";
  }
  if (provider === "chump_cloud") {
    return "deepseek";
  }
  if (provider === "workers_ai") {
    return "cloudflare-workers-ai";
  }
  return provider;
}

function isUsableChatModel(provider: string, model: any): boolean {
  if (!model.id) {
    return false;
  }
  if (!SUPPORTED_MODELS[provider]?.has(model.id)) {
    return false;
  }
  if ((provider === "openai" || provider === "codex") && !model.id.startsWith("gpt-5")) {
    return false;
  }
  if (provider === "codex" && !CODEX_MODELS.has(model.id)) {
    return false;
  }
  if (model.status === "deprecated") {
    return false;
  }
  const lower = model.id.toLowerCase();
  if (/(embedding|embed|reranker|bge|distilbert|bart-large-cnn|melotts|deepgram|aura|nova|smart-turn|indictrans|m2m100)/u.test(lower)) {
    return false;
  }
  if (/(image|imagen|gpt-image|dall-e|flux|sdxl|stable-diffusion|midjourney|recraft|tts|whisper|transcribe|vision-preview)/u.test(lower)) {
    return false;
  }
  if (model.reasoning !== true) {
    return false;
  }
  if (model.modalities?.output && !model.modalities.output.includes("text")) {
    return false;
  }
  if (model.modalities?.output?.includes("image")) {
    return false;
  }
  return true;
}

function modelRank(provider: string, model: string): number {
  const priorities: Record<string, string[]> = {
    openai: [
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.1",
      "gpt-5",
    ],
    codex: [
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.1-codex",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "gpt-5-codex",
    ],
    google: [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
    workers_ai: [
      "@cf/moonshotai/kimi-k2.7-code",
      "@cf/moonshotai/kimi-k2.6",
      "@cf/moonshotai/kimi-k2.5",
      "@cf/zai-org/glm-4.7-flash",
      "@cf/nvidia/nemotron-3-120b-a12b",
    ],
    chump_cloud: [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ],
    deepseek: [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ],
  };
  const index = priorities[provider]?.indexOf(model) ?? -1;
  return index === -1 ? 1000 : index;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}

function modelMetadata(model: any): string {
  const parts = [
    model.reasoning ? "reasoning" : null,
    typeof model.limit?.context === "number" ? `${formatNumber(model.limit.context)} ctx` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

let cachedCatalog: Record<string, any> | null = null;

export async function fetchModelCatalog(): Promise<Record<string, any>> {
  if (cachedCatalog) {
    return cachedCatalog;
  }
  try {
    const response = await fetch("https://models.dev/api.json", {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const json = await response.json();
      cachedCatalog = mergeCatalog(json);
      return cachedCatalog!;
    }
  } catch (error) {
    console.warn("Failed to fetch models catalog", error);
  }
  return FALLBACK_MODELS;
}

function mergeCatalog(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object") {
    return FALLBACK_MODELS;
  }
  const merged: Record<string, any> = { ...FALLBACK_MODELS };
  for (const [provider, entry] of Object.entries(value as Record<string, any>)) {
    const fallback = FALLBACK_MODELS[provider];
    merged[provider] =
      fallback && entry?.models
        ? {
            ...fallback,
            ...entry,
            models: {
              ...fallback.models,
              ...entry.models,
            },
          }
        : entry;
  }
  return merged;
}

export type ModelChoice = {
  provider: string;
  model: string;
  label: string;
  description: string;
  name?: string;
};

export async function listModelChoices(providers: string[]): Promise<ModelChoice[]> {
  const catalog = await fetchModelCatalog();
  return providers.flatMap((provider) => {
    const entry = catalog[modelCatalogProviderId(provider)] ?? FALLBACK_MODELS[provider];
    if (!entry) {
      return [];
    }
    return Object.values(entry.models)
      .filter((model: any) => isUsableChatModel(provider, model))
      .map((model: any) => ({
        provider,
        model: model.id,
        label: `${provider}/${model.id}`,
        description: modelMetadata(model),
        name: model.name,
      }))
      .sort((left, right) => modelRank(provider, left.model) - modelRank(provider, right.model) || left.label.localeCompare(right.label));
  });
}

export async function getModelContextLimit(
  provider: string,
  model: string,
): Promise<number | null> {
  const catalog = await fetchModelCatalog();
  const entry =
    catalog[modelCatalogProviderId(provider)] ?? FALLBACK_MODELS[provider];
  const info = entry?.models[model];
  if (typeof info?.limit?.context !== "number") {
    return null;
  }
  return info.limit.context as number;
}

export function latestContextTokens(usage: UsageSummary | null | undefined): number | null {
  const lastStepTotal = usage?.last_step?.total_tokens ?? null;
  if (lastStepTotal && lastStepTotal > 0) {
    return lastStepTotal;
  }
  return null;
}

export async function formatCtxLabel(
  health: ChumpHealth | ChumpStatus,
): Promise<string | null> {
  const limit = await getModelContextLimit(health.provider, health.model);
  const latestContext = latestContextTokens(health.usage);

  if (limit && latestContext !== null && latestContext >= 0) {
    return `(ctx ${formatNumber(Math.min(latestContext, limit))} / ${formatNumber(limit)})`;
  }
  if (limit) {
    return `(ctx ${formatNumber(limit)})`;
  }
  if (latestContext !== null && latestContext > 0) {
    return `(ctx ${formatNumber(latestContext)})`;
  }
  return null;
}
