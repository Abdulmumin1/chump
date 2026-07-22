# chump-server

## 0.1.9

- Normalize Google function declarations through `ai-query==1.9.4` so Gemini accepts Chump's MCP tool and other schemas with free-form object parameters.
- Persist provider failures that occur before the first token as replayable `turn_error` events while continuing to return the original error to the active chat stream.
- Add `turn_error` to the shared event contract and surface replayed failures in the web client instead of leaving failed turns indistinguishable from empty responses.

## 0.1.8

- Compact long-running tool-use turns between model steps as soon as provider-reported context reaches the configured threshold, preventing Codex sessions from exceeding the limit before the next user turn.
- Keep runtime and persisted histories synchronized after in-turn compaction while preserving the system prompt and full-turn usage accounting.
- Allow each bash tool call to set a custom timeout of up to one hour while retaining the configured command timeout as the default.

## 0.1.7

- Add server-owned Model Context Protocol support for local stdio and remote HTTP/SSE servers, with shared and project configuration, explicit project trust, lifecycle cleanup, and optional direct tool exposure.
- Add a low-context MCP proxy for conversational server discovery, tool inspection and invocation, reconnect diagnostics, and project/global configuration management.
- Render MCP activity with concise, readable labels in the CLI and web transcript instead of exposing raw proxy arguments.

## 0.1.6

- Page session summaries directly in SQLite instead of reading and decoding every stored transcript and legacy replay log before slicing the result.
- Keep session-list queries off the async request loop and cap interactive pages at six entries, preserving fast CLI startup and web connection even when a workspace contains very large or numerous sessions.
- Preserve exact transcript inspection and live-session counts while avoiding unbounded stored-message work during routine session discovery.

## 0.1.5

- Keep managed servers alive for the full lifetime of prompt, event-stream, and action requests so a large session cannot be shut down while its first request is still hydrating.
- Store replay events incrementally with a 2,048-event retention window instead of rewriting the complete session history for every event; migrate legacy event blobs automatically while preserving monotonic replay IDs.
- Advertise the exact model IDs supported by the running server so newer clients do not offer models to an older or mismatched backend.
- Return structured JSON validation errors for unsupported model changes instead of exposing an HTML `500 Internal Server Error` response.
- Make verbose backend and tool tracing opt-in, and use SQLite WAL mode with reduced synchronization overhead to substantially lower routine log and database writes.

## 0.1.4

- Add public Gemini API support for `gemini-3.6-flash` and `gemini-3.5-flash-lite`, both with 1,048,576-token context windows and 65,536-token output limits.
- Make Gemini 3.6 Flash the default Google model for new and unconfigured sessions.
- Keep the limited-access Gemini 3.5 Flash Cyber model out of the public selector until Google exposes it through the Gemini API.

## 0.1.3

- Add the versioned Chump v1 event contract for durable collaboration events while remaining compatible with legacy stored sessions.
- Make event replay deterministic across disconnects by resuming from the last successfully applied event, suppressing replay-boundary duplicates, and closing snapshot-to-stream gaps.
- Preserve queued steering text and image content when an active turn is aborted and restarted, without exposing private image bytes in public events.
- Await cancellation of every parallel tool, retain call/result correlation and invocation order, and upgrade the runtime to `ai-query==1.9.2`.
- Keep skills marked `disable-model-invocation` out of model-visible prompts and tool catalogs while allowing explicit manual invocation through the clients.

## 0.1.2

- Stop forwarding the built-in system prompt twice to Codex Responses, reducing duplicated instructions and inflated context usage.
- Streamline the built-in coding-agent instructions while preserving terminal workflow, verification, type-safety, and maintainability guidance.

## 0.1.1

- Add GPT-5.6, GPT-5.6 Sol, GPT-5.6 Terra, and GPT-5.6 Luna model support for the Codex and OpenAI providers.

## 0.0.45

- Add a workspace-scoped `view_image` tool for PNG, JPEG, GIF, and WebP files using `ai-query` 1.7.55 multimodal tool outputs.
- Fix `list_sessions` when the active session entry is a live agent rather than connection metadata.
- Add `@cf/zai-org/glm-5.2` (262K context) to Workers AI and all model lists; set it as the Workers AI default.
- Switch the `opencode_go` default model to `deepseek-v4-flash`.
- Upgrade the backend dependency to `ai-query==1.8.0`.
- Remove deprecated models: GPT 5.3 and below, Kimi K2.6 and below, Gemini 2.5 and below.
- Stop the update checker from reporting a false `server 0.0.0 -> <latest>` notice when the bundled server version probe fails.
- Preserve leading system messages when compacting session history.

## 0.0.44

- Upgrade `ai-query` to 1.7.54 and forward typed tool-call readiness plus correlated provider and execution lifecycle events.
- Stream native Codex Responses function-call argument deltas through the unified `ai-query` event pipeline.
- Correlate tool calls, execution completion, rich result metadata, and final results by step, provider index, and call id so parallel bash and file-edit results cannot attach to the wrong call.
- Preserve cumulative turn and session usage under the new per-step usage contract, and serialize concurrent tool bookkeeping updates.

## 0.0.43

- Improve FFF search process handling, error propagation, and tool schema to return structured match metadata.
- Update system prompt rules prioritization and coding guidelines.

## 0.0.42

- Strengthen system prompt: Chump now identifies as the user's companion rather than the owner, and is instructed to adapt to user changes rather than reverting them.

## 0.0.41

- Attach legacy onefile server binaries alongside the fast runtime archives so older `chump update` clients can still update across the archive-format transition.

## 0.0.40

- Load the built-in `skill-creator` skill from code instead of writing `.chump/skills/skill-creator/SKILL.md` into every workspace during startup, while still allowing project or global skills with the same name to override it.
- Publish server runtime archives from one-directory PyInstaller builds so GitHub release downloads avoid the slow onefile self-extraction path.

## 0.0.39

- Add native session-management tools so Chump can list saved sessions, inspect prior threads, and start isolated follow-up sessions without shelling out to the CLI.
- Reduce server cold-start work by sharing one discovered resource catalog between startup logging and the running server.

## 0.0.38

- Add daemon-backed project/session routing for local web clients, including authenticated project runtime control, session forwarding, file search proxying, streaming chat/events, native project directory picking, and daemon-backed Git actions.
- Add paginated session listings and attachment-safe daemon payload handling for large image messages.
- Improve local daemon and managed server reliability for hosted web handoff, standalone binary startup, stale local server locks, and PWA/service-worker request handling.

## 0.0.37

- Release updated web client interface with interactive command palette, image zooming improvements, instant reasoning streams, and FFF workspace searches.

## 0.0.36

- Add Cloudflare Workers AI catalog support for Kimi K2.7 Code.

## 0.0.35

- Request Gemini thought text when normalized reasoning budgets are applied through the Google provider adapter.

## 0.0.34

- Allow the PyInstaller build script to produce one-folder runtimes for bundled client archives while keeping single-file server release binaries.
- Make repeated server binary builds replace either old single-file artifacts or runtime directories cleanly.

## 0.0.33

- Route Google models through Chump's Google provider adapter.
- Map normalized Google reasoning budgets to Gemini thinking config without requesting thought text.
- Include the workspace `skill-creator` skill file in the repository release state.

## 0.0.32

- Bundle standalone backend binaries for Chump releases and server-only sandbox deployments.
- Use provider-reported `last_step.total_tokens` as the context token source of truth.
- Emit post-compaction token counts so connected clients can update context badges immediately.

## 0.0.31

- Raise the default max steps to 250 and expose it through shared configuration docs.
- Report the backend process id in `/health` so clients can stop managed and orphaned local servers reliably.
- Seed a built-in `skill-creator` workspace skill when no project override exists.
- Document one-shot prompt mode and provider inspection commands.

## 0.0.30

- Trigger auto compaction from provider-reported context usage even when local text estimates undercount the session.
- Document the installed server command with `chump-server@latest`.

## 0.0.29

- Add provider normalization, defaults, and runtime adapters for GitHub Copilot, OpenRouter, Groq, xAI, OpenCode, and ZenMux.
- Move the Codex adapter into the shared provider package and keep Codex compaction summaries on the Responses API path.
- Preserve tool-call/tool-result boundaries when compacting session history.

## 0.0.28

- Introduce summary/history compaction for agent sessions to optimize LLM context window usage.
- Enhance configuration handling with local `.chump/config.json` support.
- Alignment with client v0.0.28 release.

## 0.0.27

- Label the backend process as `Chump Agent (Server)` in process monitors where supported.
- Add `setproctitle` to make the server process discoverable by name on macOS Activity Monitor and similar tools.
- Alignment with client v0.0.27 release.

## 0.0.26

- Add explicit `display_content` for user and steering payloads so clients preserve attachment-aware message text without reconstructing it heuristically.
- Alignment with client v0.0.26 release.

## 0.0.25

- Add stable labels to summarized image attachments so clients can reconstruct mixed text/image user messages more accurately.
- Alignment with client v0.0.25 release.

## 0.0.24

- Configure fallback SSL verification context using `certifi` for web fetch and exa website search tools to prevent `SSLCertVerificationError` on macOS.
- Alignment with client v0.0.24 release.

## 0.0.23

- Alignment with client v0.0.23 release.

## 0.0.22

- Add Gemini 3.5 Flash model support and configure its input/output token limits.
- Set Google's default fallback model to `gemini-3.5-flash`.
- Fix config test suite isolation under active shell environments.

## 0.0.21

- Track per-file diff stats and structured change records in agent/session state.
- Surface session-wide added/removed totals in `/sessions` responses.
- Improve tool result metadata with unified diff lines for richer UI rendering.
- Enforce fresh `read_file` checks before write/apply_patch mutations and clear edit previews.

## 0.0.20

- Support for tracking and syncing usage data for context limits with client

## 0.0.19

- feat: consolidate state paths, extract system prompt, and auto shutdown server map

## 0.0.18

- Expose `git_branch` in health endpoint and agent status
- Structured chat error responses with type and formatted message
- Structured Codex `response.failed` error parsing with code/type/message breakdown
- Bump dependency: `ai-query==1.7.46`

## 0.0.17

- Configurable retry policy for provider calls via `CHUMP_RETRY_*` environment variables.

## 0.0.16

- Expose `available_providers` in health endpoint so the web client shows models from exactly the connected providers.

## 0.0.15

- Add Chump Cloud as the default trial provider for zero-setup usage.
- Route Chump Cloud through a hosted DeepSeek-compatible Worker with hourly KV rate limiting.
- Preserve DeepSeek reasoning metadata across tool loops when using Chump Cloud.

## 0.0.14

- Expose `active_connections` count in server status endpoint.
- Lazy-load `ChumpAgent` for faster server startup.
- Surface AGENTS.md files and skill bundles to the agent system prompt.

## 0.0.13

- Add DeepSeek provider support with model normalization.
- Upgrade the backend dependency to `ai-query==1.7.43`.
- Validate and normalize model names against known provider model sets.
- Load model from `CHUMP_MODEL` environment variable, auth config, or provider default.

## 0.0.12

- Add DeepSeek provider support with model normalization.
- Upgrade the backend dependency to `ai-query==1.7.43`.
- Validate and normalize model names against known provider model sets.
- Load model from `CHUMP_MODEL` environment variable, auth config, or provider default.

## 0.0.11

- Add install scripts and web redirects for chump client binaries.

## 0.0.10

### Patch Changes

- Stabilize the patch tool parser so `apply_patch` accepts the simpler patch form agents tend to produce, including fenced blocks, missing `*** Begin Patch` / `*** End Patch` wrappers, colonless file headers, and unprefixed context lines.
- Keep live turn state, assistant text, and steering queue updates synchronized across connected clients.
- Render queued steering and live transcript events from the event stream instead of letting snapshot refreshes overwrite in-progress output.

## 0.0.6

### Patch Changes

- Upgrade the backend dependency to `ai-query==1.7.36`.
- Preserve attachment order when constructing multimodal user content so images can be referenced in-line with text.
- Increase the request body size limit for image-heavy chats and surface clearer JSON parse errors.

## 0.0.5

### Patch Changes

- Upgrade the backend dependency to `ai-query==1.7.35`.
- Move chat execution onto ai-query `AgentTurn` so chump can receive turn events and step-boundary steering.
- Add `steer_current_turn` and `cancel_last_steering` actions for mid-turn user corrections.
- Add image attachment payload support for chat requests.
- Avoid duplicate user-message persistence when running turn-based chats.

## 0.0.4

### Patch Changes

- Upgrade the backend dependency to `ai-query==1.7.34`.

## 0.0.3

### Patch Changes

- Add managed server idle shutdown support through `CHUMP_MANAGED_SERVER_IDLE_TIMEOUT`.
- Expose managed idle timeout values through health and status responses.
- Log chat exceptions with tracebacks before streaming error events.
- Upgrade the backend lock entry to `ai-query==1.7.33`.

## 0.0.2

### Patch Changes

- Add a Codex provider backed by ChatGPT OAuth credentials from `chump connect`.
- Add runtime model switching support for Codex and existing providers.
- Add runtime reasoning configuration, including provider-specific Gemini thinking budgets.
- Request and forward Codex reasoning summaries while filtering noisy summary fragments.
- Upgrade the backend dependency to `ai-query==1.7.33`.

## 0.0.1

### Patch Changes

- Prepare the first public backend package release.
