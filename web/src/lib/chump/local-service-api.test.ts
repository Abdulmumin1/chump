import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	createLocalServiceProjectSession,
	listLocalServiceProjects,
	registerLocalServiceProject
} from './local-service-api';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('local service project requests', () => {
	it('lists projects with bearer auth', async () => {
		let requestUrl = '';
		let requestHeaders = new Headers();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
				requestUrl = String(input);
				requestHeaders = new Headers(init?.headers);
				return Response.json({
					projects: [
						{
							id: 'project-one',
							name: 'One',
							workspacePath: '/workspace/one',
							createdAt: 1,
							lastOpenedAt: 2
						}
					]
				});
			})
		);

		await expect(
			listLocalServiceProjects({ url: 'http://127.0.0.1:38136/', token: 'secret-token' })
		).resolves.toEqual([
			{
				id: 'project-one',
				name: 'One',
				workspacePath: '/workspace/one',
				createdAt: 1,
				lastOpenedAt: 2
			}
		]);
		expect(requestUrl).toBe('http://127.0.0.1:38136/projects');
		expect(requestHeaders.get('authorization')).toBe('Bearer secret-token');
	});

	it('registers a project', async () => {
		let requestBody = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
				requestBody = String(init?.body ?? '');
				return Response.json({
					project: {
						id: 'project-two',
						name: 'Two',
						workspacePath: '/workspace/two',
						createdAt: 3,
						lastOpenedAt: 4
					}
				});
			})
		);

		await expect(
			registerLocalServiceProject(
				{ url: 'http://127.0.0.1:38136', token: 'secret-token' },
				{ workspacePath: '/workspace/two', name: 'Two', approved: true }
			)
		).resolves.toMatchObject({ id: 'project-two', workspacePath: '/workspace/two' });
		expect(JSON.parse(requestBody)).toEqual({
			workspacePath: '/workspace/two',
			name: 'Two',
			approved: true
		});
	});

	it('creates a project session on the scoped route', async () => {
		let requestUrl = '';
		let requestBody = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
				requestUrl = String(input);
				requestBody = String(init?.body ?? '');
				return Response.json({ projectId: 'project-one', sessionId: 'session-one' });
			})
		);

		await expect(
			createLocalServiceProjectSession(
				{ url: 'http://127.0.0.1:38136', token: 'secret-token' },
				'project one'
			)
		).resolves.toEqual({ projectId: 'project-one', sessionId: 'session-one' });
		expect(requestUrl).toBe('http://127.0.0.1:38136/projects/project%20one/sessions');
		expect(requestBody).toBe('{}');
	});
});
