# chump-server

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
