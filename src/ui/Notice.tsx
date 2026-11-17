/**
 * Notice (components.md, rules N1, N2, K8; board C1-menu-tooltip-notice-note-band): one at a time,
 * bottom centre, in a polite live region (role status). It stays 8s with an action (Undo, Open),
 * 4s without, and the time stops while it's hovered or focused. One waiting on a decision (no
 * time: `durationMs` null) stays until it's dealt with. A fixed `durationMs` is a deadline its
 * action stops working at (the send's hold, which the server keeps), so it doesn't stop.
 * A failure says what happened and what state things are in, with the danger icon.
 * Its action is a real button (small, secondary), reachable by Tab; × closes it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, CircleAlert, X } from 'lucide-react';
import { DURATION, leave, tween } from '../utils/motion';
import { Button, IconButton } from './Button';

const NOTICE_WITH_ACTION_MS = 8000;
const NOTICE_MS = 4000;

export const Notice: React.FC<{
    message: React.ReactNode;
    tone?: 'info' | 'error';
    actions?: { label: string; onClick: () => void }[];
    /** Undefined: 8s with an action, 4s without, stopped while hovered or focused. null: until dealt
     * with. A number: a fixed deadline, not stopped. */
    durationMs?: number | null;
    /** Its time ran out */
    onTimeout: () => void;
    /** Its action was pressed (index), or × (null) */
    onClose: (action: number | null) => void;
}> = ({ message, tone, actions, durationMs, onTimeout, onClose }) => {
    const fixed = typeof durationMs === 'number';
    const total = durationMs === null ? null : fixed ? durationMs : actions?.length ? NOTICE_WITH_ACTION_MS : NOTICE_MS;
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const paused = !fixed && (hovered || focused);
    const left = useRef(total ?? 0);
    const timeout = useRef(onTimeout);
    useEffect(() => { timeout.current = onTimeout; });

    // The time left runs only while it isn't hovered or focused (N2)
    useEffect(() => {
        if (total === null || paused) return;
        const started = Date.now();
        const t = window.setTimeout(() => timeout.current(), Math.max(0, left.current));
        return () => {
            window.clearTimeout(t);
            left.current -= Date.now() - started;
        };
    }, [total, paused]);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20, transition: leave() }}
            transition={tween(DURATION.mid)} // notices: 200ms (utils/motion.ts)
            className={`ba-notice${tone === 'error' ? ' ba-notice--failure' : ''}`}
            data-paused={paused || undefined}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
        >
            {tone === 'error'
                ? <CircleAlert size={16} aria-hidden="true" className="ba-notice__icon ba-notice__icon--failure" />
                : <CheckCircle size={16} aria-hidden="true" className="ba-notice__icon" />}
            <span className="ba-notice__words">{message}</span>
            {actions?.map((action, i) => (
                <Button key={action.label} size="sm" onClick={() => onClose(i)}>{action.label}</Button>
            ))}
            {(actions?.length || total === null) ? (
                <IconButton size={28} label="Dismiss" onClick={() => onClose(null)} icon={<X size={16} aria-hidden="true" />} />
            ) : null}
        </motion.div>
    );
};
