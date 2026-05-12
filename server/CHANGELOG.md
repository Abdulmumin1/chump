# chump-server

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
