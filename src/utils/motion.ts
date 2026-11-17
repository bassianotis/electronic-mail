/**
 * Given to a card's motion element as onUpdate, it keeps framer-motion from running the card's
 * opacity animations natively (WAAPI): framer ends a native animation by cancelling it and writes
 * the final value only on its next frame, so in between the card shows its starting opacity. That
 * was a visible blink (one frame, longer while the page is busy), e.g. at the end of the fade-in of
 * a card put back by Undo. framer skips native animations for elements with an onUpdate.
 */
export const noNativeAnimation = () => {};

/**
 * The app's motion (design system v2, board F-motion): two curves and four durations, the same as
 * --ease-in, --ease-out and --dur-instant / -fast / -base / -slow in styles/tokens.css.
 * - Arriving: EASE (an ease-out with no overshoot). Leaving: EASE_OUT, which speeds up as it goes;
 *   leaving is quicker than arriving.
 * - Instant 100ms: hover, pressed, checks, a menu leaving. Fast 150: leaving, drag. Mid 200: arriving
 *   (menus, notices, dialogs). Slow 350: a whole page or a long move.
 * main.tsx makes the slow tween every motion element's default, so nothing springs unless dragged.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const EASE_OUT = [0.4, 0, 1, 1] as const;
export const DURATION = { instant: 0.1, fast: 0.15, mid: 0.2, slow: 0.35 };
export const tween = (duration: number) => ({ duration, ease: EASE });
/** Leaving: the exit curve (an `exit`'s own transition). */
export const leave = (duration: number = DURATION.fast) => ({ duration, ease: EASE_OUT });
/** A dragged card's size: 50% everywhere (board F-motion), around the point where it was grabbed. */
export const DRAG_SCALE = 0.5;
