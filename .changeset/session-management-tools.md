---
"chump-agent": patch
---

Release the bundled Chump server with native session-management tools. Agents can now list saved sessions, inspect prior threads, and start isolated follow-up sessions without shelling out to `chump -p`.

This release also reduces server cold-start work by reusing one discovered resource catalog during startup, which should make packaged Python server launches a little lighter.
