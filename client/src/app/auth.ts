import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { intro, isCancel, outro, password, select, text } from "@clack/prompts";

import { connectCodexBrowser, connectCodexHeadless } from "./codex-auth.ts";
import { connectGitHubCopilot } from "./github-copilot-auth.ts";
import { connectXaiBrowser, connectXaiHeadless } from "./xai-auth.ts";

export const PROVIDERS = {
  codex: {
    label: "Codex",
    defaultModel: "gpt-5.4",
    fields: [],
  },
  github_copilot: {
    label: "GitHub Copilot",
    defaultModel: "gpt-5.4",
    fields: [],
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5.4",
    fields: [
      { key: "OPENAI_API_KEY", label: "OpenAI API key", secret: true },
      { key: "OPENAI_BASE_URL", label: "Base URL", optional: true },
      { key: "OPENAI_ORGANIZATION", label: "Organization", optional: true },
    ],
  },
  chump_cloud: {
    label: "Chump Cloud",
    defaultModel: "deepseek-v4-flash",
    fields: [],
  },
  opencode: {
    label: "OpenCode Zen",
    defaultModel: "gpt-5.4",
    fields: [{ key: "OPENCODE_API_KEY", label: "OpenCode API key", secret: true }],
  },
  opencode_go: {
    label: "OpenCode Go",
    defaultModel: "kimi-k2.6",
    fields: [{ key: "OPENCODE_API_KEY", label: "OpenCode API key", secret: true }],
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "anthropic/claude-sonnet-4.5",
    fields: [{ key: "OPENROUTER_API_KEY", label: "OpenRouter API key", secret: true }],
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    fields: [
      { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", secret: true },
      { key: "ANTHROPIC_BASE_URL", label: "Base URL", optional: true },
    ],
  },
  google: {
    label: "Google",
    defaultModel: "gemini-3.5-flash",
    fields: [{ key: "GOOGLE_API_KEY", label: "Google API key", secret: true }],
  },
  groq: {
    label: "Groq",
    defaultModel: "openai/gpt-oss-120b",
    fields: [{ key: "GROQ_API_KEY", label: "Groq API key", secret: true }],
  },
  xai: {
    label: "xAI",
    defaultModel: "grok-code-fast-1",
    fields: [],
  },
  deepseek: {
    label: "DeepSeek",
    defaultModel: "deepseek-v4-pro",
    fields: [
      { key: "DEEPSEEK_API_KEY", label: "DeepSeek API key", secret: true },
    ],
  },
  zenmux: {
    label: "ZenMux",
    defaultModel: "anthropic/claude-sonnet-4.5",
    fields: [{ key: "ZENMUX_API_KEY", label: "ZenMux API key", secret: true }],
  },
  workers_ai: {
    label: "Cloudflare Workers AI",
    defaultModel: "@cf/moonshotai/kimi-k2.5",
    fields: [
      { key: "CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare account ID" },
      {
        key: "CLOUDFLARE_API_TOKEN",
        label: "Cloudflare API token",
        secret: true,
      },
    ],
  },
} as const;

type ProviderId = keyof typeof PROVIDERS;

type AuthFile = {
  provider?: string;
  model?: string;
  reasoning?: Record<string, unknown>;
  credentials?: Record<string, Record<string, unknown>>;
};

export async function connectProvider(): Promise<void> {
  intro("Connect provider");
  const provider = await promptProvider();
  const definition = PROVIDERS[provider];
  let credentials: Record<string, unknown> = {};

  if (provider === "codex") {
    credentials = await promptCodexCredentials();
  } else if (provider === "github_copilot") {
    credentials = await promptGitHubCopilotCredentials();
  } else if (provider === "xai") {
    credentials = await promptXaiCredentials();
  } else {
    for (const field of definition.fields) {
      const optional = "optional" in field && field.optional === true;
      const value =
        "secret" in field && field.secret === true
          ? await promptPassword(field.label, optional)
          : await promptText(field.label, "", optional);
      if (value) {
        credentials[field.key] = value;
      }
    }
  }

  const authPath = globalAuthFilePath();
  const existing = await readAuthFile(authPath);
  const next: AuthFile = {
    ...existing,
    provider,
    credentials: {
      ...(existing.credentials ?? {}),
      [provider]: credentials,
    },
  };

  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(authPath, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(authPath, 0o600);
  outro(`Connected ${definition.label} (${displayPath(authPath)})`);
}

export function globalAuthFilePath(): string {
  return process.env.CHUMP_AUTH_FILE ?? path.join(globalDataDir(), "auth.json");
}

export function globalDataDir(): string {
  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, "chump");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "chump");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      "chump",
    );
  }
  return path.join(os.homedir(), ".local", "share", "chump");
}

async function readAuthFile(filePath: string): Promise<AuthFile> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as AuthFile;
  } catch {
    return {};
  }
}

export async function readGlobalAuth(): Promise<AuthFile> {
  return await readAuthFile(globalAuthFilePath());
}

export async function updateGlobalAuth(
  update: Partial<AuthFile>,
): Promise<AuthFile> {
  const authPath = globalAuthFilePath();
  const existing = await readAuthFile(authPath);
  const next = {
    ...existing,
    ...update,
    credentials: {
      ...(existing.credentials ?? {}),
      ...(update.credentials ?? {}),
    },
  };
  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(authPath, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(authPath, 0o600);
  return next;
}

async function promptProvider(): Promise<ProviderId> {
  const value = await select({
    message: "Provider",
    options: Object.entries(PROVIDERS).map(([id, provider]) => ({
      value: id,
      label: provider.label,
    })),
  });
  cancelIfNeeded(value);
  return value as ProviderId;
}

async function promptCodexCredentials(): Promise<Record<string, unknown>> {
  const method = await select({
    message: "Login method",
    options: [
      { value: "browser", label: "ChatGPT Pro/Plus (browser)" },
      { value: "headless", label: "ChatGPT Pro/Plus (headless)" },
    ],
  });
  cancelIfNeeded(method);

  if (method === "headless") {
    return await connectCodexHeadless((url, code) => {
      console.log(`Open ${url}`);
      console.log(`Enter code: ${code}`);
    });
  }

  console.log("Opening browser for ChatGPT authorization...");
  return await connectCodexBrowser();
}

async function promptGitHubCopilotCredentials(): Promise<Record<string, unknown>> {
  const deploymentType = await select({
    message: "GitHub deployment",
    options: [
      { value: "github.com", label: "GitHub.com" },
      { value: "enterprise", label: "GitHub Enterprise" },
    ],
  });
  cancelIfNeeded(deploymentType);

  let enterpriseUrl: string | undefined;
  if (deploymentType === "enterprise") {
    const value = await text({
      message: "GitHub Enterprise URL or domain",
      placeholder: "company.ghe.com or https://company.ghe.com",
      validate: (input) => {
        if (!input) {
          return "Required";
        }
        try {
          const url = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
          return url.hostname ? undefined : "Enter a valid URL or domain";
        } catch {
          return "Enter a valid URL or domain";
        }
      },
    });
    cancelIfNeeded(value);
    enterpriseUrl = String(value).trim();
  }

  return await connectGitHubCopilot((url, code) => {
    console.log(`Open ${url}`);
    console.log(`Enter code: ${code}`);
  }, enterpriseUrl);
}

async function promptXaiCredentials(): Promise<Record<string, unknown>> {
  const method = await select({
    message: "Login method",
    options: [
      { value: "browser", label: "Grok subscription (browser)" },
      { value: "headless", label: "Grok subscription (headless / remote)" },
      { value: "api", label: "Manually enter API key" },
    ],
  });
  cancelIfNeeded(method);

  if (method === "api") {
    const apiKey = await promptPassword("xAI API key", false);
    return { XAI_API_KEY: apiKey };
  }

  if (method === "headless") {
    return await connectXaiHeadless((url, code) => {
      console.log(`Open ${url}`);
      console.log(`Enter code: ${code}`);
    });
  }

  console.log("Opening browser for xAI authorization...");
  return await connectXaiBrowser();
}

async function promptText(
  message: string,
  placeholder: string,
  optional = false,
): Promise<string> {
  const value = await text({
    message,
    placeholder,
    defaultValue: placeholder || undefined,
    validate: (input) => (!optional && !input ? "Required" : undefined),
  });
  cancelIfNeeded(value);
  return String(value || placeholder).trim();
}

async function promptPassword(
  message: string,
  optional: boolean,
): Promise<string> {
  const value = await password({
    message,
    validate: (input) => (!optional && !input ? "Required" : undefined),
  });
  cancelIfNeeded(value);
  return String(value || "").trim();
}

function cancelIfNeeded(value: unknown): void {
  if (isCancel(value)) {
    outro("Cancelled");
    process.exit(130);
  }
}

function displayPath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? filePath.replace(home, "~") : filePath;
}
