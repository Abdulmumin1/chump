# Chump event protocol

Chump has two event layers:

- ai-query `TurnEvent` owns transient model, reasoning, step, retry, and tool
  lifecycle activity;
- this protocol owns Chump's durable collaboration projections, including user
  messages, assistant text, steering, turn state, compaction, and replayable
  tool summaries.

Every newly emitted Chump payload carries `schema_version: 1`. CLI and web
normalize legacy payloads without a version to v1, reject malformed known
events, and ignore unknown future versions. Extra fields are additive within a
version; removing, renaming, or changing the meaning of a field requires a new
schema version.

When changing the contract, update these together:

1. `chump-events-v1.schema.json`;
2. `fixtures/chump-events-v1.json`;
3. `server/chump_server/events.py`;
4. the CLI and web `events.ts` modules.

The root `pnpm check` command runs compatibility tests against the same fixture
in Python, CLI TypeScript, and web TypeScript.

## Replay cursor

SSE event IDs are session-local and monotonically increasing. A consumer's
cursor is the ID of the last event it successfully applied, not merely the last
event received. On reconnect, clients send that cursor as `last_event_id`.

The server sends replayed events before newer live events. Consumers still
discard IDs less than or equal to their cursor, making reconnect delivery
idempotent if a proxy or transport repeats the boundary event. Non-replayable
events may create numeric gaps, so consumers require increasing IDs rather than
consecutive IDs.
