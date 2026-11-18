/**
 * Dialog, steps and questions (components.md, board C1-dialog): one build for every dialog.
 * - over the one scrim, at the dialog layer; never taller than the window minus 64 (the body
 *   scrolls; the header and the actions stay put);
 * - header: the title (18/24, 500) and a quiet 32px close at the top right;
 * - padding 24; actions at the bottom right, secondary then primary;
 * - modal (rules L3, L4): focus moves to the first field (a question's Cancel), Tab stays inside,
 *   the page behind is inert, Esc closes it, and focus returns to whatever opened it;
 * - the scrim closes it only when nothing typed would be lost: with `dirty`, a click outside does
 *   nothing, and it never saves.
 * Sizes: small 400 (the default), Settings 880 (its own class), reading (the reading width, 1000: a new
 * message) and alert (phase 5: the critical layer over everything, no close, nothing behind it can be
 * clicked, Esc does nothing, one action: signed out).
 * Mount it inside an AnimatePresence: it fades and scales in, and out again (`still`: it appears and
 * goes at once).
 * A second step replaces the content in place, with Back at the top left (never a dialog on a
 * dialog). An irreversible action asks a Question inside the surface.
 */
import React, { forwardRef, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, X } from 'lucide-react';
import { DURATION, leave, tween } from '../utils/motion';
import { useEscape, useModal } from '../utils/layers';
import { Button, IconButton } from './Button';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
const FIELDS = '.ba-dialog__body input:not([type="hidden"]):not([disabled]), .ba-dialog__body select:not([disabled]), .ba-dialog__body textarea:not([disabled])';

type DialogProps = {
    title: React.ReactNode;
    /** Esc, the close button, and the scrim while nothing is `dirty` */
    onClose: () => void;
    /** Something typed or changed that a click outside would lose: then a click outside does nothing */
    dirty?: boolean;
    /** 400 (the default), or the dialog's own width */
    width?: number | string;
    /** reading: the reading width (a new message); alert: over everything, no close, one action */
    size?: 'reading' | 'alert';
    /** Named in words rather than by its title (a dialog that lays itself out without one) */
    label?: string;
    /** The alert: its words (aria-describedby) and what shows under its action */
    icon?: React.ReactNode;
    after?: React.ReactNode;
    /** Appears and goes at once, with no fade */
    still?: boolean;
    /** The layer's own place (a new message starts under the server band) */
    layerStyle?: React.CSSProperties;
    closeLabel?: string;
    /** Body and actions inside one form (Enter submits) */
    onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
    actions?: React.ReactNode;
    /** The dialog lays itself out (Settings): no header, body or actions of its own; it names `titleId` */
    bare?: boolean;
    titleId?: string;
    /** Where the focus goes on opening, if not the first field */
    initialFocus?: () => HTMLElement | null | undefined;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
};

/** The ref is the dialog's own box (Settings places the notices by it). */
export const Dialog = forwardRef<HTMLDivElement, DialogProps>(function Dialog(
    { title, onClose, dirty = false, width, size, label, icon, after, still, layerStyle, closeLabel = 'Close', onSubmit, actions, bare, titleId, initialFocus, className, style, children },
    ref,
) {
    const ownId = useId();
    const labelId = titleId ?? `${ownId}-title`;
    const alert = size === 'alert';
    const layer = useRef<HTMLDivElement>(null);
    const box = useRef<HTMLDivElement | null>(null);
    const setBox = (el: HTMLDivElement | null) => {
        box.current = el;
        if (typeof ref === 'function') ref(el); else if (ref) ref.current = el;
    };
    // The first field; a dialog that lays itself out starts on itself; an alert on its one action.
    // An alert keeps nothing else usable, not even the notices.
    useModal(layer, true, {
        keep: alert ? '[data-layer="tooltip"]' : undefined,
        initial: () => initialFocus?.() ?? box.current?.querySelector<HTMLElement>(alert ? '.ba-dialog__actions button' : FIELDS) ?? (bare ? box.current : undefined),
    });
    useEscape(!alert, 'dialog', onClose);
    // An alert can't be put away: Esc does nothing, and nothing beneath it hears the key
    useEffect(() => {
        if (!alert) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [alert]);

    const inner = bare ? children : alert ? (
        <>
            {icon}
            <h2 className="ba-dialog__title" id={labelId}>{title}</h2>
            <p className="ba-dialog__words" id={`${ownId}-words`}>{children}</p>
            <div className="ba-dialog__actions">{actions}</div>
            {after && <span className="ba-dialog__after">{after}</span>}
        </>
    ) : (
        <>
            <div className="ba-dialog__head">
                <h2 className="ba-dialog__title" id={labelId}>{title}</h2>
                <IconButton label={closeLabel} onClick={onClose} icon={<X size={16} aria-hidden="true" />} />
            </div>
            <div className="ba-dialog__body">{children}</div>
            {actions && <div className="ba-dialog__actions">{actions}</div>}
        </>
    );

    return createPortal(
        <div ref={layer} className={cx('ba-layer', alert && 'ba-layer--critical')} data-layer={alert ? 'critical' : 'dialog'} style={layerStyle}>
            <motion.div className="ba-scrim" onClick={() => { if (!dirty && !alert) onClose(); }}
                initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: leave() }} transition={tween(DURATION.mid)} />
            <motion.div ref={setBox} role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" tabIndex={-1}
                aria-label={label} aria-labelledby={label ? undefined : labelId} aria-describedby={alert ? `${ownId}-words` : undefined}
                className={cx('ba-dialog', size && `ba-dialog--${size}`, className)} style={{ ...(width !== undefined ? { width } : null), ...style }}
                initial={still ? false : { opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98, transition: leave() }} transition={tween(DURATION.mid)}>
                {onSubmit && !bare ? <form className="ba-dialog__form" onSubmit={onSubmit} noValidate>{inner}</form> : inner}
            </motion.div>
        </div>,
        document.body,
    );
});

/** A second step's way back, at the top left: "‹ Accounts" (named after where it goes). */
export const Back: React.FC<{ to: string; onClick: () => void }> = ({ to, onClick }) => (
    <button type="button" className="ba-back" onClick={onClick}>
        <ChevronLeft size={14} aria-hidden="true" />{to}
    </button>
);

/**
 * An irreversible action asks in place (rule A2): what will be lost, Cancel and the action named
 * after itself, left-aligned under the words, no default button. Cancel takes the focus, and Esc
 * means Cancel while the focus is in it. `inRow`: asked inside a list's row, as Settings' Accounts has it.
 */
export const Question: React.FC<{
    title: React.ReactNode;
    onCancel: () => void;
    /** The action, named for what it does ("Remove account"); a danger Button */
    action: React.ReactNode;
    /** While the action runs */
    busy?: boolean;
    inRow?: boolean;
    after?: React.ReactNode;
    /** Cancel takes the focus as the question opens (the default) */
    focusCancel?: boolean;
    children: React.ReactNode;
}> = ({ title, onCancel, action, busy, inRow, after, focusCancel = true, children }) => {
    const id = useId();
    const self = useRef<HTMLDivElement>(null);
    // Esc means Cancel while the focus is in the question (it starts on Cancel)
    useEscape(true, 'dialog', () => { if (!busy) onCancel(); }, { step: 1, within: self });
    return (
        <div ref={self} className={cx('ba-question', inRow && 'ba-question--row')} role="group" aria-labelledby={`${id}-q`}>
            <b className="ba-question__title" id={`${id}-q`}>{title}</b>
            <span className="ba-question__words">{children}</span>
            <div className="ba-question__actions">
                <Button onClick={onCancel} disabled={busy} autoFocus={focusCancel}>Cancel</Button>
                {action}
            </div>
            {after}
        </div>
    );
};
