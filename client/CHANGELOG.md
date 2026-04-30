# chump-agent

## 0.0.2

### Patch Changes

- 62b749f: Add live reasoning preview stream
  Replace manual reasoning buffer with LiveReasoningStream for real-time display of AI thinking process. Show a preview line during processing and render complete thinking block at completion with smart text merging to avoid duplicates.
  This improves the user experience by providing immediate feedback and showing the full reasoning context at the end.

## 0.0.1

### Patch Changes

- 1f984db: Prepare the first public package release.

  - Publish the npm package as `chump-agent` while exposing the `chump` binary.
  - Ship compiled JavaScript from `dist` instead of using TypeScript sources as the installed executable.
  - Start the Python backend from installed CLI builds with `uvx --from chump-server chump-server`.
  - Add CI package build checks and release workflow scaffolding for npm and PyPI publishing.
