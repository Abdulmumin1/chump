import { describe, expect, it } from 'vitest';
import {
	readRecentProjectAccess,
	recordProjectAccess,
	sortProjectsByRecent,
	RECENT_PROJECTS_STORAGE_KEY
} from './recent-projects';

function createMockStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, String(value)),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => Array.from(data.keys())[index] ?? null,
		length: 0
	};
}

describe('recent-projects', () => {
	it('reads empty record when storage has no entry or invalid json', () => {
		const storage = createMockStorage();
		expect(readRecentProjectAccess(storage)).toEqual({});

		storage.setItem(RECENT_PROJECTS_STORAGE_KEY, 'not-json');
		expect(readRecentProjectAccess(storage)).toEqual({});
	});

	it('records project access timestamp', () => {
		const storage = createMockStorage();
		recordProjectAccess(storage, 'proj-1', 1000);
		recordProjectAccess(storage, 'proj-2', 2000);

		expect(readRecentProjectAccess(storage)).toEqual({
			'proj-1': 1000,
			'proj-2': 2000
		});
	});

	it('sorts projects by access timestamp descending', () => {
		const projects = [
			{ id: 'proj-a', name: 'Alpha', lastOpenedAt: 100 },
			{ id: 'proj-b', name: 'Beta', lastOpenedAt: 200 },
			{ id: 'proj-c', name: 'Gamma', lastOpenedAt: 50 }
		];

		const accessMap = {
			'proj-c': 3000,
			'proj-a': 2000
		};

		const sorted = sortProjectsByRecent(projects, accessMap);
		expect(sorted.map((p) => p.id)).toEqual(['proj-c', 'proj-a', 'proj-b']);
	});
});
