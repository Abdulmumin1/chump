---
"chump-agent": patch
---

Prefer archived one-directory `chump-server` runtimes for server updates so installed CLIs do not replace the bundled fast runtime with a slow PyInstaller onefile binary. Older onefile server release assets remain supported as a fallback.

Update notices now include server-only updates and keep working when the npm version lookup fails but the server release lookup succeeds.
