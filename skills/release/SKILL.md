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

---

## npm Release (`chump-agent`)

### Prerequisites

- On the `release/*` or feature branch that will merge into `main`.

### Step 1: Create a changeset

```bash
pnpm changeset
```

Follow the prompt:
- Select the packages that changed (usually `chump-agent`)
- Choose bump type (`patch`, `minor`, `major`)
- Write a summary of changes

This creates a markdown file in `.changeset/`.

### Step 2: Version packages

```bash
pnpm version-packages
```

This runs `changeset version`, which:
- Consumes changeset files into `client/CHANGELOG.md`
- Bumps `version` in `client/package.json`

### Step 3: Commit and push

```bash
git add -A
git commit -m "chore(release): version packages"
git push
```

### Step 4: Merge to main

Create a PR or merge directly. On push to `main`, the `release.yml` workflow:
1. Builds the client
2. Runs `changesets/action` which publishes to npm
3. Builds binaries (`bun run build:bin` in `client/`)
4. Uploads binaries to the GitHub release

---

## PyPI Release (`chump-server`)

### Prerequisites

- Changes to `server/` are ready
- `server/CHANGELOG.md` is updated with the new version entry

### Step 1: Get the latest server tag

```bash
git fetch --tags origin
git tag --list 'chump-server-v*' --sort=-v:refname | head -1
```

This shows the most recent tag (e.g. `chump-server-v0.0.12`).

### Step 2: Determine the next version

Increment based on semver. The version is embedded in the tag — the Python package derives it from `hatch-vcs` using the `chump-server-v*` tag pattern (see `server/pyproject.toml`).

### Step 3: Create and push the tag

```bash
git tag chump-server-v<next-version>
git push origin chump-server-v<next-version>
```

### Step 4: CI handles the rest

On tag push matching `chump-server-v*`, `release.yml`:
1. Builds the server package with `uv build`
2. Validates the built wheel matches the tag version
3. Publishes to PyPI via `pypa/gh-action-pypi-publish`
4. Extracts release notes from `server/CHANGELOG.md` using `server/scripts/extract_release_notes.py`
5. Creates a GitHub release with those notes

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
