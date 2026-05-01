# chump-agent

## 0.0.4

### Patch Changes

- ba070ff: Pass `CHUMP_MANAGED_SERVER_IDLE_TIMEOUT` when starting managed servers and surface managed idle timeout fields in typed health/status responses.

  - Default managed server idle timeout to 300 seconds in the CLI runtime when the env var is unset.
  - Include `managed_idle_timeout` in `ChumpStatus` and `ChumpHealth` TypeScript types.

## 0.0.3

### Patch Changes

- bb5b306: Add Codex subscription auth, richer model and thinking controls, and more resilient chat diagnostics.

  - Add `chump connect` support for Codex OAuth through browser or headless login.
  - Add `/thinking` with `none`, `low`, `high`, and `xhigh` modes.
  - Expand `/model` choices for Codex, OpenAI GPT-5 models, Google, and Workers AI.
  - Improve reasoning rendering, queued input diagnostics, and interrupted stream handling.

## 0.0.3

### Patch Changes

- Add Codex subscription auth through `chump connect`, including browser and headless OAuth flows.
- Add `/thinking` for switching reasoning modes between `none`, `low`, `high`, and `xhigh`.
- Expand `/model` with Codex, OpenAI GPT-5, Google, and Workers AI model choices.
- Improve reasoning display, queued input behavior, and diagnostics for interrupted chat streams.

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
