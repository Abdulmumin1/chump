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
