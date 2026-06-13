import { ensureDaemonProjectTarget } from "./daemon-client.ts";
import { recoverManagedServer } from "./runtime.ts";

export type ManagedRecoveryDependencies = {
  recoverThroughDaemon?: (workspaceRoot: string) => Promise<string>;
  recoverDirectly?: (
    workspaceRoot: string,
    previousUrl: string,
  ) => Promise<string>;
};

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
