# chump-server

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
