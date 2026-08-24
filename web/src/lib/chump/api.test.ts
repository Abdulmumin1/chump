import { afterEach, describe, expect, it } from 'vitest';

import {
	getSessions,
	openEventStream,
	terminalTargetIdentity,
	terminalWebSocketConnection
} from '$lib/chump/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('session listing', () => {
	it('requests ten sessions by default', async () => {
		let requestUrl = new URL('http://unused.test');
		globalThis.fetch = (async (input: string | URL | Request) => {
			requestUrl = new URL(String(input));
			return new Response(
				JSON.stringify({ sessions: [], page: 1, page_size: 10, total: 0, total_pages: 1 }),
				{ status: 200 }
			);
		}) as typeof fetch;

		await getSessions({ kind: 'direct', serverUrl: 'http://127.0.0.1:8000' });

		expect(requestUrl.searchParams.get('limit')).toBe('10');
	});
});

describe('terminal websocket connection', () => {
	it('builds a direct websocket URL without putting credentials in it', () => {
		const connection = terminalWebSocketConnection(
			{ kind: 'direct', serverUrl: 'https://share.example/' },
			{ cols: 100, rows: 30, theme: 'light' }
		);

		expect(connection.url).toBe('wss://share.example/terminal?cols=100&rows=30&theme=light');
		expect(connection.protocols).toEqual(['chump-terminal-v1']);
	});

	it('carries local service auth in a websocket subprotocol instead of the URL', () => {
		const connection = terminalWebSocketConnection(
			{
				kind: 'service',
				serviceUrl: 'http://127.0.0.1:38136',
				token: 'secret-token',
				projectId: 'project one'
			},
			{ cols: 80, rows: 24, theme: 'dark' }
		);

		expect(connection.url).toBe(
			'ws://127.0.0.1:38136/projects/project%20one/terminal?cols=80&rows=24&theme=dark'
		);
		expect(connection.url).not.toContain('secret-token');
		expect(connection.protocols).toEqual(['chump-terminal-v1', 'chump-auth.secret-token']);
	});

	it('changes identity when a terminal is retargeted', () => {
		const direct = terminalTargetIdentity({
			kind: 'direct',
			serverUrl: 'http://127.0.0.1:8000/'
		});
		const localService = terminalTargetIdentity({
			kind: 'service',
			serviceUrl: 'http://127.0.0.1:38136',
			token: 'token-one',
			projectId: 'project-one'
		});
		const rotatedToken = terminalTargetIdentity({
			kind: 'service',
			serviceUrl: 'http://127.0.0.1:38136',
			token: 'token-two',
			projectId: 'project-one'
		});

		expect(direct).not.toBe(localService);
		expect(localService).not.toBe(rotatedToken);
	});
});

describe('event stream replay', () => {
	it('resumes after the last applied ID without duplicates', async () => {
		const requests: URL[] = [];
		const bodies = [sseEvents(1, 2), sseEvents(1, 2), sseEvents(2, 3, 4)];
		let responseIndex = 0;
		globalThis.fetch = (async (input: string | URL | Request) => {
			requests.push(new URL(String(input)));
			return new Response(bodies[responseIndex++], {
				headers: { 'content-type': 'text/event-stream' }
			});
		}) as typeof fetch;

		const applied: number[] = [];
		let failSecondEvent = true;
		let errors = 0;
		let close = () => {};
		let finish: () => void;
		const finished = new Promise<void>((resolve) => {
			finish = resolve;
		});

		close = openEventStream(
			{ kind: 'direct', serverUrl: 'http://127.0.0.1:8000' },
			'replay-test',
			{
				onEvent: async (event) => {
					const id = Number(event.id);
					if (id === 2 && failSecondEvent) {
						failSecondEvent = false;
						throw new Error('apply failed');
					}
					await Promise.resolve();
					applied.push(id);
					if (id === 4) {
						close();
						finish();
					}
				},
				onError: () => {
					errors += 1;
				}
			},
			{ reconnectDelayMs: 0 }
		);

		try {
			await Promise.race([
				finished,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('event replay timed out')), 1_000)
				)
			]);

			expect(applied).toEqual([1, 2, 3, 4]);
			expect(errors).toBe(1);
			expect(requests).toHaveLength(3);
			expect(requests[0].searchParams.get('last_event_id')).toBeNull();
			expect(requests[1].searchParams.get('last_event_id')).toBe('1');
			expect(requests[2].searchParams.get('last_event_id')).toBe('2');
		} finally {
			close();
		}
	});
});

function sseEvents(...ids: number[]): string {
	return ids
		.map((id) => `id: ${id}\nevent: status\ndata: {"seq":${id}}\n\n`)
		.join('');
}
