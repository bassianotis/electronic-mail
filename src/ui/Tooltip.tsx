/**
 * Tooltip (components.md, rule L7): the control's name and its key, nothing else, never anything
 * you need. It appears after 500ms under the pointer, or at once on keyboard focus, and goes on
 * leaving, a press or Esc. It lives on the top layer (tooltip), drawn in a portal, so nothing clips it.
 * Wrap one control: <Tooltip content="Close settings"><button …/></Tooltip>.
 */
import React, { cloneElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const DELAY_MS = 500;
const GAP = 6;
const EDGE = 8;
// One pointer, one tooltip waiting at a time. Only the tooltip that's waiting can stop it: another
// one leaving the page (a message layer drawn again, say) must not cancel it.
let waiting: number | undefined;
let waiter: object | null = null;
function waitThen(owner: object, show: () => void) {
    window.clearTimeout(waiting);
    waiter = owner;
    waiting = window.setTimeout(() => { waiter = null; show(); }, DELAY_MS);
}
function stopWaiting(owner: object) {
    if (waiter !== owner) return;
    window.clearTimeout(waiting);
    waiter = null;
}

type Handlers = {
    'data-tooltip'?: string;
    onPointerEnter?: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerLeave?: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
};

export const Tooltip: React.FC<{
    content: React.ReactNode;
    /** Its key, if it has one ("Esc", "↑") */
    keys?: string;
    /** Above the control (it sits low on the screen); below by default, above when there's no room */
    placement?: 'above' | 'below';
    children: React.ReactElement<Handlers>;
}> = ({ content, keys, placement = 'below', children }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const tip = useRef<HTMLDivElement>(null);
    // This tooltip, as the owner of the one waiting timer
    const [me] = useState(() => ({}));

    const hide = () => { stopWaiting(me); setAnchor(null); };
    useEffect(() => () => stopWaiting(me), [me]);

    // Esc puts it away (and still reaches the layer underneath)
    useEffect(() => {
        if (!anchor) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAnchor(null); };
        const gone = () => setAnchor(null);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('scroll', gone, true);
        return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', gone, true); };
    }, [anchor]);

    // Under (or over) the control, centred on it, kept inside the window
    useLayoutEffect(() => {
        const el = tip.current;
        if (!anchor || !el) return;
        const at = anchor.getBoundingClientRect();
        const w = el.offsetWidth, h = el.offsetHeight;
        const below = placement === 'below' ? at.bottom + GAP + h <= window.innerHeight - EDGE : at.top - GAP - h < EDGE;
        const left = Math.min(Math.max(EDGE, at.left + at.width / 2 - w / 2), window.innerWidth - EDGE - w);
        el.style.left = `${left}px`;
        el.style.top = `${below ? at.bottom + GAP : at.top - GAP - h}px`;
        el.style.visibility = 'visible';
    }, [anchor, placement, content]);

    const own = children.props;
    const trigger = cloneElement(children, {
        // A mark that the control has its tooltip (the checks look for it; the words are its name)
        'data-tooltip': '',
        onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
            own.onPointerEnter?.(e);
            if (e.pointerType === 'touch') return;
            const el = e.currentTarget;
            waitThen(me, () => setAnchor(el));
        },
        onPointerLeave: (e: React.PointerEvent<HTMLElement>) => { own.onPointerLeave?.(e); hide(); },
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => { own.onPointerDown?.(e); hide(); },
        onFocus: (e: React.FocusEvent<HTMLElement>) => {
            own.onFocus?.(e);
            if (e.currentTarget.matches(':focus-visible')) setAnchor(e.currentTarget);
        },
        onBlur: (e: React.FocusEvent<HTMLElement>) => { own.onBlur?.(e); hide(); },
    });

    return (
        <>
            {trigger}
            {anchor && createPortal(
                <div ref={tip} className="ba-tooltip" aria-hidden="true" data-layer="tooltip" style={{ visibility: 'hidden' }}>
                    <span className="ba-tooltip__words">{content}</span>
                    {keys && <kbd>{keys}</kbd>}
                </div>,
                document.body,
            )}
        </>
    );
};
