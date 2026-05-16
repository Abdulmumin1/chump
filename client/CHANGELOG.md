# chump-agent

## 0.0.19

### Patch Changes

- feat: consolidate state paths, extract system prompt, and improve web composer mobile UX

## 0.0.18

### Patch Changes

- SSE error parsing: extract `.error` from JSON error payloads instead of raw JSON string
  Immediate `/share` slash command handling during steering mode
  Expose `git_branch` in agent metadata
  fix: input paste buffer handling

## 0.0.17

### Patch Changes

- fix(cli): add spacing after tool activity output for cleaner transcript rendering

## 0.0.16

### Patch Changes

- Terminal resilience improvements: StdinBuffer for reliable escape sequence parsing, synchronized output mode, differential frame rendering, flush throttling, and soft redraw coalescing. Syntax highlighting for code blocks. Steering queue display now defers to server as source of truth. Paste detection fix.

## 0.0.15

### Patch Changes

- Print QR codes for share connect URLs and support QR scanning in the web connect modal.

## 0.0.14

### Patch Changes

- Add Chump Cloud as the default trial provider so new users can run Chump without connecting their own API key.

## 0.0.13

### Patch Changes

- Remove `/skill` slash command. Skills are now loaded automatically via AGENTS.md and skill bundles, so the manual command is no longer needed.

  Refactor TUI into modular ui/ components and add transcript renderer for cleaner message display.

## 0.0.12

### Patch Changes

- fix(cli): improve replay rendering, terminal wrapping, and diff display
  fix(cli): add blank line between tool activity and assistant text on replay
  fix(cli): use columns-1 for input rule to prevent terminal wrap
  fix(cli): extend input border rule to full terminal width
  fix: diff filename display and web patch parsing
  fix(cli): render apply_patch and write_file diffs from stored message args
  refactor: use /messages as single source of truth for transcript rendering

## 0.0.11

### Patch Changes

- a29a050: fix(tui): eliminate input-frame flicker on transitions

  The input/footer no longer "jumps up then down" when a thinking summary or
  other block is committed to scrollback while the prompt is live. `writeOutput`
  now emits the draft clear, the new content, and the draft redraw as a single
  `process.stdout.write`, so the terminal can never paint a partial frame
  between the three. `buildRedraw` also short-circuits when the rendered frame
  is byte-for-byte identical to the previous one, avoiding redundant
  cursor-hide/show cycles on no-op state changes.

## 0.0.10

### Patch Changes

- 32d1251: Fix web transcript replay and steering behavior so live sessions stay event-sourced, avoid stale snapshot overrides, and queue messages through the normal send action while an agent is running.

## 0.0.9

### Patch Changes

- e03642f: Added /skills and AGENTS.md support
  Expose instruction files and skills in health/status endpoints (server)

## 0.0.8

### Patch Changes

- f15cf78: Improve terminal UI rendering by optimizing frame redraws and fixing cursor drift.
  Refactor queued line and steering submission handling to prevent UI artifacts.

## 0.0.7

### Patch Changes

- 60afd14: - Add steering-aware queued input, image attachments, and large-paste handling.
  - Route messages submitted during an active turn through backend steering when possible.
  - Keep steered messages pending near the input until the backend accepts them at a step boundary.
  - Requeue steered messages as normal turns if the active turn finishes before a steering boundary.
  - Allow Option-Up to pull pending steered messages back into the editor and cancel backend injection.
  - Add image attachment and large-paste support in the CLI input flow.

## 0.0.6

### Patch Changes

- Improve attachment handling, image ordering, and input editing behavior across the CLI:

  - Preserve text/image order when building multimodal prompts.
  - Make pasted and dropped images attach reliably, with clearer error reporting on request failures.
  - Fix attachment chip deletion and slash-command interactions while the agent is working.
  - Add Ctrl shortcuts for common Command-style input actions on macOS terminals.

## 0.0.5

### Patch Changes

- 673ee26: fix(client): show spinner alongside reasoning and refresh on tool activity

  - Display reasoning text and spinner simultaneously instead of mutually exclusive
  - Add spinner.refresh() to re-render the current frame without restarting the animation timer
  - Use refresh on tool activity instead of start() to avoid janky spinner resets

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
