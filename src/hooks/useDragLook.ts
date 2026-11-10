/**
 * How a dragged card looks and lands: it shrinks around the point where it was grabbed, so it stays
 * under the pointer, and keeps 85% opacity over every target. Dropped on a target, the move happens.
 */
import { useCallback, useState, type RefObject } from 'react';
import type { TargetAndTransition } from 'framer-motion';

export function useDragLook(card: RefObject<HTMLElement | null>) {
    const [origin, setOrigin] = useState<string | undefined>(undefined);

    /** Pointer down (before the drag starts): where the card was grabbed. */
    const grab = useCallback((e: { clientX: number; clientY: number }) => {
        const r = card.current?.getBoundingClientRect();
        if (r) setOrigin(`${e.clientX - r.left}px ${e.clientY - r.top}px`);
    }, [card]);

    /** The card while dragged: as given, at 85%. */
    const whileDrag = useCallback((base: TargetAndTransition): TargetAndTransition => ({ ...base, opacity: 0.85 }), []);

    /** The drag ended over `target` (or none): commit makes the move. */
    const land = useCallback((target: string | null, commit: () => void) => {
        if (target) commit();
    }, []);

    return { origin, grab, whileDrag, land };
}
