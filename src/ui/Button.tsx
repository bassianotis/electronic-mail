/**
 * Button (components.md, boards C1-button and P5-buttons-sorted): one button for the whole product.
 * - kinds: primary (one per surface), secondary, quiet, danger (only the destructive answer in a question),
 *   and since phase 5: text (words with no box, text-3, text-1 under the pointer: Cc, View thread),
 *   link (13px words that go somewhere, underlined under the pointer, never amber: "Replying to …"),
 *   picker (quiet with a trailing chevron, showing the current choice: From, the reply type; `twoLine`
 *   for Settings' account switcher) and danger-text (secondary with red words, for an entry that leads
 *   to a question: Remove…);
 * - sizes: sm 28 (notices, the band), md 36 (the default), lg 40 (Send, the reading bar), xl 48 (sign-in);
 *   the text kind is 14px, or 12 with size sm;
 * - working (rule A6): a button that starts server work shows its progress word ("Checking…") at full
 *   strength and can't be pressed again until the work is done (`aria-busy`). Either say so with
 *   `working`, or give `progress` and an onClick that returns a promise.
 */
import React, { forwardRef, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip } from './Tooltip';

export type ButtonKind = 'primary' | 'secondary' | 'quiet' | 'danger' | 'text' | 'link' | 'picker' | 'danger-text';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
    kind?: ButtonKind;
    size?: ButtonSize;
    /** 16px, 8px before the label (14px in the text and link kinds) */
    icon?: React.ReactNode;
    /** After the label (Send keeps its trailing icon); a picker's is its chevron */
    trailingIcon?: React.ReactNode;
    /** Picker only: two lines (Settings' account switcher: the name, the address under it) */
    twoLine?: boolean;
    /** The progress word while its server work runs; a press does nothing meanwhile (A6). */
    working?: string | false | null;
    /** With an onClick that returns a promise: the progress word until it settles (A6). */
    progress?: string;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => unknown;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { kind = 'secondary', size = 'md', icon, trailingIcon, twoLine, working, progress, className, children, onClick, type = 'button', ...rest },
    ref,
) {
    const [running, setRunning] = useState(false);
    // Set at once on a press, so a second press in the same moment never starts the work twice
    const pending = useRef(false);
    const word = working || (running ? progress : null);
    const busy = !!word;
    const classes = ['ba-button', `ba-button--${kind}`, size !== 'md' && `ba-button--${size}`, twoLine && 'ba-button--two-line', className]
        .filter(Boolean).join(' ');

    const press = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (busy || pending.current) { e.preventDefault(); return; }
        const result = onClick?.(e);
        if (progress && result && typeof (result as Promise<unknown>).then === 'function') {
            pending.current = true;
            setRunning(true);
            void (result as Promise<unknown>).catch(() => { /* the caller shows the problem */ }).finally(() => {
                pending.current = false;
                setRunning(false);
            });
        }
    };

    return (
        <button {...rest} ref={ref} type={type} className={classes} aria-busy={busy || undefined} onClick={press}>
            {icon}
            {busy ? word : children}
            {trailingIcon ?? (kind === 'picker' && <ChevronDown size={14} aria-hidden="true" className="ba-button__chevron" />)}
        </button>
    );
});

/**
 * Icon-only: always square, radius 6: 32 (the product's main size) or 28 (notices, the band); quiet
 * unless said otherwise. Its name is in words (`label`), and the same words show as its tooltip (with
 * its key, if it has one); `tip` when the tooltip says more (the pill's next thread's subject).
 */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'icon' | 'children' | 'size' | 'twoLine'> & {
    label: string;
    icon: React.ReactNode;
    size?: 28 | 32;
    keys?: string;
    tip?: React.ReactNode;
    tipPlacement?: 'above' | 'below';
}>(function IconButton({ label, icon, size = 32, kind = 'quiet', keys, tip, tipPlacement, className, ...rest }, ref) {
    return (
        <Tooltip content={tip ?? label} keys={keys} placement={tipPlacement}>
            <Button {...rest} ref={ref} kind={kind} aria-label={rest['aria-label'] ?? label}
                className={['ba-button--icon', `ba-size-${size}`, className].filter(Boolean).join(' ')}>
                {icon}
            </Button>
        </Tooltip>
    );
});

/** Two icon buttons as one group with a divider (older / newer), 32 high. */
export const ButtonPair: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
    <div role="group" aria-label={label} className={['ba-pair', className].filter(Boolean).join(' ')}>{children}</div>
);
