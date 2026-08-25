/**
 * Decouples raw token arrival from presentation.
 *
 * Raw chunks are appended to an in-memory buffer immediately. A
 * `requestAnimationFrame` drain loop reveals the buffer to the UI in small
 * text segments (words), so irregular network chunks read as one smooth
 * stream. The reveal rate adapts to how far the visible text lags behind the
 * buffer, and the first segment is emitted synchronously so time-to-first-token
 * is unaffected.
 *
 * This module is framework-agnostic and has no DOM/Svelte dependency.
 */

export interface StreamSmootherOptions {
    /** Called with the currently-visible text whenever the reveal advances. */
    onReveal?: (text: string) => void;
    /** Reveal rate (segments/second) when the buffer is caught up. */
    baseSegmentsPerSecond?: number;
    /** Floor for the adaptive reveal rate. */
    minSegmentsPerSecond?: number;
    /** Ceiling for the adaptive reveal rate (and the flush rate on finish). */
    maxSegmentsPerSecond?: number;
    /** Extra segments/second added per buffered segment of backlog. */
    backlogGain?: number;
}

// These rates are deliberately conservative. The scheduler is meant to hide
// provider chunk timing, not to turn a fast response into a word burst.
const DEFAULT_BASE = 24;
const DEFAULT_MIN = 16;
const DEFAULT_MAX = 180;
const DEFAULT_GAIN = 1.5;
const MAX_SEGMENTS_PER_FRAME = 3;

function isWhitespace(char: string): boolean {
    return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/** Number of word-like segments (non-whitespace run + trailing whitespace). */
export function countSegments(text: string): number {
    let count = 0;
    let i = 0;
    const n = text.length;

    while (i < n) {
        while (i < n && isWhitespace(text[i])) i += 1;
        if (i >= n) break;
        count += 1;
        while (i < n && !isWhitespace(text[i])) i += 1;
        while (i < n && isWhitespace(text[i])) i += 1;
    }

    return count;
}

/**
 * Advances `from` past `segments` word-like segments, snapping to whole-word
 * boundaries where possible. The final partial word is still revealed so the
 * stream never appears stalled at a cut-off token.
 */
export function advanceBySegments(
    text: string,
    from: number,
    segments: number,
): number {
    let i = Math.max(0, from);
    const n = text.length;

    // Start on a word, not on inter-segment whitespace.
    while (i < n && isWhitespace(text[i])) i += 1;

    let seen = 0;
    while (i < n && seen < segments) {
        while (i < n && !isWhitespace(text[i])) i += 1;
        while (i < n && isWhitespace(text[i])) i += 1;
        seen += 1;
    }

    return i;
}

export class StreamSmoother {
    private buffer = "";
    private revealed = 0;
    private finished = false;
    private rafId: number | null = null;
    private rafIsTimeout = false;
    private lastTime = 0;
    private segmentBudget = 0;
    private finishTimer: ReturnType<typeof setTimeout> | null = null;
    private lastEmitted = "";
    private readonly base: number;
    private readonly min: number;
    private readonly max: number;
    private readonly gain: number;
    private readonly onReveal?: (text: string) => void;

    constructor(options: StreamSmootherOptions = {}) {
        this.base = options.baseSegmentsPerSecond ?? DEFAULT_BASE;
        this.min = options.minSegmentsPerSecond ?? DEFAULT_MIN;
        this.max = options.maxSegmentsPerSecond ?? DEFAULT_MAX;
        this.gain = options.backlogGain ?? DEFAULT_GAIN;
        this.onReveal = options.onReveal;
    }

    /** Number of buffered characters that have not been revealed yet. */
    get pendingLength(): number {
        return this.buffer.length - this.revealed;
    }

    /** Appends a raw chunk to the receive buffer and starts draining. */
    push(text: string): void {
        if (!text) return;

        // Be defensive if a provider starts the next turn before its status
        // event arrives. The controller normally creates a fresh smoother at
        // that boundary, but a finished smoother must never join two answers.
        if (this.finished) this.reset();

        this.buffer += text;

        if (this.revealed === 0 && this.buffer.length > 0) {
            // Reveal the first segment immediately so the first token is not
            // delayed by the pacing loop.
            this.revealed = advanceBySegments(this.buffer, 0, 1);
            this.emit(this.buffer.slice(0, this.revealed));
        }

        this.ensureLoop();
    }

    /** Marks the stream complete; the drain loop accelerates to flush. */
    finish(): void {
        this.finished = true;
        this.clearFinishTimer();
        if (this.revealed < this.buffer.length) {
            this.ensureLoop();
            // rAF can be throttled when a tab is backgrounded. Keep the
            // completion guarantee independent of browser frame scheduling.
            this.finishTimer = setTimeout(() => this.flush(), 5_000);
        } else {
            this.emit(this.buffer);
        }
    }

    /** Synchronously reveals and emits the entire buffer, then stops. */
    flush(): void {
        this.cancelLoop();
        this.clearFinishTimer();
        this.revealed = this.buffer.length;
        this.emit(this.buffer);
    }

    /** Cancels the drain loop and clears all buffered state. */
    reset(): void {
        this.cancelLoop();
        this.clearFinishTimer();
        this.buffer = "";
        this.revealed = 0;
        this.finished = false;
        this.lastEmitted = "";
        this.segmentBudget = 0;
    }

    private ensureLoop(): void {
        if (this.rafId !== null) return;
        this.lastTime = performance.now();
        if (typeof requestAnimationFrame === "function") {
            this.rafIsTimeout = false;
            this.rafId = requestAnimationFrame(this.tick);
        } else {
            // Keeps the class usable in SSR/tests. Browsers use rAF above.
            this.rafIsTimeout = true;
            this.rafId = setTimeout(() => this.tick(performance.now()), 16) as unknown as number;
        }
    }

    private cancelLoop(): void {
        if (this.rafId !== null) {
            if (this.rafIsTimeout) {
                clearTimeout(this.rafId);
            } else {
                cancelAnimationFrame(this.rafId);
            }
            this.rafId = null;
            this.rafIsTimeout = false;
        }
    }

    private tick = (now: number): void => {
        this.rafId = null;

        if (this.revealed >= this.buffer.length) {
            if (this.finished) {
                this.clearFinishTimer();
                this.emit(this.buffer);
            }
            return;
        }

        const elapsed = Math.max(0, now - this.lastTime);
        this.lastTime = now;

        const backlog = countSegments(this.buffer.slice(this.revealed));
        let rate: number;
        if (this.finished) {
            rate = this.max;
        } else {
            rate = Math.max(
                this.min,
                Math.min(this.max, this.base + backlog * this.gain),
            );
        }

        // Accumulate fractional segments. Taking one segment on every frame
        // would turn an 18-word/sec stream into a 60-word/sec stream on a
        // 60Hz display and make the pacing depend on refresh rate.
        this.segmentBudget += (rate * elapsed) / 1000;
        // A delayed frame can accumulate a large budget after Markdown or
        // layout work. Limit what one paint exposes; otherwise the adaptive
        // rate itself creates the same visible jumps we are trying to remove.
        const segments = Math.min(
            MAX_SEGMENTS_PER_FRAME,
            Math.floor(this.segmentBudget),
        );
        if (segments < 1) {
            this.ensureLoop();
            return;
        }
        this.segmentBudget -= segments;

        this.revealed = advanceBySegments(this.buffer, this.revealed, segments);
        this.emit(this.buffer.slice(0, this.revealed));

        if (this.revealed < this.buffer.length) {
            this.ensureLoop();
        } else if (this.finished) {
            this.clearFinishTimer();
            this.emit(this.buffer);
        }
    };

    private clearFinishTimer(): void {
        if (this.finishTimer !== null) {
            clearTimeout(this.finishTimer);
            this.finishTimer = null;
        }
    }

    private emit(text: string): void {
        if (text === this.lastEmitted) return;
        this.lastEmitted = text;
        this.onReveal?.(text);
    }
}
