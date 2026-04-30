import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import crypto from "node:crypto";
import os from "node:os";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const OAUTH_PORT = 1455;
const POLLING_SAFETY_MS = 3000;

type TokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

type CodexCredentials = {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  account_id?: string;
};

type PkceCodes = {
  verifier: string;
  challenge: string;
};

export async function connectCodexBrowser(): Promise<CodexCredentials> {
  const pkce = await generatePkce();
  const state = base64Url(crypto.randomBytes(32));
  const redirectUri = `http://localhost:${OAUTH_PORT}/auth/callback`;
  const callback = waitForBrowserCallback(pkce, state);
  const authUrl = buildAuthorizeUrl(redirectUri, pkce, state);
  openBrowser(authUrl);
  const tokens = await callback;
  return credentialsFromTokens(tokens);
}

export async function connectCodexHeadless(
  onCode: (url: string, code: string) => void,
): Promise<CodexCredentials> {
  const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent(),
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!deviceResponse.ok) {
    throw new Error("failed to initiate device authorization");
  }

  const deviceData = await deviceResponse.json() as {
    device_auth_id: string;
    user_code: string;
    interval: string;
  };
  const interval = Math.max(Number.parseInt(deviceData.interval, 10) || 5, 1) * 1000;
  onCode(`${ISSUER}/codex/device`, deviceData.user_code);

  while (true) {
    const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent(),
      },
      body: JSON.stringify({
        device_auth_id: deviceData.device_auth_id,
        user_code: deviceData.user_code,
      }),
    });

    if (response.ok) {
      const data = await response.json() as {
        authorization_code: string;
        code_verifier: string;
      };
      const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: data.authorization_code,
          redirect_uri: `${ISSUER}/deviceauth/callback`,
          client_id: CLIENT_ID,
          code_verifier: data.code_verifier,
        }).toString(),
      });
      if (!tokenResponse.ok) {
        throw new Error(`token exchange failed with ${tokenResponse.status}`);
      }
      return credentialsFromTokens(await tokenResponse.json() as TokenResponse);
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`device authorization failed with ${response.status}`);
    }

    await sleep(interval + POLLING_SAFETY_MS);
  }
}

async function waitForBrowserCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return await new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${OAUTH_PORT}`);
      if (url.pathname !== "/auth/callback") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      if (error) {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<h1>Authorization failed</h1><pre>${escapeHtml(error)}</pre>`);
        server.close();
        reject(new Error(error));
        return;
      }

      const code = url.searchParams.get("code");
      const receivedState = url.searchParams.get("state");
      if (!code || receivedState !== state) {
        const message = "invalid OAuth callback";
        response.writeHead(400, { "Content-Type": "text/html" });
        response.end(`<h1>${message}</h1>`);
        server.close();
        reject(new Error(message));
        return;
      }

      exchangeCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, pkce)
        .then(resolve)
        .catch(reject)
        .finally(() => server.close());
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<h1>Authorization successful</h1><p>You can close this window and return to Chump.</p>");
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth callback timeout"));
    }, 5 * 60 * 1000);
    server.listen(OAUTH_PORT, () => {});
    server.on("close", () => clearTimeout(timeout));
    server.on("error", reject);
  });
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: PkceCodes,
): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`token exchange failed with ${response.status}`);
  }
  return await response.json() as TokenResponse;
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "chump",
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

async function generatePkce(): Promise<PkceCodes> {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function credentialsFromTokens(tokens: TokenResponse): CodexCredentials {
  const accountId = extractAccountId(tokens);
  return {
    type: "oauth",
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ...(accountId ? { account_id: accountId } : {}),
  };
}

function extractAccountId(tokens: TokenResponse): string | null {
  for (const token of [tokens.id_token, tokens.access_token]) {
    const claims = parseJwtClaims(token);
    const accountId =
      stringValue(claims?.chatgpt_account_id) ??
      stringValue(claims?.["https://api.openai.com/auth"]?.chatgpt_account_id) ??
      stringValue(claims?.organizations?.[0]?.id);
    if (accountId) {
      return accountId;
    }
  }
  return null;
}

function parseJwtClaims(token: string | undefined): Record<string, any> | null {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, any>;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function userAgent(): string {
  return `chump (${os.platform()} ${os.release()}; ${os.arch()})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
