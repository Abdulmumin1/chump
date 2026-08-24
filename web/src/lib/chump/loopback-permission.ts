export type LoopbackPermissionState = PermissionState | 'unsupported';

type QueryPermission = (descriptor: PermissionDescriptor) => Promise<PermissionStatus>;

export async function getLoopbackPermissionState(
	queryPermission: QueryPermission = navigator.permissions.query.bind(navigator.permissions)
): Promise<LoopbackPermissionState> {
	for (const name of ['loopback-network', 'local-network-access']) {
		try {
			const status = await queryPermission({ name: name as PermissionName });
			return status.state;
		} catch {
			// Try the legacy Chrome permission name before treating it as unsupported.
		}
	}
	return 'unsupported';
}

export function loopbackPermissionMessage(state: LoopbackPermissionState): string | null {
	if (state === 'prompt') {
		return 'Chrome needs permission to reach your local Chump service. Click “Connect to local service”, then choose Allow.';
	}
	if (state === 'denied') {
		return 'Chrome is blocking local service access. Open this site’s settings, set “Local network access” or “Loopback network” to Allow, then retry.';
	}
	return null;
}
