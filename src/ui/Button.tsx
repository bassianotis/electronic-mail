/**
 * Button (components.md, board C1-button): one button, four kinds, four sizes. It replaces the
 * product's many hand-built buttons.
 * - kinds: primary (one per surface), secondary, quiet, danger (only the destructive answer in a question);
 * - sizes: sm 28 (notices, the band), md 36 (the default), lg 40 (Send, the reading bar), xl 48 (sign-in);
 * - working (rule A6): a button that starts server work shows its progress word ("Checking…") at full
 *   strength and can't be pressed again until the work is done (`aria-busy`). Either say so with
 *   `working`, or give `progress` and an onClick that returns a promise.
 */
import React, { forwardRef, useRef, useState } from 'react';
import { Tooltip } from './Tooltip';

export type ButtonKind = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
    kind?: ButtonKind;
    size?: ButtonSize;
    /** 16px, 8px before the label */
    icon?: React.ReactNode;
    /** After the label (Send keeps its trailing icon) */
    trailingIcon?: React.ReactNode;
    /** The progress word while its server work runs; a press does nothing meanwhile (A6). */
    working?: string | false | null;
    /** With an onClick that returns a promise: the progress word until it settles (A6). */
    progress?: string;
    /** Quiet only: the words in danger ("Remove…", which opens the question). */
    dangerText?: boolean;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => unknown;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { kind = 'secondary', size = 'md', icon, trailingIcon, working, progress, dangerText, className, children, onClick, type = 'button', ...rest },
    ref,
) {
    const [running, setRunning] = useState(false);
    // Set at once on a press, so a second press in the same moment never starts the work twice
    const pending = useRef(false);
    const word = working || (running ? progress : null);
    const busy = !!word;
    const classes = ['ba-button', `ba-button--${kind}`, size !== 'md' && `ba-button--${size}`, dangerText && 'ba-button--danger-text', className]
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
            {trailingIcon}
        </button>
    );
});

/**
 * Icon-only: square (28, 32 or 36), quiet unless said otherwise. Its name is in words (`label`),
 * and the same words show as its tooltip (with its key, if it has one).
 */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'icon' | 'children' | 'size'> & {
    label: string;
    icon: React.ReactNode;
    size?: 28 | 32 | 36;
    keys?: string;
}>(function IconButton({ label, icon, size = 32, kind = 'quiet', keys, className, ...rest }, ref) {
    return (
        <Tooltip content={label} keys={keys}>
            <Button {...rest} ref={ref} kind={kind} aria-label={rest['aria-label'] ?? label}
                className={['ba-button--icon', `ba-size-${size}`, className].filter(Boolean).join(' ')}>
                {icon}
            </Button>
        </Tooltip>
    );
});

/** Two buttons as one group with a divider (older / newer). */
export const ButtonPair: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
    <div role="group" aria-label={label} className={['ba-pair', className].filter(Boolean).join(' ')}>{children}</div>
);
