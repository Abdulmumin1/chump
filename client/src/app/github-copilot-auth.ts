import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";

const CLIENT_ID = "Ov23li8tweQw6odWQebz";
const POLLING_SAFETY_MS = 3000;

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  interval: number;
  verification_uri?: string;
};

type TokenResponse = {
  access_token?: string;
  error?: string;
  interval?: number;
};

type GitHubCopilotCredentials = {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  enterprise_url?: string;
};

export async function connectGitHubCopilot(
  onCode: (url: string, code: string) => void,
  enterpriseUrl?: string,
): Promise<GitHubCopilotCredentials> {
  const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : "github.com";
  const deviceCodeUrl = `https://${domain}/login/device/code`;
  const accessTokenUrl = `https://${domain}/login/oauth/access_token`;

  const deviceResponse = await fetch(deviceCodeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": userAgent(),
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: "read:user",
    }),
  });

  if (!deviceResponse.ok) {
    throw new Error("failed to initiate GitHub Copilot device authorization");
  }

  const deviceData = await deviceResponse.json() as DeviceCodeResponse;
  if (!deviceData.device_code || !deviceData.user_code) {
    throw new Error("GitHub Copilot device authorization did not return a device code");
  }

  const verificationUrl =
    deviceData.verification_uri || `https://${domain}/login/device`;
  onCode(verificationUrl, deviceData.user_code);

  while (true) {
    const response = await fetch(accessTokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": userAgent(),
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceData.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub Copilot authorization failed with ${response.status}`);
    }

    const data = await response.json() as TokenResponse;
    if (data.access_token) {
      return {
        type: "oauth",
        access: data.access_token,
        refresh: data.access_token,
        expires: 0,
        ...(enterpriseUrl ? { enterprise_url: domain } : {}),
      };
    }

    if (data.error === "authorization_pending") {
      await sleep(((data.interval ?? deviceData.interval ?? 5) * 1000) + POLLING_SAFETY_MS);
      continue;
    }

    if (data.error === "slow_down") {
      const nextInterval = (data.interval ?? (deviceData.interval ?? 5) + 5) * 1000;
      await sleep(nextInterval + POLLING_SAFETY_MS);
      continue;
    }

    if (data.error) {
      throw new Error(`GitHub Copilot authorization failed: ${data.error}`);
    }

    throw new Error("GitHub Copilot authorization failed");
  }
}

function normalizeDomain(value: string): string {
  return value.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
}

function userAgent(): string {
  return `chump (${os.platform()} ${os.release()}; ${os.arch()})`;
}
