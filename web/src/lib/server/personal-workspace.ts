import type { ChumpAuth } from './auth';
import { defaultWorkspaceName, personalWorkspaceSlug } from './workspace-identity';

type AuthUser = ChumpAuth['$Infer']['Session']['user'];

export async function ensurePersonalWorkspace(
	auth: ChumpAuth,
	headers: Headers,
	user: AuthUser,
	activeOrganizationId: string | null | undefined
): Promise<string> {
	const organizations = await auth.api.listOrganizations({ headers });
	const activeOrganization = organizations.find(
		(organization) => organization.id === activeOrganizationId
	);
	if (activeOrganization) return activeOrganization.id;

	const existingOrganization = organizations[0];
	if (existingOrganization) {
		await activateOrganization(auth, headers, existingOrganization.id);
		return existingOrganization.id;
	}

	const slug = await personalWorkspaceSlug(user.id);
	try {
		const organization = await auth.api.createOrganization({
			body: { name: defaultWorkspaceName(user), slug },
			headers
		});
		await activateOrganization(auth, headers, organization.id);
		return organization.id;
	} catch (cause) {
		// A concurrent first request may have created the deterministic workspace.
		const currentOrganizations = await auth.api.listOrganizations({ headers });
		const concurrentOrganization = currentOrganizations.find(
			(organization) => organization.slug === slug
		);
		if (!concurrentOrganization) throw cause;

		await activateOrganization(auth, headers, concurrentOrganization.id);
		return concurrentOrganization.id;
	}
}

async function activateOrganization(
	auth: ChumpAuth,
	headers: Headers,
	organizationId: string
): Promise<void> {
	await auth.api.setActiveOrganization({ body: { organizationId }, headers });
	await auth.api.setActiveTeam({ body: { teamId: null }, headers });
}
