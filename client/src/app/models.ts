import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { globalDataDir } from "./auth.ts";

const MODELS_TTL_MS = 5 * 60 * 1000;
let modelCatalogPromise: Promise<Record<string, ModelProvider>> | null = null;
const CODEX_MODELS = new Set([
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
]);

const SUPPORTED_MODELS: Record<string, Set<string>> = {
  codex: new Set(CODEX_MODELS),
  github_copilot: new Set([
    "gpt-5.4",
  ]),
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
  ]),
  chump_cloud: new Set(["deepseek-v4-pro", "deepseek-v4-flash"]),
  opencode: new Set([
    "gpt-5.5",
    "gpt-5.4",
    "claude-sonnet-4-5",
    "gemini-3.1-pro",
    "glm-5.1",
    "qwen3.6-plus",
    "minimax-m2.7",
    "deepseek-v4-flash-free",
  ]),
  opencode_go: new Set([
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "glm-5",
    "glm-5.1",
    "mimo-v2.5",
    "mimo-v2.5-pro",
    "minimax-m2.5",
    "minimax-m2.7",
    "qwen3.5-plus",
    "qwen3.6-plus",
  ]),
  openrouter: new Set([
    "openai/gpt-5.5",
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4.5",
    "deepseek/deepseek-v4-pro",
    "qwen/qwen3.6-plus",
  ]),
  google: new Set([
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
  ]),
  anthropic: new Set(["claude-sonnet-4-20250514"]),
  groq: new Set([
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3-32b",
    "groq/compound-mini",
  ]),
  xai: new Set([
    "grok-4.3",
    "grok-4-1-fast",
    "grok-4-fast",
    "grok-code-fast-1",
  ]),
  workers_ai: new Set([
    "@cf/zai-org/glm-5.2",
    "@cf/zai-org/glm-4.7-flash",
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/moonshotai/kimi-k2.7-code",
  ]),
  deepseek: new Set(["deepseek-v4-pro", "deepseek-v4-flash"]),
  zenmux: new Set([
    "openai/gpt-5.5",
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4.5",
    "deepseek/deepseek-v4-pro",
    "qwen/qwen3.6-plus",
    "x-ai/grok-4.1-fast",
    "z-ai/glm-5.1",
    "volcengine/doubao-seed-code",
  ]),
};

const FALLBACK_MODELS: Record<string, ModelProvider> = {
  codex: {
    id: "codex",
    name: "Codex",
    models: {
      "gpt-5.6": {
        id: "gpt-5.6",
        name: "GPT-5.6",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "gpt-5.6-sol": {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "gpt-5.6-terra": {
        id: "gpt-5.6-terra",
        name: "GPT-5.6 Terra",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "gpt-5.6-luna": {
        id: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", reasoning: true },
      "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
      "gpt-5.4-mini": {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        reasoning: true,
      },
    },
  },
  github_copilot: {
    id: "github_copilot",
    name: "GitHub Copilot",
    models: {
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
      },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-5.6": {
        id: "gpt-5.6",
        name: "GPT-5.6",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "gpt-5.6-sol": {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "gpt-5.6-terra": {
        id: "gpt-5.6-terra",
        name: "GPT-5.6 Terra",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "gpt-5.6-luna": {
        id: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
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
  opencode: {
    id: "opencode",
    name: "OpenCode Zen",
    models: {
      "gpt-5.5": {
        id: "gpt-5.5",
        name: "GPT-5.5",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        limit: { context: 1_000_000, output: 64_000 },
      },
      "gemini-3.1-pro": {
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        reasoning: true,
        limit: { context: 1_048_576, output: 65_536 },
      },
      "glm-5.1": {
        id: "glm-5.1",
        name: "GLM-5.1",
        reasoning: true,
        limit: { context: 204_800, output: 131_072 },
      },
      "qwen3.6-plus": {
        id: "qwen3.6-plus",
        name: "Qwen3.6 Plus",
        reasoning: true,
        limit: { context: 262_144, output: 65_536 },
      },
      "minimax-m2.7": {
        id: "minimax-m2.7",
        name: "MiniMax M2.7",
        reasoning: true,
        limit: { context: 204_800, output: 131_072 },
      },
      "deepseek-v4-flash-free": {
        id: "deepseek-v4-flash-free",
        name: "DeepSeek V4 Flash Free",
        reasoning: true,
        limit: { context: 1_000_000, output: 384_000 },
      },
    },
  },
  opencode_go: {
    id: "opencode_go",
    name: "OpenCode Go",
    models: {
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        reasoning: true,
        limit: { context: 1_000_000, output: 384_000 },
      },
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        limit: { context: 1_000_000, output: 384_000 },
      },
      "glm-5": {
        id: "glm-5",
        name: "GLM-5",
        reasoning: true,
        limit: { context: 202_752, output: 32_768 },
      },
      "glm-5.1": {
        id: "glm-5.1",
        name: "GLM-5.1",
        reasoning: true,
        limit: { context: 202_752, output: 32_768 },
      },
      "mimo-v2.5": {
        id: "mimo-v2.5",
        name: "MiMo V2.5",
        reasoning: true,
        limit: { context: 1_000_000, output: 128_000 },
      },
      "mimo-v2.5-pro": {
        id: "mimo-v2.5-pro",
        name: "MiMo V2.5 Pro",
        reasoning: true,
        limit: { context: 1_048_576, output: 128_000 },
      },
      "minimax-m2.5": {
        id: "minimax-m2.5",
        name: "MiniMax M2.5",
        reasoning: true,
        limit: { context: 204_800, output: 65_536 },
      },
      "minimax-m2.7": {
        id: "minimax-m2.7",
        name: "MiniMax M2.7",
        reasoning: true,
        limit: { context: 204_800, output: 131_072 },
      },
      "qwen3.5-plus": {
        id: "qwen3.5-plus",
        name: "Qwen3.5 Plus",
        reasoning: true,
        limit: { context: 262_144, output: 65_536 },
      },
      "qwen3.6-plus": {
        id: "qwen3.6-plus",
        name: "Qwen3.6 Plus",
        reasoning: true,
        limit: { context: 262_144, output: 65_536 },
      },
    },
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    models: {
      "openai/gpt-5.5": {
        id: "openai/gpt-5.5",
        name: "OpenAI GPT-5.5",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "openai/gpt-5.4": {
        id: "openai/gpt-5.4",
        name: "OpenAI GPT-5.4",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "anthropic/claude-sonnet-4.5": {
        id: "anthropic/claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        limit: { context: 1_000_000, output: 64_000 },
      },
      "deepseek/deepseek-v4-pro": {
        id: "deepseek/deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        limit: { context: 1_048_576, output: 393_216 },
      },
      "qwen/qwen3.6-plus": {
        id: "qwen/qwen3.6-plus",
        name: "Qwen3.6 Plus",
        reasoning: true,
        limit: { context: 1_000_000, output: 65_536 },
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
      "gemini-3.6-flash": {
        id: "gemini-3.6-flash",
        name: "Gemini 3.6 Flash",
        reasoning: true,
        limit: { context: 1_048_576, output: 65_536 },
      },
      "gemini-3.5-flash-lite": {
        id: "gemini-3.5-flash-lite",
        name: "Gemini 3.5 Flash Lite",
        reasoning: true,
        limit: { context: 1_048_576, output: 65_536 },
      },
      "gemini-3.5-flash": {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        reasoning: true,
        limit: { context: 1_048_576, output: 65_536 },
      },
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
    },
  },
  groq: {
    id: "groq",
    name: "Groq",
    models: {
      "openai/gpt-oss-120b": {
        id: "openai/gpt-oss-120b",
        name: "GPT OSS 120B",
        reasoning: true,
        limit: { context: 131_072, output: 65_536 },
      },
      "openai/gpt-oss-20b": {
        id: "openai/gpt-oss-20b",
        name: "GPT OSS 20B",
        reasoning: true,
        limit: { context: 131_072, output: 65_536 },
      },
      "qwen/qwen3-32b": {
        id: "qwen/qwen3-32b",
        name: "Qwen3 32B",
        reasoning: true,
        limit: { context: 131_072, output: 40_960 },
      },
      "groq/compound-mini": {
        id: "groq/compound-mini",
        name: "Compound Mini",
        reasoning: true,
        limit: { context: 131_072, output: 8_192 },
      },
    },
  },
  xai: {
    id: "xai",
    name: "xAI",
    models: {
      "grok-4.3": {
        id: "grok-4.3",
        name: "Grok 4.3",
        reasoning: true,
        limit: { context: 1_000_000, output: 30_000 },
      },
      "grok-4-1-fast": {
        id: "grok-4-1-fast",
        name: "Grok 4.1 Fast",
        reasoning: true,
        limit: { context: 2_000_000, output: 30_000 },
      },
      "grok-4-fast": {
        id: "grok-4-fast",
        name: "Grok 4 Fast",
        reasoning: true,
        limit: { context: 2_000_000, output: 30_000 },
      },
      "grok-code-fast-1": {
        id: "grok-code-fast-1",
        name: "Grok Code Fast 1",
        reasoning: true,
        limit: { context: 256_000, output: 10_000 },
      },
    },
  },
  workers_ai: {
    id: "workers_ai",
    name: "Cloudflare Workers AI",
    models: {
      "@cf/zai-org/glm-5.2": {
        id: "@cf/zai-org/glm-5.2",
        name: "GLM-5.2",
        reasoning: true,
        limit: { context: 262_144 },
      },
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
      "@cf/moonshotai/kimi-k2.7-code": {
        id: "@cf/moonshotai/kimi-k2.7-code",
        name: "Kimi K2.7 Code",
        reasoning: true,
        limit: { context: 262_144, output: 262_144 },
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
  zenmux: {
    id: "zenmux",
    name: "ZenMux",
    models: {
      "openai/gpt-5.5": {
        id: "openai/gpt-5.5",
        name: "OpenAI GPT-5.5",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "openai/gpt-5.4": {
        id: "openai/gpt-5.4",
        name: "OpenAI GPT-5.4",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
      },
      "anthropic/claude-sonnet-4.5": {
        id: "anthropic/claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        limit: { context: 1_000_000, output: 64_000 },
      },
      "deepseek/deepseek-v4-pro": {
        id: "deepseek/deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        limit: { context: 1_000_000, output: 384_000 },
      },
      "qwen/qwen3.6-plus": {
        id: "qwen/qwen3.6-plus",
        name: "Qwen3.6 Plus",
        reasoning: true,
        limit: { context: 1_000_000, output: 64_000 },
      },
      "x-ai/grok-4.1-fast": {
        id: "x-ai/grok-4.1-fast",
        name: "Grok 4.1 Fast",
        reasoning: true,
        limit: { context: 2_000_000, output: 64_000 },
      },
      "z-ai/glm-5.1": {
        id: "z-ai/glm-5.1",
        name: "GLM-5.1",
        reasoning: true,
        limit: { context: 200_000, output: 131_072 },
      },
      "volcengine/doubao-seed-code": {
        id: "volcengine/doubao-seed-code",
        name: "Doubao Seed Code",
        reasoning: true,
        limit: { context: 256_000, output: 64_000 },
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
  availableModels?: Record<string, readonly string[]>,
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
    const serverModels = availableModels?.[provider];
    const serverModelSet = serverModels ? new Set(serverModels) : null;
    return Object.values(entry.models)
      .filter((model) => serverModelSet === null || serverModelSet.has(model.id))
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

export async function getModelContextLabel(
  provider: string,
  model: string,
): Promise<string | null> {
  const limit = await getModelContextLimit(provider, model);
  if (limit === null) {
    return null;
  }
  return `ctx ${formatNumber(limit)}`;
}

export async function getModelContextLimit(
  provider: string,
  model: string,
): Promise<number | null> {
  const catalog = await loadModelCatalog();
  const entry =
    catalog[modelCatalogProviderId(provider)] ?? FALLBACK_MODELS[provider];
  const info = entry?.models[model];
  if (typeof info?.limit?.context !== "number") {
    return null;
  }
  return info.limit.context;
}

async function loadModelCatalog(): Promise<Record<string, ModelProvider>> {
  if (modelCatalogPromise) {
    return await modelCatalogPromise;
  }
  modelCatalogPromise = loadModelCatalogInternal();
  return await modelCatalogPromise;
}

async function loadModelCatalogInternal(): Promise<Record<string, ModelProvider>> {
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
  const merged: Record<string, ModelProvider> = { ...FALLBACK_MODELS };
  for (const [provider, entry] of Object.entries(
    value as Record<string, ModelProvider>,
  )) {
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

function modelCatalogProviderId(provider: string): string {
  if (provider === "codex") {
    return "openai";
  }
  if (provider === "github_copilot") {
    return "github-copilot";
  }
  if (provider === "chump_cloud") {
    return "deepseek";
  }
  if (provider === "opencode_go") {
    return "opencode-go";
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
  if (!SUPPORTED_MODELS[provider]?.has(model.id)) {
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
  if (
    /(image|imagen|gpt-image|dall-e|flux|sdxl|stable-diffusion|midjourney|recraft|tts|whisper|transcribe|vision-preview)/u.test(
      lower,
    )
  ) {
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
    ],
    chump_cloud: [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ],
    opencode: [
      "gpt-5.5",
      "gpt-5.4",
      "claude-sonnet-4-5",
      "gemini-3.1-pro",
      "glm-5.1",
      "qwen3.6-plus",
      "minimax-m2.7",
      "deepseek-v4-flash-free",
    ],
    opencode_go: [
      "deepseek-v4-flash",
      "qwen3.6-plus",
      "glm-5.1",
      "minimax-m2.7",
      "mimo-v2.5-pro",
      "deepseek-v4-pro",
      "qwen3.5-plus",
      "glm-5",
      "minimax-m2.5",
      "mimo-v2.5",
    ],
    openrouter: [
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-5.5",
      "openai/gpt-5.4",
      "deepseek/deepseek-v4-pro",
      "qwen/qwen3.6-plus",
    ],
    codex: [
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ],
    github_copilot: [
      "gpt-5.4",
    ],
    google: [
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
    ],
    groq: [
      "openai/gpt-oss-120b",
      "qwen/qwen3-32b",
      "groq/compound-mini",
      "openai/gpt-oss-20b",
    ],
    xai: [
      "grok-code-fast-1",
      "grok-4.3",
      "grok-4-1-fast",
      "grok-4-fast",
    ],
    workers_ai: [
      "@cf/zai-org/glm-5.2",
      "@cf/moonshotai/kimi-k2.7-code",
      "@cf/zai-org/glm-4.7-flash",
      "@cf/nvidia/nemotron-3-120b-a12b",
    ],
    deepseek: ["deepseek-v4-pro", "deepseek-v4-flash"],
    zenmux: [
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-5.5",
      "openai/gpt-5.4",
      "deepseek/deepseek-v4-pro",
      "qwen/qwen3.6-plus",
      "x-ai/grok-4.1-fast",
      "z-ai/glm-5.1",
      "volcengine/doubao-seed-code",
    ],
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
