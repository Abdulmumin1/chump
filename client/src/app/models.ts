import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { globalDataDir } from "./auth.ts";

const MODELS_TTL_MS = 5 * 60 * 1000;
const CODEX_MODELS = new Set([
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

const FALLBACK_MODELS: Record<string, ModelProvider> = {
  codex: {
    id: "codex",
    name: "Codex",
    models: {
      "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", reasoning: true },
      "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
      "gpt-5.4-mini": {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        reasoning: true,
      },
      "gpt-5.3-codex": {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        reasoning: true,
      },
      "gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2", reasoning: true },
      "gpt-5.2-codex": {
        id: "gpt-5.2-codex",
        name: "GPT-5.2 Codex",
        reasoning: true,
      },
      "gpt-5.1-codex": {
        id: "gpt-5.1-codex",
        name: "GPT-5.1 Codex",
        reasoning: true,
      },
      "gpt-5.1-codex-max": {
        id: "gpt-5.1-codex-max",
        name: "GPT-5.1 Codex Max",
        reasoning: true,
      },
      "gpt-5.1-codex-mini": {
        id: "gpt-5.1-codex-mini",
        name: "GPT-5.1 Codex Mini",
        reasoning: true,
      },
      "gpt-5-codex": {
        id: "gpt-5-codex",
        name: "GPT-5 Codex",
        reasoning: true,
      },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", reasoning: true },
      "gpt-5.4-pro": {
        id: "gpt-5.4-pro",
        name: "GPT-5.4 Pro",
        reasoning: true,
      },
      "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
      "gpt-5.4-mini": {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        reasoning: true,
      },
      "gpt-5.4-nano": {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano",
        reasoning: true,
      },
      "gpt-5.3-codex": {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        reasoning: true,
      },
      "gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2", reasoning: true },
      "gpt-5.2-pro": {
        id: "gpt-5.2-pro",
        name: "GPT-5.2 Pro",
        reasoning: true,
      },
      "gpt-5.2-chat-latest": {
        id: "gpt-5.2-chat-latest",
        name: "GPT-5.2 Chat",
        reasoning: false,
      },
      "gpt-5.1": { id: "gpt-5.1", name: "GPT-5.1", reasoning: true },
      "gpt-5": { id: "gpt-5", name: "GPT-5", reasoning: true },
      "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 Mini", reasoning: true },
      "gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano", reasoning: true },
      "gpt-5-codex": {
        id: "gpt-5-codex",
        name: "GPT-5 Codex",
        reasoning: true,
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
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        reasoning: true,
      },
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
      "gemini-3.1-pro-preview": {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        reasoning: true,
      },
      "gemini-3-pro-preview": {
        id: "gemini-3-pro-preview",
        name: "Gemini 3 Pro Preview",
        reasoning: true,
      },
      "gemini-3-flash-preview": {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        reasoning: true,
      },
      "gemini-2.5-flash": {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        reasoning: true,
      },
      "gemini-2.5-pro": {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        reasoning: true,
      },
      "gemini-2.5-flash-lite": {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash Lite",
        reasoning: true,
      },
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
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        reasoning: true,
      },
    },
  },
};

export type ModelInfo = {
  id: string;
  name?: string;
  reasoning?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
  tool_call?: boolean;
  status?: string;
};

export type ModelProvider = {
  id: string;
  name: string;
  models: Record<string, ModelInfo>;
};

export type ModelChoice = {
  provider: string;
  model: string;
  label: string;
  description: string;
};

export async function listModelChoices(
  providers: string[],
): Promise<ModelChoice[]> {
  if (providers.length === 0) {
    return [];
  }
  const catalog = await loadModelCatalog();
  return providers.flatMap((provider) => {
    const entry =
      catalog[modelCatalogProviderId(provider)] ?? FALLBACK_MODELS[provider];
    if (!entry) {
      return [];
    }
    return Object.values(entry.models)
      .filter((model) => isUsableChatModel(provider, model))
      .map((model) => ({
        provider,
        model: model.id,
        label: `${provider}/${model.id}`,
        description: modelMetadata(model),
      }))
      .sort(
        (left, right) =>
          modelRank(provider, left.model) - modelRank(provider, right.model) ||
          left.label.localeCompare(right.label),
      );
  });
}

async function loadModelCatalog(): Promise<Record<string, ModelProvider>> {
  const cached = await readCachedCatalog();
  if (cached) {
    return normalizeCatalog(cached);
  }

  try {
    const response = await fetch("https://models.dev/api.json", {
      headers: { "User-Agent": "chump" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const json = await response.json();
      await writeCachedCatalog(json);
      return normalizeCatalog(json);
    }
  } catch {
    return FALLBACK_MODELS;
  }

  return FALLBACK_MODELS;
}

async function readCachedCatalog(): Promise<unknown | null> {
  const filePath = modelCachePath();
  try {
    const stats = await import("node:fs/promises").then((fs) =>
      fs.stat(filePath),
    );
    if (Date.now() - stats.mtimeMs > MODELS_TTL_MS) {
      return null;
    }
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeCachedCatalog(value: unknown): Promise<void> {
  const filePath = modelCachePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function modelCachePath(): string {
  if (process.env.CHUMP_MODELS_FILE) {
    return process.env.CHUMP_MODELS_FILE;
  }
  return path.join(globalCacheDir(), "models.json");
}

function globalCacheDir(): string {
  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, "chump");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "chump");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "chump",
    );
  }
  return path.join(os.homedir(), ".cache", "chump");
}

function normalizeCatalog(value: unknown): Record<string, ModelProvider> {
  if (!value || typeof value !== "object") {
    return FALLBACK_MODELS;
  }
  return {
    ...FALLBACK_MODELS,
    ...(value as Record<string, ModelProvider>),
  };
}

function modelCatalogProviderId(provider: string): string {
  if (provider === "codex") {
    return "openai";
  }
  if (provider === "workers_ai") {
    return "cloudflare-workers-ai";
  }
  return provider;
}

function isUsableChatModel(provider: string, model: ModelInfo): boolean {
  if (!model.id) {
    return false;
  }
  if (
    (provider === "openai" || provider === "codex") &&
    !model.id.startsWith("gpt-5")
  ) {
    return false;
  }
  if (provider === "codex" && !CODEX_MODELS.has(model.id)) {
    return false;
  }
  if (model.status === "deprecated") {
    return false;
  }
  const lower = model.id.toLowerCase();
  if (
    /(embedding|embed|reranker|bge|distilbert|bart-large-cnn|melotts|deepgram|aura|nova|smart-turn|indictrans|m2m100)/u.test(
      lower,
    )
  ) {
    return false;
  }
  if (model.modalities?.output && !model.modalities.output.includes("text")) {
    return false;
  }
  return true;
}

function modelRank(provider: string, model: string): number {
  const priorities: Record<string, string[]> = {
    openai: [
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.1",
      "gpt-5",
    ],
    chump_cloud: [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ],
    codex: [
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
      "gemini-3.1-pro-preview",
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
    workers_ai: [
      "@cf/moonshotai/kimi-k2.6",
      "@cf/moonshotai/kimi-k2.5",
      "@cf/zai-org/glm-4.7-flash",
      "@cf/nvidia/nemotron-3-120b-a12b",
      "@cf/openai/gpt-oss-120b",
      "@cf/qwen/qwen2.5-coder-32b-instruct",
    ],
    deepseek: ["deepseek-v4-pro", "deepseek-v4-flash"],
  };
  const index = priorities[provider]?.indexOf(model) ?? -1;
  return index === -1 ? 1000 : index;
}

function modelMetadata(model: ModelInfo): string {
  const parts = [
    model.reasoning ? "reasoning" : null,
    typeof model.limit?.context === "number"
      ? `${formatNumber(model.limit.context)} ctx`
      : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(
    value,
  );
}
