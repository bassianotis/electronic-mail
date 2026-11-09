/**
 * Given to a card's motion element as onUpdate, it keeps framer-motion from running the card's
 * opacity animations natively (WAAPI): framer ends a native animation by cancelling it and writes
 * the final value only on its next frame, so in between the card shows its starting opacity. That
 * was a visible blink (one frame, longer while the page is busy), e.g. at the end of the fade-in of
 * a card put back by Undo. framer skips native animations for elements with an onUpdate.
 */
export const noNativeAnimation = () => {};

/**
 * The app's motion (unslop round 1): one curve and three durations, the same as --ease, --dur-fast,
 * --dur-mid and --dur-slow in index.css. Fast: hover, press, toggles. Mid: menus, popovers,
 * notices. Slow: entrances, sheets, layout changes. main.tsx makes the slow tween every motion
 * element's default, so nothing springs unless dragged.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const DURATION = { fast: 0.15, mid: 0.2, slow: 0.35 };
export const tween = (duration: number) => ({ duration, ease: EASE });
