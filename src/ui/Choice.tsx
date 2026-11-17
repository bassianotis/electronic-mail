/**
 * Checkbox, radio, switch and segmented (components.md, board C1-checkbox-radio-switch-segmented):
 * four ways to choose, each with one job, drawn in greys (amber is for actions, rule V1).
 * - Checkbox: independent options, or a yes / no inside a form with Save. Space toggles.
 * - Radio: one of up to five options that need words, stacked. One Tab stop; arrows choose.
 * - Switch: a setting that takes effect at once; never inside a form with Save. Space toggles.
 * - Segmented: one of 2–4 short options that switch a view or mode. A radio group: one Tab stop, arrows move.
 * Marks are 16px inside a target of 24px or more, and the label is part of the target.
 */
import React, { forwardRef, useEffect, useRef } from 'react';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    label: React.ReactNode;
    hint?: React.ReactNode;
    /** "Some": part of a group is on */
    indeterminate?: boolean;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, hint, indeterminate, className, style, ...rest }, ref) {
    const own = useRef<HTMLInputElement | null>(null);
    useEffect(() => { if (own.current) own.current.indeterminate = !!indeterminate; }, [indeterminate]);
    const setRef = (el: HTMLInputElement | null) => {
        own.current = el;
        if (typeof ref === 'function') ref(el); else if (ref) ref.current = el;
    };
    return (
        <div className={cx('ba-choice-wrap', rest.disabled && 'is-disabled', className)} style={style}>
            <label className="ba-choice">
                <input {...rest} ref={setRef} type="checkbox" className="ba-check" />
                <span className="ba-choice__label">{label}</span>
            </label>
            {hint && <p className="ba-choice__hint">{hint}</p>}
        </div>
    );
});

/** Radio buttons, stacked: native radios (one Tab stop, the arrows choose), drawn as the board has them. */
export function RadioGroup<T extends string>({ name, value, onChange, options, label, labelledBy, disabled, style }: {
    name: string;
    value: T;
    onChange: (value: T) => void;
    options: { value: T; label: React.ReactNode; hint?: React.ReactNode }[];
    /** Its name, if no visible label names it (`labelledBy`) */
    label?: string;
    labelledBy?: string;
    disabled?: boolean;
    style?: React.CSSProperties;
}) {
    return (
        <div role="radiogroup" aria-label={label} aria-labelledby={labelledBy} className="ba-radios" style={style}>
            {options.map(o => (
                <div key={o.value} className={cx('ba-choice-wrap', disabled && 'is-disabled')}>
                    <label className="ba-choice">
                        <input type="radio" className="ba-radio" name={name} value={o.value} checked={value === o.value} disabled={disabled}
                            onChange={() => onChange(o.value)} />
                        <span className="ba-choice__label">{o.label}</span>
                    </label>
                    {o.hint && <p className="ba-choice__hint">{o.hint}</p>}
                </div>
            ))}
        </div>
    );
}

/** A switch: on or off at once (role switch; Space toggles). */
export const Switch: React.FC<{
    checked: boolean;
    onChange: (on: boolean) => void;
    label: React.ReactNode;
    disabled?: boolean;
    id?: string;
}> = ({ checked, onChange, label, disabled, id }) => (
    <label className={cx('ba-choice', disabled && 'is-disabled')}>
        <button type="button" id={id} role="switch" aria-checked={checked} className="ba-switch" disabled={disabled}
            onClick={() => onChange(!checked)} />
        <span className="ba-choice__label">{label}</span>
    </label>
);

/** Segmented: one Tab stop (the chosen part); the arrows, Home and End move and choose. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: {
    value: T;
    onChange: (value: T) => void;
    options: { value: T; label: React.ReactNode; name?: string }[];
    label: string;
    className?: string;
}) {
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const at = options.findIndex(o => o.value === value);
        const last = options.length - 1;
        const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? Math.min(last, at + 1)
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, at - 1)
            : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
        if (to < 0) return;
        e.preventDefault();
        e.stopPropagation(); // not the page's own arrow keys
        onChange(options[to].value);
        (e.currentTarget.children[to] as HTMLElement | undefined)?.focus();
    };
    return (
        <div role="radiogroup" aria-label={label} className={cx('ba-segmented', className)} onKeyDown={onKeyDown}>
            {options.map(o => (
                <button key={o.value} type="button" role="radio" aria-checked={value === o.value} aria-label={o.name}
                    tabIndex={value === o.value ? 0 : -1} onClick={() => onChange(o.value)}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}
