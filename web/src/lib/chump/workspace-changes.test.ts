import { describe, expect, it } from 'vitest';
import type { ChumpState } from './types';
import { buildFileGroups, summarizeWorkspaceChanges } from './workspace-changes';

describe('workspace-changes', () => {
	it('returns empty groups and zero counts for null state', () => {
		expect(buildFileGroups(null)).toEqual([]);
		expect(summarizeWorkspaceChanges(null)).toEqual({
			totalChanges: 0,
			added: 0,
			removed: 0
		});
	});

	it('aggregates change records and fallback file diffs accurately', () => {
		const state: Partial<ChumpState> = {
			change_records: [
				{
					path: 'src/main.ts',
					added: 5,
					removed: 2
				},
				{
					path: 'src/main.ts',
					added: 3,
					removed: 1
				},
				{
					path: 'src/utils.ts',
					added: 10,
					removed: 0
				}
			],
			file_diffs: {
				'src/extra.ts': { added: 2, removed: 4 }
			},
			files_touched: ['src/extra.ts']
		};

		const groups = buildFileGroups(state as ChumpState);
		expect(groups).toHaveLength(3);

		const summary = summarizeWorkspaceChanges(state as ChumpState);
		expect(summary).toEqual({
			totalChanges: 3,
			added: 20,
			removed: 7
		});
	});
});
