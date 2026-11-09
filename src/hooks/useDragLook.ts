/**
 * How a dragged card looks and lands (the Instrument dark trial; light is unchanged).
 * - Dark: the card shrinks around the point where it was grabbed, so it stays under the pointer,
 *   and keeps 85% opacity over every target.
 * - Dark with Appearance → Drag: New: the card becomes a compact pill with its subject, held at the
 *   pointer. Dropped on a target, the pill flies into it (AnimationContext), the target flashes and
 *   its count ticks up, and only then does the move happen (the list closes the gap). Dropped
 *   elsewhere, the pill springs back to the card's slot. Reduced motion skips the flights.
 */
import { useCallback, useRef, useState, createElement, type RefObject } from 'react';
import { useReducedMotion, type TargetAndTransition } from 'framer-motion';
import { useAnimation } from '../context/AnimationContext';
import { useDragDropActions } from '../context/DragDropContext';
import { useDragStyle, useTheme } from '../utils/theme';
import { PillFace } from '../components/DragPill';
import { dragPill } from '../utils/dragPill';

/** A drop target's element id (as utils/dropTargets.ts finds them). */
const targetElement = (target: string) => (target === 'archive' ? 'archive-target' : target === 'inbox' ? 'inbox-target' : `bucket-target-${target}`);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export function useDragLook(subject: string, card: RefObject<HTMLElement | null>) {
    const dark = useTheme() === 'dark';
    const style = useDragStyle();
    const pill = dark && style === 'new';
    const reduced = !!useReducedMotion();
    const { triggerTransfer } = useAnimation();
    const { land: flash } = useDragDropActions();
    const [origin, setOrigin] = useState<string | undefined>(undefined);
    const [hidden, setHidden] = useState(false);
    const slot = useRef<DOMRect | null>(null);

    /** Pointer down (before the drag starts): where the card was grabbed. */
    const grab = useCallback((e: { clientX: number; clientY: number }) => {
        const r = card.current?.getBoundingClientRect();
        if (!r) return;
        slot.current = r;
        if (dark) setOrigin(`${e.clientX - r.left}px ${e.clientY - r.top}px`);
    }, [card, dark]);

    /** The card while dragged: as before in light; in dark at 85%; with the pill, out of sight. */
    const whileDrag = useCallback((base: TargetAndTransition): TargetAndTransition => (
        pill ? { ...base, scale: 1, opacity: 0, boxShadow: 'none' } : dark ? { ...base, opacity: 0.85 } : base
    ), [pill, dark]);

    const start = useCallback((point: { x: number; y: number }) => {
        if (!pill) return;
        dragPill.show(subject, point);
        // Out of sight from the start, so it never shows while snapping back under the pill
        setHidden(true);
    }, [pill, subject]);

    const move = useCallback((point: { x: number; y: number }) => {
        if (pill) dragPill.move(point);
    }, [pill]);

    /** The drag ended over `target` (or none): commit makes the move. */
    const land = useCallback(async (target: string | null, commit: () => void) => {
        if (!pill) {
            if (target) commit();
            return;
        }
        if (!target) {
            await dragPill.back(slot.current, reduced);
            setHidden(false);
            return;
        }
        const from = dragPill.rect();
        dragPill.hide();
        if (from && !reduced) await triggerTransfer(from, targetElement(target), createElement(PillFace, { subject }));
        flash(target);
        await wait(reduced ? 0 : 180); // the count ticks up first
        commit();
        // Still here (the move was refused): show the card again.
        setTimeout(() => setHidden(false), 1500);
    }, [pill, reduced, triggerTransfer, flash, subject]);

    return { dark, pill, origin, hidden, grab, whileDrag, start, move, land };
}
