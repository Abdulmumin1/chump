import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
	plugins: [localServiceBootstrap(), tailwindcss(), sveltekit()],
	build: {
		// Pierre's diff viewer emits optional Shiki language and WASM chunks.
		// Keep the warning above those lazy assets so future bundle growth still surfaces.
		chunkSizeWarningLimit: 800
	},
	ssr: {
		noExternal: ['bits-ui']
	}
});

function localServiceBootstrap(): Plugin {
	return {
		name: 'chump-local-service-bootstrap',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use('/api/local-service/bootstrap', async (request, response) => {
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
					const registrationRaw = await readFile(path.join(dataDir, 'service.json'), 'utf8');
					const registration = JSON.parse(registrationRaw) as { url?: unknown; token?: unknown };
					if (typeof registration.url !== 'string' || typeof registration.token !== 'string') {
						throw new Error('invalid local service bootstrap file');
					}

					response.setHeader('content-type', 'application/json');
					response.setHeader('cache-control', 'no-store');
					response.end(JSON.stringify({ url: registration.url, token: registration.token }));
				} catch {
					response.statusCode = 404;
					response.setHeader('content-type', 'application/json');
					response.setHeader('cache-control', 'no-store');
					response.end(JSON.stringify({ error: 'local_service_unavailable' }));
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
