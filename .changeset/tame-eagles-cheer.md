---
"chump-agent": patch
---

Pass `CHUMP_MANAGED_SERVER_IDLE_TIMEOUT` when starting managed servers and surface managed idle timeout fields in typed health/status responses.

- Default managed server idle timeout to 300 seconds in the CLI runtime when the env var is unset.
- Include `managed_idle_timeout` in `ChumpStatus` and `ChumpHealth` TypeScript types.
