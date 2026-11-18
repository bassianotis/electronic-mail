/**
 * Field (components.md, board C1-field): the label above, the field, and below it a hint or a
 * problem. It replaces Settings' .st-input / .st-label / .st-hint / .st-problem, the bucket
 * dialog's fields and the two password builds.
 * - field: 40 high (48 on sign-in), padding 0 12, radius 6, surface-1 with a 20% edge (28% under the
 *   pointer); focused, the edge turns text-3, no ring (K3); a danger edge with a problem; read-only on surface-2, no edge;
 *   disabled at 40%;
 * - kinds: text, password (Show / Hide inside), select (a chevron), mono (server names, ports), text area,
 *   and bare (phase 5): a writing surface (To, Cc, Bcc, Subject, the bodies, Search) with no box and no
 *   ring, only the caret (rule K3); its type and width are the surface's own;
 * - a problem replaces the hint, is tied to the field (the caller's aria-describedby, aria-invalid),
 *   and shows when you leave the field or press the button, never during first typing (rules A4, K8);
 * - while a server checks what was typed, the button says so and the fields stay editable
 *   (useServerCheck.ts).
 */
import React, { forwardRef, useState } from 'react';
import { ChevronDown, CircleAlert } from 'lucide-react';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

export const Field: React.FC<{
    label: React.ReactNode;
    htmlFor?: string;
    /** For a label that names a group (no single control): it's a span with this id */
    labelId?: string;
    /** Marked "(optional)"; required is the default (W7) */
    optional?: boolean;
    /** At the label's right, read out politely: "Saving…" / "Saved", a count */
    aside?: React.ReactNode;
    hint?: React.ReactNode;
    hintId?: string;
    problem?: React.ReactNode;
    problemId?: string;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}> = ({ label, htmlFor, labelId, optional, aside, hint, hintId, problem, problemId, className, style, children }) => {
    const words = <span>{label}{optional && <span className="ba-optional"> (optional)</span>}</span>;
    const right = aside !== undefined && <span className="ba-field__aside" aria-live="polite">{aside}</span>;
    return (
        <div className={cx('ba-field', className)} style={style}>
            {htmlFor
                ? <label className="ba-label" htmlFor={htmlFor}>{words}{right}</label>
                : <span className="ba-label" id={labelId}>{words}{right}</span>}
            {children}
            {problem ? <Problem id={problemId}>{problem}</Problem> : hint ? <Hint id={hintId}>{hint}</Hint> : null}
        </div>
    );
};

export const Hint: React.FC<{ id?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ id, style, children }) => (
    <p className="ba-hint" id={id} style={style}>{children}</p>
);

/** A problem: in danger, with an icon, in words; it says what to do (A4). */
export const Problem: React.FC<{ id?: string; children: React.ReactNode }> = ({ id, children }) => (
    <p className="ba-problem" id={id} role="alert">
        <CircleAlert size={14} aria-hidden="true" className="ba-problem__icon" />
        <span>{children}</span>
    </p>
);

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
    /** A problem shows on it (the danger edge; aria-invalid) */
    invalid?: boolean;
    /** Something typed exactly: server names, ports */
    mono?: boolean;
    /** 48 high, 16px: sign-in only */
    large?: boolean;
    /** A writing surface: no box, no ring, the caret only */
    bare?: boolean;
};

export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput({ invalid, mono, large, bare, className, ...rest }, ref) {
    return (
        <input {...rest} ref={ref} aria-invalid={invalid || rest['aria-invalid'] || undefined}
            className={cx('ba-input', mono && 'ba-input--mono', large && 'ba-input--lg', bare && 'ba-input--bare', className)} />
    );
});

/** A password: what's typed stays hidden until Show (a 24px text button inside the field). */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'mono'> & { wrapStyle?: React.CSSProperties; noun?: string }>(
    function PasswordInput({ invalid, large, className, wrapStyle, noun = 'password', ...rest }, ref) {
        const [shown, setShown] = useState(false);
        return (
            <div className="ba-input-wrap" style={wrapStyle}>
                <input {...rest} ref={ref} type={shown ? 'text' : 'password'} aria-invalid={invalid || undefined}
                    autoComplete={rest.autoComplete ?? 'off'} spellCheck={false}
                    className={cx('ba-input', 'ba-input--secret', large && 'ba-input--lg', className)} />
                <button type="button" className="ba-reveal" onClick={() => setShown(s => !s)} disabled={rest.disabled}
                    aria-label={shown ? `Hide the ${noun}` : `Show the ${noun}`}>
                    {shown ? 'Hide' : 'Show'}
                </button>
            </div>
        );
    },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; wrapStyle?: React.CSSProperties }>(
    function Select({ invalid, className, wrapStyle, children, ...rest }, ref) {
        return (
            <div className="ba-select-wrap" style={wrapStyle}>
                <select {...rest} ref={ref} aria-invalid={invalid || undefined} className={cx('ba-input', 'ba-select', className)}>{children}</select>
                <ChevronDown size={14} aria-hidden="true" className="ba-select__chevron" />
            </div>
        );
    },
);

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; bare?: boolean }>(
    function TextArea({ invalid, bare, className, ...rest }, ref) {
        return <textarea {...rest} ref={ref} aria-invalid={invalid || undefined} className={cx('ba-input', bare ? 'ba-input--bare' : 'ba-textarea', className)} />;
    },
);
