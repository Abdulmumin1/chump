import { command, form, getRequestEvent, query } from '$app/server';
import { error, invalid } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import * as v from 'valibot';

export type OrganizationView = {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	createdAt: Date;
};

export type TeamView = {
	id: string;
	name: string;
	organizationId: string;
	createdAt: Date;
	updatedAt: Date | null;
};

export type MemberView = {
	id: string;
	organizationId: string;
	userId: string;
	role: string;
	createdAt: Date;
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
};

export type TeamMemberView = {
	id: string;
	teamId: string;
	userId: string;
	createdAt: Date;
};

export type InvitationView = {
	id: string;
	organizationId: string;
	email: string;
	role: string;
	status: string;
	expiresAt: Date;
	createdAt: Date;
	teamId: string | null;
};

export type InvitationDetailView = InvitationView & {
	organizationName: string;
	organizationSlug: string;
	inviterEmail: string;
};

export type OrganizationWorkspace = {
	activeOrganizationId: string | null;
	activeTeamId: string | null;
	activeRole: string;
	organizations: OrganizationView[];
	teams: TeamView[];
	members: MemberView[];
	teamMembers: TeamMemberView[];
	invitations: InvitationView[];
};

export type InvitationLookup =
	| { ok: true; invitation: InvitationDetailView }
	| { ok: false; message: string };

export type MutationResult =
	| { ok: true; message: string }
	| { ok: false; message: string };

const identifier = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(128));
const organizationName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80));
const organizationSlug = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(64),
	v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens.')
);
const teamName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80));
const emailAddress = v.pipe(v.string(), v.trim(), v.email(), v.maxLength(254));
const memberRole = v.picklist(['member', 'admin']);

function authRequest() {
	const event = getRequestEvent();
	if (!event.locals.auth || !event.locals.user || !event.locals.session) {
		error(401, 'Sign in to manage organizations.');
	}

	return {
		auth: event.locals.auth,
		headers: event.request.headers
	};
}

function publicErrorMessage(cause: unknown): string {
	if (isAPIError(cause)) {
		return cause.body?.message ?? cause.message;
	}
	return 'The organization change failed. Please try again.';
}

async function activeSession() {
	const { auth, headers } = authRequest();
	const current = await auth.api.getSession({ headers });
	if (!current) error(401, 'Your session has expired.');
	return { auth, headers, session: current.session };
}

async function refreshWorkspaceAfter<T>(
	mutation: () => Promise<T>,
	message: string
): Promise<MutationResult> {
	try {
		await mutation();
		void getOrganizationWorkspace().refresh();
		return { ok: true, message };
	} catch (cause) {
		return { ok: false, message: publicErrorMessage(cause) };
	}
}

export const getOrganizationWorkspace = query(async (): Promise<OrganizationWorkspace> => {
	const { auth, headers, session } = await activeSession();
	const organizations = await auth.api.listOrganizations({ headers });
	const activeOrganizationId = organizations.some(
		(organization) => organization.id === session.activeOrganizationId
	)
		? (session.activeOrganizationId ?? null)
		: null;

	const organizationViews = organizations.map((organization) => ({
		id: organization.id,
		name: organization.name,
		slug: organization.slug,
		logo: organization.logo ?? null,
		createdAt: organization.createdAt
	}));

	if (!activeOrganizationId) {
		return {
			activeOrganizationId: null,
			activeTeamId: null,
			activeRole: '',
			organizations: organizationViews,
			teams: [],
			members: [],
			teamMembers: [],
			invitations: []
		};
	}

	const [teams, members, invitations, role] = await Promise.all([
		auth.api.listOrganizationTeams({ query: { organizationId: activeOrganizationId }, headers }),
		auth.api.listMembers({
			query: { organizationId: activeOrganizationId, limit: 100 },
			headers
		}),
		auth.api.listInvitations({ query: { organizationId: activeOrganizationId }, headers }),
		auth.api.getActiveMemberRole({ query: { organizationId: activeOrganizationId }, headers })
	]);
	const activeTeamId = teams.some((team) => team.id === session.activeTeamId)
		? (session.activeTeamId ?? null)
		: null;
	const teamMembers = activeTeamId
		? await auth.api.listTeamMembers({ query: { teamId: activeTeamId }, headers })
		: [];

	return {
		activeOrganizationId,
		activeTeamId,
		activeRole: role.role,
		organizations: organizationViews,
		teams: teams.map((team) => ({
			id: team.id,
			name: team.name,
			organizationId: team.organizationId,
			createdAt: team.createdAt,
			updatedAt: team.updatedAt ?? null
		})),
		members: members.members.map((member) => ({
			id: member.id,
			organizationId: member.organizationId,
			userId: member.userId,
			role: member.role,
			createdAt: member.createdAt,
			user: {
				id: member.user.id,
				name: member.user.name,
				email: member.user.email,
				image: member.user.image ?? null
			}
		})),
		teamMembers: teamMembers.map((member) => ({
			id: member.id,
			teamId: member.teamId,
			userId: member.userId,
			createdAt: member.createdAt
		})),
		invitations: invitations.map((invitation) => ({
			id: invitation.id,
			organizationId: invitation.organizationId,
			email: invitation.email,
			role: invitation.role,
			status: invitation.status,
			expiresAt: invitation.expiresAt,
			createdAt: invitation.createdAt,
			teamId: invitation.teamId ?? null
		}))
	};
});

export const getOrganizationInvitation = query(
	identifier,
	async (invitationId): Promise<InvitationLookup> => {
		const { auth, headers } = authRequest();
		try {
			const invitation = await auth.api.getInvitation({ query: { id: invitationId }, headers });
			return {
				ok: true,
				invitation: {
					id: invitation.id,
					organizationId: invitation.organizationId,
					email: invitation.email,
					role: invitation.role,
					status: invitation.status,
					expiresAt: invitation.expiresAt,
					createdAt: invitation.createdAt,
					teamId: invitation.teamId ?? null,
					organizationName: invitation.organizationName,
					organizationSlug: invitation.organizationSlug,
					inviterEmail: invitation.inviterEmail
				}
			};
		} catch (cause) {
			return { ok: false, message: publicErrorMessage(cause) };
		}
	}
);

export const createOrganization = form(
	v.object({ name: organizationName, slug: organizationSlug }),
	async ({ name, slug }) => {
		const { auth, headers } = authRequest();
		try {
			const organization = await auth.api.createOrganization({ body: { name, slug }, headers });
			if (!organization) invalid('The organization could not be created.');
			await auth.api.setActiveOrganization({ body: { organizationId: organization.id }, headers });
			await auth.api.setActiveTeam({ body: { teamId: null }, headers });
			void getOrganizationWorkspace().refresh();
			return { message: 'Organization created and selected.' };
		} catch (cause) {
			invalid(publicErrorMessage(cause));
		}
	}
);

export const createTeam = form(v.object({ name: teamName }), async ({ name }) => {
	const { auth, headers, session } = await activeSession();
	if (!session.activeOrganizationId) invalid('Select an organization first.');
	try {
		const team = await auth.api.createTeam({
			body: { name, organizationId: session.activeOrganizationId },
			headers
		});
		await auth.api.setActiveTeam({ body: { teamId: team.id }, headers });
		void getOrganizationWorkspace().refresh();
		return { message: 'Team created and selected.' };
	} catch (cause) {
		invalid(publicErrorMessage(cause));
	}
});

export const inviteOrganizationMember = form(
	v.object({
		email: emailAddress,
		role: memberRole,
		teamId: v.union([v.literal(''), identifier])
	}),
	async ({ email, role, teamId }) => {
		const { auth, headers, session } = await activeSession();
		if (!session.activeOrganizationId) invalid('Select an organization first.');
		try {
			const invitation = await auth.api.createInvitation({
				body: {
					email,
					role,
					organizationId: session.activeOrganizationId,
					teamId: teamId || undefined
				},
				headers
			});
			void getOrganizationWorkspace().refresh();
			return { invitationId: invitation.id, message: 'Invitation created.' };
		} catch (cause) {
			invalid(publicErrorMessage(cause));
		}
	}
);

export const selectOrganization = command(identifier, async (organizationId) => {
	const { auth, headers } = authRequest();
	return refreshWorkspaceAfter(async () => {
		await auth.api.setActiveOrganization({ body: { organizationId }, headers });
		await auth.api.setActiveTeam({ body: { teamId: null }, headers });
	}, 'Active organization changed. Team context was cleared.');
});

export const updateOrganizationName = command(
	v.object({ organizationId: identifier, name: organizationName }),
	async ({ organizationId, name }) => {
		const { auth, headers } = authRequest();
		return refreshWorkspaceAfter(
			() =>
				auth.api.updateOrganization({
					body: {
						organizationId,
						data: { name }
					},
					headers
				}),
			'Organization name updated.'
		);
	}
);

export const selectTeam = command(v.nullable(identifier), async (teamId) => {
	const { auth, headers } = authRequest();
	return refreshWorkspaceAfter(
		() => auth.api.setActiveTeam({ body: { teamId }, headers }),
		teamId ? 'Active team changed.' : 'Team context cleared.'
	);
});

export const deleteTeam = command(identifier, async (teamId) => {
	const { auth, headers, session } = await activeSession();
	if (!session.activeOrganizationId) return { ok: false, message: 'Select an organization first.' };
	const organizationId = session.activeOrganizationId;
	return refreshWorkspaceAfter(async () => {
		if (session.activeTeamId === teamId) {
			await auth.api.setActiveTeam({ body: { teamId: null }, headers });
		}
		await auth.api.removeTeam({
			body: { teamId, organizationId },
			headers
		});
	}, 'Team deleted.');
});

export const addTeamMember = command(
	v.object({ teamId: identifier, userId: identifier }),
	async ({ teamId, userId }) => {
		const { auth, headers, session } = await activeSession();
		if (!session.activeOrganizationId) return { ok: false, message: 'Select an organization first.' };
		const organizationId = session.activeOrganizationId;
		return refreshWorkspaceAfter(
			() =>
				auth.api.addTeamMember({
					body: { teamId, userId, organizationId },
					headers
				}),
			'Member added to the team.'
		);
	}
);

export const removeTeamMember = command(
	v.object({ teamId: identifier, userId: identifier }),
	async ({ teamId, userId }) => {
		const { auth, headers, session } = await activeSession();
		if (!session.activeOrganizationId) return { ok: false, message: 'Select an organization first.' };
		const organizationId = session.activeOrganizationId;
		return refreshWorkspaceAfter(
			() =>
				auth.api.removeTeamMember({
					body: { teamId, userId, organizationId },
					headers
				}),
			'Member removed from the team.'
		);
	}
);

export const changeMemberRole = command(
	v.object({ memberId: identifier, role: memberRole }),
	async ({ memberId, role }) => {
		const { auth, headers, session } = await activeSession();
		if (!session.activeOrganizationId) return { ok: false, message: 'Select an organization first.' };
		const organizationId = session.activeOrganizationId;
		return refreshWorkspaceAfter(
			() =>
				auth.api.updateMemberRole({
					body: { memberId, role, organizationId },
					headers
				}),
			'Member role updated.'
		);
	}
);

export const removeOrganizationMember = command(identifier, async (memberId) => {
	const { auth, headers, session } = await activeSession();
	if (!session.activeOrganizationId) return { ok: false, message: 'Select an organization first.' };
	const organizationId = session.activeOrganizationId;
	return refreshWorkspaceAfter(
		() =>
			auth.api.removeMember({
				body: { memberIdOrEmail: memberId, organizationId },
				headers
			}),
		'Member removed.'
	);
});

export const cancelOrganizationInvitation = command(identifier, async (invitationId) => {
	const { auth, headers } = authRequest();
	return refreshWorkspaceAfter(
		() => auth.api.cancelInvitation({ body: { invitationId }, headers }),
		'Invitation cancelled.'
	);
});

export const acceptOrganizationInvitation = command(identifier, async (invitationId) => {
	const { auth, headers } = authRequest();
	try {
		const invitation = await auth.api.getInvitation({ query: { id: invitationId }, headers });
		await auth.api.acceptInvitation({ body: { invitationId }, headers });
		await auth.api.setActiveOrganization({
			body: { organizationId: invitation.organizationId },
			headers
		});
		await auth.api.setActiveTeam({ body: { teamId: null }, headers });
		void getOrganizationWorkspace().refresh();
		return { ok: true, message: 'Invitation accepted.' } satisfies MutationResult;
	} catch (cause) {
		return { ok: false, message: publicErrorMessage(cause) } satisfies MutationResult;
	}
});

export const rejectOrganizationInvitation = command(identifier, async (invitationId) => {
	const { auth, headers } = authRequest();
	return refreshWorkspaceAfter(
		() => auth.api.rejectInvitation({ body: { invitationId }, headers }),
		'Invitation declined.'
	);
});
