import { ensureDaemonProjectTarget } from "./daemon-client.ts";
import { recoverManagedServer } from "./runtime.ts";
import { isTransientServerError } from "../api/errors.ts";
import type { ChumpConfig } from "../core/types.ts";

export type ManagedRecoveryDependencies = {
  recoverThroughDaemon?: (workspaceRoot: string) => Promise<string>;
  recoverDirectly?: (
    workspaceRoot: string,
    previousUrl: string,
  ) => Promise<string>;
};

export type ServerRequestOptions = {
  canReplay?: (error: unknown) => boolean;
};

export type ServerRequestRunner = <T>(
  requestConfig: ChumpConfig,
  request: (config: ChumpConfig) => Promise<T>,
  options?: ServerRequestOptions,
) => Promise<T>;

export class ManagedServerRequestCoordinator {
  private recoveryPromise: Promise<void> | null = null;
  private readonly currentConfig: () => ChumpConfig;
  private readonly recoverServer: () => Promise<void>;

  constructor(
    currentConfig: () => ChumpConfig,
    recoverServer: () => Promise<void>,
  ) {
    this.currentConfig = currentConfig;
    this.recoverServer = recoverServer;
  }

  async run<T>(
    requestConfig: ChumpConfig,
    request: (config: ChumpConfig) => Promise<T>,
    options: ServerRequestOptions = {},
  ): Promise<T> {
    const initialTarget = this.latestTarget(requestConfig);
    const attemptedUrl = initialTarget.serverUrl;
    try {
      return await request(initialTarget);
    } catch (error) {
      if (!this.canRecover(error)) {
        throw error;
      }

      if (this.currentConfig().serverUrl === attemptedUrl) {
        await this.recover();
      }
      if (options.canReplay?.(error) === false) {
        throw error;
      }
      return await request(this.latestTarget(requestConfig));
    }
  }

  async recoverFromDisconnect(error: unknown): Promise<boolean> {
    if (!this.canRecover(error)) {
      return false;
    }
    await this.recover();
    return true;
  }

  private canRecover(error: unknown): boolean {
    return this.currentConfig().serverSource === "managed" &&
      isTransientServerError(error);
  }

  private async recover(): Promise<void> {
    this.recoveryPromise ??= this.recoverServer().finally(() => {
      this.recoveryPromise = null;
    });
    await this.recoveryPromise;
  }

  private latestTarget(requestConfig: ChumpConfig): ChumpConfig {
    const current = this.currentConfig();
    requestConfig.serverUrl = current.serverUrl;
    requestConfig.serverSource = current.serverSource;
    return requestConfig;
  }
}

export async function recoverManagedServerUrl(
  workspaceRoot: string,
  previousUrl: string,
  dependencies: ManagedRecoveryDependencies = {},
): Promise<string> {
  const recoverThroughDaemon =
    dependencies.recoverThroughDaemon ??
    (async (workspace) =>
      (await ensureDaemonProjectTarget(workspace)).runtime.serverUrl);
  const recoverDirectly =
    dependencies.recoverDirectly ??
    (async (workspace, previous) =>
      (await recoverManagedServer(workspace, previous)).metadata.url);

  try {
    return await recoverThroughDaemon(workspaceRoot);
  } catch {
    return await recoverDirectly(workspaceRoot, previousUrl);
  }
}
