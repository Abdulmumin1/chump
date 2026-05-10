---
"chump-agent": patch
---

fix(tui): eliminate input-frame flicker on transitions

The input/footer no longer "jumps up then down" when a thinking summary or
other block is committed to scrollback while the prompt is live. `writeOutput`
now emits the draft clear, the new content, and the draft redraw as a single
`process.stdout.write`, so the terminal can never paint a partial frame
between the three. `buildRedraw` also short-circuits when the rendered frame
is byte-for-byte identical to the previous one, avoiding redundant
cursor-hide/show cycles on no-op state changes.
