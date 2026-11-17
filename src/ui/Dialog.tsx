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
 * Mount it inside an AnimatePresence: it fades and scales in, and out again.
 * A second step replaces the content in place, with Back at the top left (never a dialog on a
 * dialog). An irreversible action asks a Question inside the surface.
 */
import React, { forwardRef, useId, useRef } from 'react';
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
    { title, onClose, dirty = false, width, closeLabel = 'Close', onSubmit, actions, bare, titleId, initialFocus, className, style, children },
    ref,
) {
    const ownId = useId();
    const labelId = titleId ?? `${ownId}-title`;
    const layer = useRef<HTMLDivElement>(null);
    const box = useRef<HTMLDivElement | null>(null);
    const setBox = (el: HTMLDivElement | null) => {
        box.current = el;
        if (typeof ref === 'function') ref(el); else if (ref) ref.current = el;
    };
    // The first field; a dialog that lays itself out starts on itself
    useModal(layer, true, { initial: () => initialFocus?.() ?? box.current?.querySelector<HTMLElement>(FIELDS) ?? (bare ? box.current : undefined) });
    useEscape(true, 'dialog', onClose);

    const inner = bare ? children : (
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
        <div ref={layer} className="ba-layer" data-layer="dialog">
            <motion.div className="ba-scrim" onClick={() => { if (!dirty) onClose(); }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: leave() }} transition={tween(DURATION.mid)} />
            <motion.div ref={setBox} role="dialog" aria-modal="true" aria-labelledby={labelId} tabIndex={-1}
                className={cx('ba-dialog', className)} style={{ ...(width !== undefined ? { width } : null), ...style }}
                initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98, transition: leave() }} transition={tween(DURATION.mid)}>
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
