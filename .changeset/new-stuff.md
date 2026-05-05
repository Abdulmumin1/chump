---
"chump-agent": patch
---

- Add steering-aware queued input, image attachments, and large-paste handling.
- Route messages submitted during an active turn through backend steering when possible.
- Keep steered messages pending near the input until the backend accepts them at a step boundary.
- Requeue steered messages as normal turns if the active turn finishes before a steering boundary.
- Allow Option-Up to pull pending steered messages back into the editor and cancel backend injection.
- Add image attachment and large-paste support in the CLI input flow.
