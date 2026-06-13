import { createDaemonMetadata, DaemonMetadataStore } from "./daemon-metadata.ts";
import {
  startDaemonServer,
  type DaemonServerOptions,
  type RunningDaemonServer,
} from "./daemon-server.ts";

export type DaemonRunnerOptions = DaemonServerOptions & {
  metadataStore?: DaemonMetadataStore;
  pid?: number;
  startedAt?: string;
};

export type RunningDaemon = {
  metadata: ReturnType<typeof createDaemonMetadata>;
  close(): Promise<void>;
};

export async function startDaemon(
  options: DaemonRunnerOptions = {},
): Promise<RunningDaemon> {
  const metadataStore = options.metadataStore ?? new DaemonMetadataStore();
  const server = await startDaemonServer(options);
  const metadata = createDaemonMetadata(
    options.pid ?? process.pid,
    server.port,
    options.startedAt,
  );

  try {
    await metadataStore.write(metadata);
  } catch (error) {
    await server.close();
    throw error;
  }

  let closePromise: Promise<void> | null = null;
  return {
    metadata,
    close() {
      closePromise ??= closeDaemon(server, metadataStore, metadata.pid);
      return closePromise;
    },
  };
}

async function closeDaemon(
  server: RunningDaemonServer,
  metadataStore: DaemonMetadataStore,
  pid: number,
): Promise<void> {
  let serverError: unknown;
  try {
    await server.close();
  } catch (error) {
    serverError = error;
  }

  await metadataStore.clear(pid);

  if (serverError) {
    throw serverError;
  }
}
