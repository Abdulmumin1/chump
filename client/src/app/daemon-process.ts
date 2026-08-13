import { startDaemon } from "./daemon-runner.ts";
import { DEFAULT_DAEMON_PORT } from "./daemon-port.ts";

export async function runDaemonProcess(): Promise<void> {
  process.title = "Chump Agent (Daemon)";
  const configuredPort = readConfiguredDaemonPort();
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

export function readConfiguredDaemonPort(): number {
  const rawPort = process.env.CHUMP_DAEMON_PORT;
  if (!rawPort) return DEFAULT_DAEMON_PORT;
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid CHUMP_DAEMON_PORT: ${rawPort}`);
  }
  return port;
}
