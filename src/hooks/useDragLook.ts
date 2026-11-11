/**
 * How a dragged card looks, lands and goes home, the same for the Inbox, Up next, buckets and Archive
 * (docs/design/motion-audit.md, problem c):
 * - picked up, it shrinks around the point where it was grabbed, so it stays under the pointer, at 85%;
 * - dropped on a target, the move happens and the card fades out where it landed (150ms), with no
 *   trip home;
 * - dropped on nothing, it goes back to its slot on the app's curve (200ms), raised above the other
 *   cards until it's there. With Reduce motion on, it's back at once.
 *
 * The card's position is the hook's own (`x`, `y` in its style), not framer's snap to origin: framer
 * starts that return when the pointer is released, before the card knows where it was dropped.
 * The card tells the hook what it's over while dragged (`aim`), sets its z-index from `raised`, and
 * animates to `animate(itsUsualLook)`: over a target, that's already the dropped look underneath the
 * dragged one, so on release it stays small and fades rather than growing back first.
 *
 * Nothing in that look may name `x` or `y`: they're the dragged card's position, and a look that
 * names them (an Inbox card's slide-in) would pull the card toward its slot whenever the look
 * changes mid-drag, as on entering or leaving a target. A card that slides in when it arrives
 * passes `enterFrom` instead, and the hook moves `y` from there once.
 */
import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { animate, useMotionValue, useReducedMotion, type TargetAndTransition } from 'framer-motion';
import { DURATION, tween } from '../utils/motion';

type Phase = 'rest' | 'dragging' | 'returning' | 'dropped';

/** A dropped card still here after this long wasn't moved (the server refused): back to its slot. */
const DROP_GIVE_UP_MS = 2000;

export function useDragLook(card: RefObject<HTMLElement | null>, scale: number, enterFrom = 0) {
    const reduce = useReducedMotion();
    const x = useMotionValue(0);
    const y = useMotionValue(reduce ? 0 : enterFrom);

    // Arriving: from `enterFrom` below to its slot, once (as fast as the opening of a card)
    useEffect(() => {
        if (y.get() !== 0) void animate(y, 0, tween(DURATION.slow));
    }, [y]);
    const [origin, setOrigin] = useState<string | undefined>(undefined);
    const [phase, setPhase] = useState<Phase>('rest');
    const [aimed, setAimed] = useState(false);

    /** Pointer down (before the drag starts): where the card was grabbed. */
    const grab = useCallback((e: { clientX: number; clientY: number }) => {
        const r = card.current?.getBoundingClientRect();
        if (r) setOrigin(`${e.clientX - r.left}px ${e.clientY - r.top}px`);
    }, [card]);

    /** The drag began. */
    const start = useCallback(() => setPhase('dragging'), []);

    /** While dragged: the target under the pointer, if any. */
    const aim = useCallback((target: string | null) => setAimed(!!target), []);

    /** The drag ended over `target` (or none): commit makes the move. */
    const land = useCallback((target: string | null, commit: () => void) => {
        setAimed(false);
        if (target) {
            // Faded first, then moved: the list may drop the card at once (the last card of a
            // section takes its section with it), so the fade has to have happened by then
            setPhase('dropped');
            setTimeout(commit, DURATION.fast * 1000);
            return;
        }
        setPhase('returning');
        const home = reduce ? { duration: 0 } : tween(DURATION.mid);
        void Promise.all([animate(x, 0, home), animate(y, 0, home)])
            .then(() => setPhase(p => (p === 'returning' ? 'rest' : p)));
    }, [x, y, reduce]);

    useEffect(() => {
        if (phase !== 'dropped') return;
        const timer = setTimeout(() => {
            x.set(0);
            y.set(0);
            setPhase('rest');
        }, DROP_GIVE_UP_MS);
        return () => clearTimeout(timer);
    }, [phase, x, y]);

    /** The card while dragged. */
    const whileDrag = useMemo<TargetAndTransition>(() => ({
        scale,
        opacity: 0.85,
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-floating)',
        cursor: 'grabbing',
        transition: { default: tween(DURATION.slow), opacity: tween(DURATION.fast) },
    }), [scale]);

    /** The card once dropped on a target: as small as it was, fading where it landed. */
    const droppedLook = useMemo<TargetAndTransition>(() => ({ opacity: 0, scale, transition: tween(DURATION.fast) }), [scale]);
    const showsDropped = phase === 'dropped' || (phase === 'dragging' && aimed);
    /** What the card animates to: its usual look, or the dropped one (see above). */
    const animateTo = useCallback((usual: TargetAndTransition) => (showsDropped ? droppedLook : usual), [showsDropped, droppedLook]);

    return {
        origin, grab, start, aim, land, x, y, whileDrag, animate: animateTo,
        /** Above every other card: while dragged, going home, or fading where it was dropped. */
        raised: phase !== 'rest',
    };
}
