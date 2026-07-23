# chump web

Browser client for Chump sessions.

It connects to an existing Chump server, streams agent events over SSE, and lets
multiple tabs or devices watch and steer the same session in realtime.

## Features

- Connect to a local or shared Chump server
- Resume a specific session with `server` and `session` query params
- Live transcript updates while the agent is working
- Shared session state across multiple browser clients
- Session sidebar for browsing and reopening sessions
- Composer support for slash commands (including `/skill:<name>`), steering, and image attachments
- QR-based connect flow for shared links

## Connect flow

Start a Chump session in the CLI, then share it:

```bash
chump
chump share
```

Open the generated web URL, or visit the app with query params:

```text
/?server=http://127.0.0.1:8000&session=<session-id>
```

## Development

From `web/`:

```bash
cp .dev.vars.example .dev.vars
# Replace BETTER_AUTH_SECRET with: openssl rand -base64 32
pnpm db:migrate:local
pnpm dev
```

Or from the repo root:

```bash
pnpm --filter web dev
```

Open `http://localhost:5173`. Better Auth rejects requests from a different
origin such as `http://127.0.0.1:5173` by design.

## Authentication

Chump Web uses Better Auth, Drizzle ORM, and Cloudflare D1. The landing page is
public; `/c`, `/account`, and `/organizations` require a Chump Web account.
`/c` also requires an active organization. This login and organization context
only gate the web app. Chump servers continue to authorize their own sessions,
and their URLs, tokens, and chat data are not stored in D1.

Email/password is always enabled. GitHub OAuth is enabled only when both
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are configured. Use this callback
URL in the GitHub OAuth app:

```text
http://localhost:5173/api/auth/callback/github
https://chump.yaqeen.me/api/auth/callback/github
```

### Create the production D1 database

1. Run `pnpm wrangler login`.
2. Run `pnpm wrangler d1 create chump-web-auth`.
3. Replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID.
4. Run `pnpm db:migrate:local` again because Wrangler keys local D1 state by database ID.
5. Run `pnpm db:migrate:remote`.

### Configure production secrets

```bash
pnpm wrangler secret put BETTER_AUTH_SECRET

# Optional GitHub OAuth; configure both values or neither.
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
```

`BETTER_AUTH_URL` is a non-secret production variable in `wrangler.jsonc`.

### Organizations, teams, and invitations

Better Auth's organization plugin owns organizations, memberships, roles,
teams, team memberships, invitations, and the active organization/team fields
on each web session. Drizzle owns the matching D1 schema and migrations.
The organization screen uses SvelteKit remote `query`, `form`, and `command`
functions so reads and writes run on the server with Valibot boundary
validation. Remote forms remain usable without JavaScript and are progressively
enhanced when JavaScript is available.

- Creating or selecting an organization makes it active for the current web
  session.
- Every new account receives a **Personal Workspace** and default team during
  Better Auth user creation. The authenticated page boundary provisions the
  same workspace for accounts created before this behavior existed.
- Changing organization clears the active team before another team is selected.
- Selecting **All teams** explicitly clears the active team.
- Organization and team context never grants access to a Chump server.
- Invitations are delivered as links copied from the organization screen. No
  email delivery provider or additional email secret is configured in v1.

An invitation link has this form:

```text
https://chump.yaqeen.me/organizations?invitationId=<invitation-id>
```

Unauthenticated recipients are sent through sign-in and returned to the same
invitation. Better Auth verifies that the signed-in email matches the invite.

Remote functions and async component expressions are currently experimental
SvelteKit/Svelte features. Their opt-in flags live in `svelte.config.js`; review
the migration notes before upgrading SvelteKit.

### Change the schema

1. Edit `src/lib/server/db/schema.ts`.
2. Run `pnpm db:generate`.
3. Run `pnpm db:migrate:local`.
4. Review and commit the generated files under `drizzle/`.

## Checks

```bash
pnpm check
pnpm build
```

## Demo

https://mac-file.yaqeen.me/393FBDFC-chump-lil-demo.mp4
