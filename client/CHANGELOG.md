# chump-agent

## 0.2.9

### Patch Changes

- Add shell completion for Bash, Zsh, Fish, and PowerShell. Platform
  installers automatically generate and enable completion for the running
  shell. A `chump completion <shell>` command remains available for manual
  setup, and global npm installs enable completion on first interactive
  launch.

## 0.2.8

### Patch Changes

- Add readable MCP tool activity to the CLI while the bundled server gains conversational MCP discovery, invocation, and configuration support.

## 0.2.7

### Patch Changes

- Use a hollow-circle marker for completed CLI tools and commands so their labels align consistently across terminal fonts.

## 0.2.6

### Patch Changes

- Make large session histories fast without hiding older conversations. Chump now hydrates only the six most recent session summaries during CLI startup, pages metadata directly in SQLite without decoding stored transcripts, and keeps that work off the server request loop.

  Opening `/session` lazily retrieves the remaining six-item pages with bounded concurrency, so scrolling and title or session-ID search still cover the complete history. Web session lists retain explicit page navigation while benefiting from the same lightweight server summaries.

## 0.2.5

### Patch Changes

- Truncate long terminal command previews to five rows with a compact ellipsis marker, and refresh update checks on every interactive launch so newly published releases appear immediately.

## 0.2.4

### Patch Changes

- Make managed sessions responsive and self-recovering: keep the server alive while prompts and actions hydrate session state, replay an interrupted first request after recovery, and filter `/model` choices to models the connected server actually supports.

  Reduce persistent writes by making routine client diagnostics opt-in, rotating client and server logs, disabling verbose backend tracing by default, and moving replay history to bounded incremental storage with automatic migration from legacy session blobs.

## 0.2.3

### Patch Changes

- Add Gemini 3.6 Flash and Gemini 3.5 Flash-Lite to the Google model catalog, use Gemini 3.6 Flash as the default, and preserve accurate context/output limits when models.dev is unavailable.

## 0.2.2

### Patch Changes

- Add versioned Chump v1 events across the CLI and web client, render completed reasoning as structured Markdown, and resume reconnects from the last successfully applied event without duplicate output.
- Recover dead managed servers across prompts, status/model/session actions, print mode, and file search; safely replay interrupted requests once when no tool side effect has begun so the original prompt is not lost.
- Discover manually invokable skills in slash-command completion and run them as `/skill:name [arguments]` while keeping injected skill instructions out of the visible transcript.
- Preserve queued steering text and images across turn aborts, and wait for parallel tool cancellation and cleanup before starting the follow-up turn.
- Polish the Pi TUI with edge-aligned input and picker rows, title-cased tool labels, syntax-aware command rows, tree-linked and bounded output, and faithful tool/reasoning reconstruction when sessions resume.

## 0.2.1

### Patch Changes

- Show parallel tool activity as stable correlated status rows, retain invocation order when results complete out of order, and keep each command output attached to its originating call.

## 0.2.0

### Minor Changes

- Rebuild the interactive client on Pi TUI with Chump-native editor styling, a clear three-row footer with explicit thinking state, consistent transcript spacing, reliable slash-command pickers, stable single-row live activity, bounded command output, smooth delta-by-delta Markdown streaming, correlated one-row tool outcomes, and an extensible shell with component slots, key handlers, autocomplete providers, and output transforms.

## 0.1.16

### Patch Changes

- Add GPT-5.6 model family support across Codex and OpenAI, show all providers in /model suggestions, and keep CLI tool activity compact without crowding adjacent assistant text.

## 0.1.15

### Patch Changes

- - Add `@cf/zai-org/glm-5.2` (262K context) to Workers AI and all model lists; set it as the Workers AI default.
  - Switch the `opencode_go` default model to `deepseek-v4-flash`.
  - Upgrade the backend dependency to `ai-query==1.8.0`.
  - Remove deprecated models: GPT 5.3 and below, Kimi K2.6 and below, Gemini 2.5 and below.
  - Stop the update checker from reporting a false `server 0.0.0 -> <latest>` notice when the bundled server version probe fails.
  - Preserve leading system messages when compacting session history.

## 0.1.14

### Patch Changes

- Remove queued steering placeholders when the same message starts processing so CLI and web transcripts do not show duplicate user messages.

## 0.1.13

### Patch Changes

- Start the CLI working spinner when reconnecting to or switching into a session that is already running.

## 0.1.12

### Patch Changes

- Keep resumed CLI/web transcripts from dumping loaded skill content, show edit diffs only after successful edit results, and preserve the web working indicator when reconnecting to a running session.

## 0.1.11

### Patch Changes

- Improve `view_image` activity and result presentation in the terminal and web transcript.
- Clear pasted image attachments when the terminal draft is cleared so later pastes do not accumulate stale images.

## 0.1.10

### Patch Changes

- Correlate live tool output by step, provider index, and call id so streamed bash and file-edit activity stays attached to the right call in both the CLI and web transcript. Show present-tense live activity labels, preview streamed commands and file writes while arguments arrive, and display an explicitly approximate live reasoning-token counter.

## 0.1.9

### Patch Changes

- Improve search tool schema, input buffering, and rendering to optimize search latency and typing responsiveness.

## 0.1.8

### Patch Changes

- ff5044b: Wait longer for the bundled server version probe so update checks do not reinstall an already-current server.

## 0.1.7

### Patch Changes

- 29bc163: Allow release update checks more time to complete so standalone installs can reliably detect server-only updates.

## 0.1.6

### Patch Changes

- a51fd8a: Keep server updates compatible with older installed clients by publishing legacy onefile server assets alongside the preferred fast runtime archives.

## 0.1.5

### Patch Changes

- b011777: Prefer archived one-directory `chump-server` runtimes for server updates so installed CLIs do not replace the bundled fast runtime with a slow PyInstaller onefile binary. Older onefile server release assets remain supported as a fallback.

  Update notices now include server-only updates and keep working when the npm version lookup fails but the server release lookup succeeds.

## 0.1.4

### Patch Changes

- f4402ad: Release the bundled Chump server with native session-management tools. Agents can now list saved sessions, inspect prior threads, and start isolated follow-up sessions without shelling out to `chump -p`.

  This release also reduces server cold-start work by reusing one discovered resource catalog during startup, which should make packaged Python server launches a little lighter.

## 0.1.3

### Patch Changes

- 1da184f: Open the hosted chat app route from `chump app` so daemon handoff parameters are consumed automatically, and clean up local server locks left by exited processes.

## 0.1.2

### Patch Changes

- 262ba9f: Fix daemon startup from packaged Chump binaries by respawning the standalone executable with the correct daemon argument.

## 0.1.1

### Patch Changes

- f6cd547: Prepare daemon-backed web app startup for early testing by trusting the hosted Chump web origin and keeping daemon credentials out of default CLI output.
- 8aa6c1e: Add daemon-backed web Git actions for committing, pushing, and creating pull requests from the changes panel.

## 0.1.0

### Minor Changes

- Add FFF-powered file mentions and workspace content search. Include a sleek command palette modal (accessible via Cmd/Ctrl+K), polished shadowless dropdown/modal UI, smooth container transitions, dynamic streaming reasoning indicators, and body-teleported responsive image zoom overlays.

## 0.0.39

### Patch Changes

- Add Cloudflare Workers AI catalog support for Kimi K2.7 Code.

## 0.0.38

### Patch Changes

- Coordinate CLI prompt status updates so compaction activity is not overwritten by turn-status refreshes.

## 0.0.37

### Patch Changes

- Package the bundled server as a one-folder runtime for faster warm startup and install it under the archive's server directory.

## 0.0.36

### Patch Changes

- Make `chump update` check bundled `chump-server` releases and update the adjacent server binary when a server-only release is newer than the installed bundle.

## 0.0.35

### Patch Changes

- Bundle the managed backend into standalone release packages, remove the uvx runtime fallback, and keep context token badges synchronized from provider-reported usage after compaction.

## 0.0.34

### Patch Changes

- Add `chump -p` one-shot prompt mode with optional `--verbose` diagnostics, model selection, and thinking controls.
  Add `chump providers` for inspecting connected provider credentials.
  Improve `chump stop` so managed and orphaned local servers are stopped reliably.
  Match the CLI default max steps to the server default so managed servers can be reused across quick restarts.
  Refresh install script output and options.

## 0.0.33

### Patch Changes

- Add cached update checks, `chump --version`, and `chump update` for installed CLI and standalone binary users.
- Let CLI transcript user-message rendering come from the server SSE stream instead of an immediate local echo, so chat submissions render from a single source of truth.

## 0.0.32

### Patch Changes

- Only log event stream connection and reconnect errors when CHUMP_DEBUG_EVENTS is enabled to keep terminal output clean.

## 0.0.31

### Patch Changes

- Reduce repeated event-stream retry logging during transient outages and start installed servers with `chump-server@latest`.

## 0.0.30

### Patch Changes

- Add GitHub Copilot, xAI, OpenRouter, Groq, OpenCode, and ZenMux provider support to the CLI, expand fallback model metadata, and make background event stream reconnects back off more cleanly.

## 0.0.29

### Patch Changes

- Make direct connections to remote and tunneled servers highly resilient by increasing the connection health check timeout and adding retry attempts with incremental backoff.

## 0.0.28

### Patch Changes

- - Introduce history/summary compaction for agent sessions to optimize context window usage.
  - Enhance configuration management supporting both file-based configurations and environment variable overrides.
  - Improve Windows terminal process labels and process list reliability.
  - Update web interface with modular components and smoother session transitions.

## 0.0.27

### Patch Changes

- Improve Windows CLI resilience by avoiding detached managed-server console windows, using safer terminal rendering fallbacks, and labeling Chump CLI/server processes in system monitors.

## 0.0.26

### Patch Changes

- Preserve attachment-aware user message display text across steering queues, synced transcripts, and web chat empty-state polish.

## 0.0.25

### Patch Changes

- Improve attachment-aware user message rendering across synced transcripts and shared chat surfaces.

## 0.0.24

### Patch Changes

- - Hide background/managed server and browser command prompt windows on Windows platforms to prevent unexpected console windows from opening or flashing.
  - Configure safe fallback SSL verification context using `certifi` for transport clients to prevent `SSLCertVerificationError` on macOS.

## 0.0.23

### Patch Changes

- Fixed a startup issue where the background server might take slightly longer than 15 seconds to start on the very first run (due to database initialization or slow disks), causing the client to crash with a timeout but leave a leaked server process running in the background. Increased the startup wait time to 30 seconds and ensured any failed server process is cleanly killed.

## 0.0.22

### Patch Changes

- Added Gemini 3.5 Flash model support with accurate token limits, updated model catalog merging, and updated web UI tool headers to cleanly display loaded skills.
- Implemented robust self-reconnecting background event streams with an idle/keepalive watchdog to eliminate random CLI hangs and stuck spinners on network drops or connection stalls.

## 0.0.21

### Patch Changes

- Prepare release with improved CLI resilience and recovery, richer session/tool state reporting, and web workspace state UX refresh.

## 0.0.20

### Patch Changes

- - Update web chat interface to display correct context token limits mimicking CLI
  - Move web app workspace route to `/c` and promote landing page to `/`
  - Add animated CONNECT button on root landing page
  - Fix live tool output display mapping during SSE stream

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
