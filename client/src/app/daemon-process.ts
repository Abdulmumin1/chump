import { startDaemon } from "./daemon-runner.ts";

export async function runDaemonProcess(): Promise<void> {
  process.title = "Chump Agent (Daemon)";
  const configuredPort = readConfiguredPort();
  const daemon = await startDaemon({
    port: configuredPort,
  });

  await new Promise<void>((resolve, reject) => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void daemon.close().then(resolve, reject);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function readConfiguredPort(): number | undefined {
  const rawPort = process.env.CHUMP_DAEMON_PORT;
  if (!rawPort) return undefined;
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid CHUMP_DAEMON_PORT: ${rawPort}`);
  }
  return port;
}
