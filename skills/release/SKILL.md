---
name: release
description: Release process for chump — npm (chump-agent) via Changesets, and PyPI (chump-server) via git tags.
---

# Chump Release Process

This project publishes two packages with different mechanisms:

| Package     | Registry | Mechanism                          |
| ----------- | -------- | ---------------------------------- |
| `chump-agent` | npm      | Changesets (automatic on `main`) |
| `chump-server` | PyPI   | Git tag + `pypa/gh-action-pypi-publish` |

Both packages should be released from `main` only. Prep work happens on a `release/*` branch, then is merged to `main`.

---

## Full Release (both packages)

### Step 1: On the release branch, prepare version bumps

```bash
git checkout release/<name>
```

#### Client (npm)

Create a changeset:

```bash
pnpm changeset
```

Follow the prompt:
- Select the packages that changed (usually `chump-agent`)
- Choose bump type (`patch`, `minor`, `major`)
- Write a summary of changes

This creates a markdown file in `.changeset/`.

Then version packages:

```bash
pnpm version-packages
```

This runs `changeset version`, which:
- Consumes changeset files into `client/CHANGELOG.md`
- Bumps `version` in `client/package.json`

#### Server (PyPI)

Update `server/CHANGELOG.md` with the new version entry.

### Step 2: Commit and push the release branch

```bash
git add -A
git commit -m "chore(release): version packages"
git push origin release/<name>
```

### Step 3: Merge to main

Create a PR or merge directly.

### Step 4: On main, tag the server

After the merge, on `main`:

```bash
git fetch origin
git checkout main
git pull
```

Get the latest server tag:

```bash
git tag --list 'chump-server-v*' --sort=-v:refname | head -1
```

Create and push the next tag:

```bash
git tag chump-server-v<next-version>
git push origin chump-server-v<next-version>
```

### Step 5: CI handles the rest

The `release.yml` workflow runs on both triggers:

**On push to `main`:**
1. Builds the client
2. Runs `changesets/action` which publishes to npm
3. Builds binaries (`bun run build:bin` in `client/`)
4. Uploads binaries to the GitHub release

**On tag push matching `chump-server-v*`:**
1. Builds the server package with `uv build`
2. Validates the built wheel matches the tag version
3. Publishes to PyPI via `pypa/gh-action-pypi-publish`
4. Extracts release notes from `server/CHANGELOG.md` using `server/scripts/extract_release_notes.py`
5. Creates a GitHub release with those notes

---

## npm-only Release (`chump-agent`)

### Step 1: Create a changeset

```bash
pnpm changeset
```

Follow the prompt:
- Select the packages that changed (usually `chump-agent`)
- Choose bump type (`patch`, `minor`, `major`)
- Write a summary of changes

### Step 2: Version packages

```bash
pnpm version-packages
```

### Step 3: Commit and push

```bash
git add -A
git commit -m "chore(release): version packages"
git push
```

### Step 4: Merge to main

On push to `main`, the `release.yml` workflow handles the rest.

---

## PyPI-only Release (`chump-server`)

### Step 1: Update changelog

Update `server/CHANGELOG.md` with the new version entry.

### Step 2: Commit, merge to main

```bash
git add -A
git commit -m "chore(release): update server changelog"
git push
# create PR and merge to main
```

### Step 3: On main, tag and push

```bash
git fetch origin
git checkout main
git pull
git tag chump-server-v<next-version>
git push origin chump-server-v<next-version>
```

CI publishes to PyPI and creates a GitHub release.

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `.github/workflows/release.yml` | CI workflow for npm + PyPI releases |
| `.github/workflows/ci.yml` | CI for typecheck, build, smoke test |
| `package.json` | `changeset`, `version-packages`, `release` scripts |
| `server/pyproject.toml` | `hatch-vcs` config for tag-based versioning |
| `server/scripts/extract_release_notes.py` | Extracts changelog section for GitHub release |
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

Run from repo root for client, `server/` for server.
