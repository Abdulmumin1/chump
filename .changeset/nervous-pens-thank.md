---
"chump-agent": patch
---

fix(client): show spinner alongside reasoning and refresh on tool activity

- Display reasoning text and spinner simultaneously instead of mutually exclusive
- Add spinner.refresh() to re-render the current frame without restarting the animation timer
- Use refresh on tool activity instead of start() to avoid janky spinner resets
