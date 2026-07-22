---
name: release
description: Release process for chump — npm (chump-agent) via Changesets, and PyPI (chump-server) via automatic git tags.
---

# Chump Release Process

Client binaries bundle the server runtime. A client release always picks up the **latest** `chump-server-v*` tag, builds the server, and packages it alongside the CLI. After a merge to `main`, CI creates the server tag from the leading version in `server/CHANGELOG.md`, publishes the server, and only then publishes/packages the client.

| Package        | Registry | Mechanism                          |
| -------------- | -------- | ---------------------------------- |
| `chump-agent`  | npm      | Changesets (automatic on push to `main`) |
| `chump-server` | PyPI     | Automatic `chump-server-v*` tag from the changelog |

All releases go through `main`. Prep work happens on a `release/*` branch.

---

## Full Release (server + client)

When both server and client have changes.

### Step 1: On the release branch, bump server version

`server` uses `hatch-vcs` — the version is derived from a git tag at release time. No version file to bump. Update the changelog:

```bash
# Edit server/CHANGELOG.md with the new version entry
```

If there are no server changes, skip this step.

### Step 2: Create a changeset for the client

```bash
pnpm changeset
```

Select `chump-agent`, choose bump type (`patch`, `minor`, `major`), and write a summary.

Then version:

```bash
pnpm version-packages
```

This consumes changeset files into `client/CHANGELOG.md` and bumps `version` in `client/package.json`.

### Step 3: Commit and push

```bash
git add -A
git commit -m "chore(release): version packages"
git push origin release/<name>
```

### Step 4: Merge to main

Create a PR or merge directly.

### Step 5: CI handles the release

On the push to `main`, CI:
1. Reads the first stable `## x.y.z` heading in `server/CHANGELOG.md`.
2. Creates `chump-server-vx.y.z` on the merged commit if that version is not already tagged.
3. Publishes the server wheel and standalone binaries.
4. Runs Changesets to publish `chump-agent` and uploads client archives bundled with that server tag.

---

## Server-only Release

When only `server/` changed and the client doesn't need a new npm version.

1. Update `server/CHANGELOG.md` with the next version as its first version heading.
2. Commit and merge to `main`.
3. CI creates the matching tag, publishes the server wheel, builds standalone server binaries, and creates a GitHub release.

---

## Client-only Release

When only `client/` changed (no server changes). The client build will bundle whatever the latest `chump-server-v*` tag provides.

1. Create a changeset and version packages as described above.
2. Commit, push, merge to `main`.
3. The Changesets action on `main` handles npm publish and binary uploads.

---

## CI Flow

### On push to `main`

1. **server-tag job**: Compares the first server changelog version with existing tags and creates the missing tag on the merged `main` commit.
2. **server-release workflow**: Builds/publishes the tagged server and uploads its standalone binaries.
3. **npm job**: Runs Changesets and publishes the client after the server release succeeds or is already current.
4. **binaries job** (if npm published): Fetches the latest `chump-server-v*` tag, builds the server runtime, copies it into `client/vendor/chump-server/`, then builds the client archive with `pnpm --dir client run build:bin`. Uploads `.tar.gz` archives to the `chump-agent@<version>` release.

The tag is created with the workflow token and the server publish is called as a reusable workflow, so the process does not depend on a tag-push event (which GitHub does not emit for workflow-token pushes). Existing tags can be republished manually from `server-release.yml` if a release needs recovery; creating a new tag manually is no longer part of the process.

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `.github/workflows/release.yml` | CI workflow for npm + PyPI + binary bundling |
| `.github/workflows/server-release.yml` | Reusable/manual server publish and binary workflow |
| `.github/workflows/ci.yml` | CI for typecheck, build, smoke test |
| `package.json` | `changeset`, `version-packages`, `release` scripts |
| `client/scripts/build-bin.ts` | Client binary build — looks for server runtime in `vendor/chump-server/` |
| `server/scripts/build_binary.py` | Server runtime build script |
| `server/CHANGELOG.md` | Server changelog (used for GitHub release notes) |
| `server/pyproject.toml` | `hatch-vcs` config for tag-based versioning |
| `.changeset/README.md` | Changesets usage docs |

## CI Checks

Before any release, ensure CI passes:

```bash
# Client
pnpm install --frozen-lockfile
pnpm --filter chump-agent run typecheck
pnpm --filter chump-agent run build

# Server
cd server
uv lock && uv sync
uv run python -c "import chump_server"
uv run python -m compileall chump_server
uv build
```
