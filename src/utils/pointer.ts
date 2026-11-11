/**
 * Where the mouse is, for things that move under a still cursor. Some browsers (Safari) send "mouse
 * entered" only when the mouse itself moves, so a card that slides up under the cursor (the one
 * above it archived) never hears it. A list watches its contents (`watchForMoves`); when they change,
 * its cards ask `pointerIsOver` (`onPointerRecheck`), at once and again once any movement has settled.
 */
let last: { x: number; y: number } | null = null;
let listening = false;

function listen() {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    window.addEventListener('pointermove', e => { last = { x: e.clientX, y: e.clientY }; }, { capture: true, passive: true });
    // The mouse left the window: it's over nothing here
    document.documentElement.addEventListener('mouseleave', () => { last = null; });
}
listen();

/** Whether the mouse is over `el` now (and not over something covering it). */
export function pointerIsOver(el: Element | null): boolean {
    if (!el || !last) return false;
    const hit = document.elementFromPoint(last.x, last.y);
    return !!hit && el.contains(hit);
}

const RECHECK = 'em-pointer-recheck';

/** Runs `check` whenever a watched list's contents have changed. Returns the unsubscribe. */
export function onPointerRecheck(check: () => void): () => void {
    window.addEventListener(RECHECK, check);
    return () => window.removeEventListener(RECHECK, check);
}

/** Watches a list: when items come or go, the items check the mouse now and after `settleMs`. */
export function watchForMoves(container: Element, settleMs: number): () => void {
    let timers: number[] = [];
    const fire = () => window.dispatchEvent(new Event(RECHECK));
    const observer = new MutationObserver(() => {
        timers.forEach(clearTimeout);
        timers = [window.setTimeout(fire, 30), window.setTimeout(fire, settleMs)];
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => {
        observer.disconnect();
        timers.forEach(clearTimeout);
    };
}
