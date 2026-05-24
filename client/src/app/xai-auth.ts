import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import crypto from "node:crypto";
import os from "node:os";

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const AUTHORIZE_URL = "https://auth.x.ai/oauth2/authorize";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code";
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
const OAUTH_HOST = "127.0.0.1";
const OAUTH_PORT = 56121;
const OAUTH_REDIRECT_PATH = "/callback";
const REDIRECT_URI = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`;
const POLLING_SAFETY_MS = 3000;

type XaiCredentials = {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
};

type PkceCodes = {
  verifier: string;
  challenge: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  interval?: number;
};

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
};

export async function connectXaiBrowser(): Promise<XaiCredentials> {
  const pkce = generatePkce();
  const state = base64Url(crypto.randomBytes(32));
  const nonce = base64Url(crypto.randomBytes(32));
  const callback = waitForBrowserCallback(pkce, state);
  const authUrl = buildAuthorizeUrl(pkce, state, nonce);
  openBrowser(authUrl);
  const tokens = await callback;
  return credentialsFromTokens(tokens);
}

export async function connectXaiHeadless(
  onCode: (url: string, code: string) => void,
): Promise<XaiCredentials> {
  const device = await requestDeviceCode();
  onCode(device.verification_uri_complete ?? device.verification_uri, device.user_code);
  const tokens = await pollDeviceCodeToken(device);
  return credentialsFromTokens(tokens);
}

function buildAuthorizeUrl(pkce: PkceCodes, state: string, nonce: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    plan: "generic",
    referrer: "chump",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_AUTHORIZATION_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`xAI device code request failed with ${response.status}`);
  }

  const json = await response.json() as DeviceCodeResponse;
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("xAI device code response is missing required fields");
  }
  return json;
}

async function pollDeviceCodeToken(device: DeviceCodeResponse): Promise<TokenResponse> {
  const expiresInMs = Math.max((device.expires_in ?? 300) * 1000, 1000);
  const deadline = Date.now() + expiresInMs;
  let intervalMs = Math.max((device.interval ?? 5) * 1000, 1000);

  while (Date.now() < deadline) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: authHeaders(),
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT_TYPE,
        client_id: CLIENT_ID,
        device_code: device.device_code,
      }).toString(),
    });

    if (response.ok) {
      return await response.json() as TokenResponse;
    }

    const body = await response.json().catch(() => ({})) as TokenResponse;
    if (body.error === "authorization_pending") {
      await sleep(Math.min(intervalMs + POLLING_SAFETY_MS, Math.max(0, deadline - Date.now())));
      continue;
    }

    if (body.error === "slow_down") {
      intervalMs += 5000;
      await sleep(Math.min(intervalMs + POLLING_SAFETY_MS, Math.max(0, deadline - Date.now())));
      continue;
    }

    if (body.error === "access_denied" || body.error === "authorization_denied") {
      throw new Error("xAI device authorization was denied");
    }

    if (body.error === "expired_token") {
      throw new Error("xAI device code expired");
    }

    throw new Error(body.error_description || body.error || `xAI device authorization failed with ${response.status}`);
  }

  throw new Error("xAI device authorization timed out");
}

async function waitForBrowserCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return await new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);
      if (url.pathname !== OAUTH_REDIRECT_PATH) {
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
        response.writeHead(400, { "Content-Type": "text/html" });
        response.end("<h1>Invalid OAuth callback</h1>");
        server.close();
        reject(new Error("invalid OAuth callback"));
        return;
      }

      exchangeCodeForTokens(code, pkce)
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

    server.listen(OAUTH_PORT, OAUTH_HOST, () => {});
    server.on("close", () => clearTimeout(timeout));
    server.on("error", reject);
  });
}

async function exchangeCodeForTokens(code: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`xAI token exchange failed with ${response.status}`);
  }

  return await response.json() as TokenResponse;
}

function credentialsFromTokens(tokens: TokenResponse): XaiCredentials {
  return {
    type: "oauth",
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
}

function generatePkce(): PkceCodes {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function authHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": userAgent(),
  };
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function userAgent(): string {
  return `chump (${os.platform()} ${os.release()}; ${os.arch()})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}
