import { getRequestEvent } from '$app/server';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { drizzle } from 'drizzle-orm/d1';
import { authSchema } from './db/schema';
import { defaultWorkspaceName, personalWorkspaceSlug } from './workspace-identity';

export type AuthEnvironment = {
	DB: D1Database;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
};

export function hasGitHubAuth(environment: AuthEnvironment): boolean {
	const hasClientId = Boolean(environment.GITHUB_CLIENT_ID);
	const hasClientSecret = Boolean(environment.GITHUB_CLIENT_SECRET);

	if (hasClientId !== hasClientSecret) {
		throw new Error(
			'GitHub authentication requires both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET'
		);
	}

	return hasClientId;
}

export function createAuth(environment: AuthEnvironment) {
	if (!environment.BETTER_AUTH_SECRET) {
		throw new Error('BETTER_AUTH_SECRET is required');
	}
	if (!environment.BETTER_AUTH_URL) {
		throw new Error('BETTER_AUTH_URL is required');
	}

	const database = drizzle(environment.DB, { schema: authSchema });
	let createPersonalWorkspaceForUser: ((user: { id: string; name?: string | null; email?: string | null }) => Promise<void>) | null = null;
	const options = {
		appName: 'Chump',
		baseURL: environment.BETTER_AUTH_URL,
		secret: environment.BETTER_AUTH_SECRET,
		database: drizzleAdapter(database, {
			provider: 'sqlite',
			schema: authSchema
		}),
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						if (!createPersonalWorkspaceForUser) {
							throw new Error('Personal workspace provisioning is not initialized');
						}
						await createPersonalWorkspaceForUser(user);
					}
				}
			}
		},
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 10,
			maxPasswordLength: 128
		},
		user: {
			deleteUser: {
				enabled: true
			}
		},
		account: {
			encryptOAuthTokens: true,
			accountLinking: {
				disableImplicitLinking: true
			}
		},
		session: {
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24,
			freshAge: 60 * 30
		},
		rateLimit: {
			enabled: true,
			storage: 'database'
		},
		advanced: {
			ipAddress: {
				ipAddressHeaders: ['cf-connecting-ip']
			}
		},
		socialProviders: hasGitHubAuth(environment)
			? {
					github: {
						clientId: environment.GITHUB_CLIENT_ID!,
						clientSecret: environment.GITHUB_CLIENT_SECRET!
					}
				}
			: undefined,
		plugins: [
			organization({
				teams: {
					enabled: true
				},
				requireEmailVerificationOnInvitation: false
			}),
			sveltekitCookies(getRequestEvent)
		]
	} satisfies BetterAuthOptions;

	const auth = betterAuth(options);
	createPersonalWorkspaceForUser = async (user) => {
		await auth.api.createOrganization({
			body: {
				name: defaultWorkspaceName(user),
				slug: await personalWorkspaceSlug(user.id),
				userId: user.id
			}
		});
	};
	return auth;
}

export type ChumpAuth = ReturnType<typeof createAuth>;
