import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
	plugins: [localDaemonBootstrap(), tailwindcss(), sveltekit()],
	ssr: {
		noExternal: ['bits-ui']
	}
});

function localDaemonBootstrap(): Plugin {
	return {
		name: 'chump-local-daemon-bootstrap',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use('/api/local-daemon/bootstrap', async (request, response) => {
				if (!isLoopbackRequest(request.socket.remoteAddress, request.headers.host)) {
					response.statusCode = 403;
					response.end();
					return;
				}
				if (request.method !== 'GET') {
					response.statusCode = 405;
					response.end();
					return;
				}

				try {
					const dataDir = process.env.CHUMP_GLOBAL_STATE_DIR
						? path.resolve(process.env.CHUMP_GLOBAL_STATE_DIR)
						: defaultChumpStateDir();
					const [metadataRaw, authRaw] = await Promise.all([
						readFile(path.join(dataDir, 'daemon.json'), 'utf8'),
						readFile(path.join(dataDir, 'daemon-auth.json'), 'utf8')
					]);
					const metadata = JSON.parse(metadataRaw) as { url?: unknown };
					const auth = JSON.parse(authRaw) as { token?: unknown };
					if (typeof metadata.url !== 'string' || typeof auth.token !== 'string') {
						throw new Error('invalid daemon bootstrap files');
					}

					response.setHeader('content-type', 'application/json');
					response.setHeader('cache-control', 'no-store');
					response.end(JSON.stringify({ url: metadata.url, token: auth.token }));
				} catch {
					response.statusCode = 404;
					response.setHeader('content-type', 'application/json');
					response.setHeader('cache-control', 'no-store');
					response.end(JSON.stringify({ error: 'local_daemon_unavailable' }));
				}
			});
		}
	};
}

function isLoopbackRequest(remoteAddress: string | undefined, host: string | undefined): boolean {
	const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
	if (!remoteAddress || !loopbackAddresses.has(remoteAddress) || !host) {
		return false;
	}
	try {
		const hostname = new URL(`http://${host}`).hostname;
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
	} catch {
		return false;
	}
}

function defaultChumpStateDir(): string {
	if (process.env.XDG_STATE_HOME) {
		return path.join(process.env.XDG_STATE_HOME, 'chump');
	}
	if (process.platform === 'darwin') {
		return path.join(os.homedir(), 'Library', 'Application Support', 'chump');
	}
	if (process.platform === 'win32') {
		return path.join(
			process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
			'chump'
		);
	}
	return path.join(os.homedir(), '.local', 'state', 'chump');
}
