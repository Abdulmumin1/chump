---
name: release
description: Release process for chump — npm (chump-agent) via Changesets, and PyPI (chump-server) via git tags.
---

# Chump Release Process

Client binaries bundle the server runtime. A client release always picks up the **latest** `chump-server-v*` tag, builds the server, and packages it alongside the CLI. Release order matters: tag the server **before** merging client changes.

| Package        | Registry | Mechanism                          |
| -------------- | -------- | ---------------------------------- |
| `chump-agent`  | npm      | Changesets (automatic on push to `main`) |
| `chump-server` | PyPI     | Git tag `chump-server-v*`          |

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

### Step 5: On main, tag the server **first**

```bash
git fetch origin
git checkout main
git pull
git tag chump-server-v<next-version>
git push origin chump-server-v<next-version>
```

This triggers the PyPI publish + standalone server binary uploads (see CI flow below).

### Step 6: CI handles the client

On push to `main`, the Changesets action:
- Publishes `chump-agent` to npm
- Builds binaries that bundle the latest `chump-server-v*` runtime
- Uploads client archives to the `chump-agent@<version>` GitHub release

---

## Server-only Release

When only `server/` changed and the client doesn't need a new npm version.

1. Update `server/CHANGELOG.md`.
2. Commit, merge to `main`.
3. On `main`, tag and push:

```bash
git tag chump-server-v<next-version>
git push origin chump-server-v<next-version>
```

CI publishes the server wheel to PyPI, builds standalone server binaries, and creates a GitHub release.

---

## Client-only Release

When only `client/` changed (no server changes). The client build will bundle whatever the latest `chump-server-v*` tag provides.

1. Create a changeset and version packages as described above.
2. Commit, push, merge to `main`.
3. The Changesets action on `main` handles npm publish and binary uploads.

---

## CI Flow

### On push to `main`

1. **npm job**: Builds client, runs `changesets/action` → publishes to npm.
2. **binaries job** (if npm published): On each platform, fetches the latest `chump-server-v*` tag, builds the server runtime, copies it into `client/vendor/chump-server/`, then builds the client archive with `pnpm --dir client run build:bin`. Uploads `.tar.gz` archives to the `chump-agent@<version>` release.

### On tag `chump-server-v*`

1. **pypi job**: Builds server wheel with `uv build`, validates version matches the tag, publishes to PyPI, extracts release notes from `server/CHANGELOG.md`, creates a GitHub release.
2. **server-binaries job**: Builds standalone server runtimes (`onedir` archive + `onefile`) and uploads them to the GitHub release.

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `.github/workflows/release.yml` | CI workflow for npm + PyPI + binary bundling |
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
