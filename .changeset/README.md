# Changesets

Use Changesets to track user-visible changes for release.

Changesets currently tracks the npm package only. The Python package should use
standard Python release tooling instead of custom version scripts.

Preferred Python path:

- Keep building with `uv build` and Hatchling.
- Publish with `pypa/gh-action-pypi-publish` and PyPI trusted publishing.
- Python versions come from `chump-server-v*` git tags through `hatch-vcs`
  instead of duplicating Changesets.

Create a new changeset with:

```bash
pnpm changeset
```

Version packages with:

```bash
pnpm version-packages
```

Publish with:

```bash
pnpm release
```
