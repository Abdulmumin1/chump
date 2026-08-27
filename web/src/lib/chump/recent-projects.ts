export const RECENT_PROJECTS_STORAGE_KEY = 'chump:recent-projects';

export type ProjectAccessMap = Record<string, number>;

export function readRecentProjectAccess(storage: Pick<Storage, 'getItem'>): ProjectAccessMap {
	try {
		const raw = storage.getItem(RECENT_PROJECTS_STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as ProjectAccessMap;
		}
	} catch {
		// Ignore corrupt data
	}
	return {};
}

export function recordProjectAccess(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	projectId: string,
	timestamp = Date.now()
): ProjectAccessMap {
	if (!projectId) return readRecentProjectAccess(storage);
	const current = readRecentProjectAccess(storage);
	const next: ProjectAccessMap = {
		...current,
		[projectId]: timestamp
	};
	try {
		storage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Ignore storage quota errors
	}
	return next;
}

export function sortProjectsByRecent<T extends { id: string; lastOpenedAt?: number; createdAt?: number; name?: string }>(
	projects: T[],
	accessMap: ProjectAccessMap
): T[] {
	return [...projects].sort((a, b) => {
		const accessA = accessMap[a.id] ?? a.lastOpenedAt ?? a.createdAt ?? 0;
		const accessB = accessMap[b.id] ?? b.lastOpenedAt ?? b.createdAt ?? 0;
		if (accessB !== accessA) {
			return accessB - accessA;
		}
		return (a.name || a.id).localeCompare(b.name || b.id);
	});
}
