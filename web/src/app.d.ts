import type { ChumpAuth, AuthEnvironment } from '$lib/server/auth';

type AuthSession = ChumpAuth['$Infer']['Session'];

declare global {
	namespace App {
		interface Locals {
			auth: ChumpAuth | null;
			user: AuthSession['user'] | null;
			session: AuthSession['session'] | null;
			githubAuthEnabled: boolean;
		}

		interface Platform {
			env: AuthEnvironment;
			cf: CfProperties;
			ctx: ExecutionContext;
			caches: CacheStorage;
		}
	}
}

export {};
