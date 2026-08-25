import type { ChangeRecord, ChumpState } from '$lib/chump/types';

export type FileGroup = {
	path: string;
	added: number;
	removed: number;
	changeCount: number;
	records: ChangeRecord[];
	lastIndex: number;
};

export type WorkspaceChangesSummary = {
	totalChanges: number;
	added: number;
	removed: number;
};

function isChangeRecord(value: unknown): value is ChangeRecord {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.path === 'string' &&
		typeof record.added === 'number' &&
		typeof record.removed === 'number'
	);
}

export function normalizeChangeRecords(
	value: ChumpState['change_records'] | undefined
): ChangeRecord[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isChangeRecord);
}

export function buildFileGroups(currentState: ChumpState | null | undefined): FileGroup[] {
	if (!currentState) return [];

	const grouped = new Map<string, FileGroup>();
	const changeRecords = normalizeChangeRecords(currentState.change_records);

	changeRecords.forEach((record, index) => {
		const existing = grouped.get(record.path);
		if (existing) {
			existing.added += record.added;
			existing.removed += record.removed;
			existing.changeCount += 1;
			existing.records.push(record);
			existing.lastIndex = index;
			return;
		}

		grouped.set(record.path, {
			path: record.path,
			added: record.added,
			removed: record.removed,
			changeCount: 1,
			records: [record],
			lastIndex: index
		});
	});

	const fileDiffs = currentState.file_diffs ?? {};
	const touchedPaths = currentState.files_touched ?? [];
	const fallbackPaths = new Set<string>([...touchedPaths, ...Object.keys(fileDiffs)]);

	for (const path of fallbackPaths) {
		if (grouped.has(path)) continue;
		const summary = fileDiffs[path] ?? { added: 0, removed: 0 };
		grouped.set(path, {
			path,
			added: summary.added ?? 0,
			removed: summary.removed ?? 0,
			changeCount: 0,
			records: [],
			lastIndex: -1
		});
	}

	return Array.from(grouped.values()).sort((a, b) => {
		if (a.lastIndex !== b.lastIndex) {
			return b.lastIndex - a.lastIndex;
		}
		return a.path.localeCompare(b.path);
	});
}

export function summarizeWorkspaceChanges(
	currentState: ChumpState | null | undefined
): WorkspaceChangesSummary {
	const groups = buildFileGroups(currentState);
	const added = groups.reduce((sum, file) => sum + file.added, 0);
	const removed = groups.reduce((sum, file) => sum + file.removed, 0);

	return {
		totalChanges: groups.length,
		added,
		removed
	};
}
