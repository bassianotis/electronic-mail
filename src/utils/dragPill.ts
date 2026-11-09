/**
 * The "New" drag (Appearance → Drag, the Instrument dark trial): while a card is dragged, a compact
 * pill with its subject is held at the pointer instead of the shrunken card. One element for the
 * whole app (components/DragPill.tsx renders it), moved directly, not through React state, so
 * following the pointer stays smooth.
 */
import type React from 'react';
import { animate } from 'framer-motion';
import { DURATION, tween } from './motion';

export const pillStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    maxWidth: '280px',
    padding: '8px 12px',
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-pill)',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
    color: 'var(--color-text-main)',
    fontFamily: 'var(--font-family)',
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: 1.3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
};

let pill: HTMLDivElement | null = null;
/** Where the pointer holds the pill: near its left end, halfway down. */
const HOLD_X = 14;

// Moved with a transform (the pill sits at the window's top left), never top/left
const at = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0)`;
const place = (p: { x: number; y: number }) => {
    if (!pill) return;
    pill.style.transform = at(p.x - HOLD_X, p.y - pill.offsetHeight / 2);
};

export const dragPill = {
    /** The layer's element (components/DragPill.tsx). */
    attach(el: HTMLDivElement | null) {
        pill = el;
    },
    show(subject: string, p: { x: number; y: number }) {
        if (!pill) return;
        pill.textContent = subject || 'No subject';
        pill.style.opacity = '1';
        pill.style.display = 'block';
        place(p);
    },
    move: place,
    rect(): DOMRect | null {
        return pill && pill.style.display !== 'none' ? pill.getBoundingClientRect() : null;
    },
    hide() {
        if (pill) pill.style.display = 'none';
    },
    /** Dropped on no target: the pill springs back to the card's slot, then goes. */
    async back(slot: DOMRect | null, reduced: boolean) {
        if (!pill) return;
        if (slot && !reduced) {
            await animate(pill, { transform: at(slot.left + 16, slot.top + 16) }, tween(DURATION.slow));
            await animate(pill, { opacity: 0 }, tween(DURATION.fast));
        }
        dragPill.hide();
    },
};
