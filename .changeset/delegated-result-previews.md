---
"chump-agent": patch
---

Fix delegated and parallel tool result previews: results render as they arrive instead of waiting on the whole step, start_session results show the session id and outcome, and search_models collapses to a one-line summary. Slash-command echo no longer double-prints when the TUI handles it, and the web workspace state keeps delegated run state truthful on load.
