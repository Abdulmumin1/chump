---
"chump-agent": patch
---

Prepare the first public package release.

- Publish the npm package as `chump-agent` while exposing the `chump` binary.
- Ship compiled JavaScript from `dist` instead of using TypeScript sources as the installed executable.
- Start the Python backend from installed CLI builds with `uvx --from chump-server chump-server`.
- Add CI package build checks and release workflow scaffolding for npm and PyPI publishing.
