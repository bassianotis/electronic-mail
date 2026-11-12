/**
 * The pieces every Settings section uses (settings-spec.md §2): one way to save (as you go, with a
 * quiet "Saved"), one way to show a problem (under the field, in words, the field keeping what was
 * typed), and one way to load (skeleton fields; "Couldn't load these settings" with Try again).
 */
import React, { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AfterDelay, Bone } from '../Loading/Skeletons';
import type { SaveState } from './useSettings';

/** A field: its label (with "Saving…" / "Saved" at the right), the control, a hint and a problem. */
export const Field: React.FC<{
    label: React.ReactNode;
    htmlFor?: string;
    saved?: SaveState;
    /** Beside "Saved", e.g. a character count. */
    aside?: React.ReactNode;
    hint?: React.ReactNode;
    hintId?: string;
    problem?: string | null;
    problemId?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}> = ({ label, htmlFor, saved = 'idle', aside, hint, hintId, problem, problemId, style, children }) => (
    <div style={style}>
        <label className="st-label" htmlFor={htmlFor}>
            {label}
            <span className="st-saved" aria-live="polite">
                {aside}{aside && saved !== 'idle' ? ' · ' : ''}{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}
            </span>
        </label>
        {children}
        {problem && <Problem id={problemId}>{problem}</Problem>}
        {hint && <p className="st-hint" id={hintId}>{hint}</p>}
    </div>
);

export const Problem: React.FC<{ id?: string; children: React.ReactNode }> = ({ id, children }) => (
    <p className="st-problem" id={id} role="alert">{children}</p>
);

/** A password field, empty with the "Saved" placeholder, and Show / Hide. */
export const SecretInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; wide?: boolean }> = ({ invalid, wide, ...props }) => {
    const [shown, setShown] = useState(false);
    return (
        <div className="st-secret" style={wide ? { maxWidth: 'none' } : undefined}>
            <input
                {...props}
                type={shown ? 'text' : 'password'}
                className="st-input"
                aria-invalid={invalid || undefined}
                autoComplete="off"
                spellCheck={false}
            />
            <button type="button" className="st-text st-reveal" onClick={() => setShown(s => !s)} disabled={props.disabled} aria-label={shown ? 'Hide the password' : 'Show the password'}>
                {shown ? 'Hide' : 'Show'}
            </button>
        </div>
    );
};

export const Spinner: React.FC<{ size?: number }> = ({ size = 15 }) => (
    <LoaderCircle size={size} className="st-spin" aria-hidden="true" />
);

/** Skeleton fields while a section's settings load (after the usual 250ms). */
export const FieldsSkeleton: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
    <AfterDelay>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }} aria-hidden="true">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Bone w={i === 2 ? 72 : 96} h={12} />
                    <Bone w={i === 1 ? 260 : '100%'} h={i === 2 ? 96 : 40} r="6px" />
                </div>
            ))}
        </div>
    </AfterDelay>
);

/** Settings that couldn't load: no fields (so nothing blank can be saved over them), and Try again. */
export const LoadFailed: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div className="st-box" role="alert">
        <span style={{ flex: 1 }}>Couldn't load these settings</span>
        <button type="button" className="st-btn" onClick={onRetry}>Try again</button>
    </div>
);

/** One server being typed in: the port stays text until it's checked. */
export interface ServerDraft { host: string; port: string; secure: boolean }

const USUAL_PORTS = { imap: { secure: '993', starttls: '143' }, smtp: { secure: '465', starttls: '587' } };

/**
 * Server / Port / Security on one row. Security is a choice, and changing it sets the usual port
 * (993 / 143 for receiving, 465 / 587 for sending). `compact` uses the short choice names.
 */
export const ServerRow: React.FC<{
    kind: 'imap' | 'smtp';
    id: string;
    value: ServerDraft;
    onChange: (next: ServerDraft) => void;
    disabled?: boolean;
    problem?: string | null;
    compact?: boolean;
}> = ({ kind, id, value, onChange, disabled, problem, compact }) => {
    const ports = USUAL_PORTS[kind];
    return (
        <div>
            <div className="st-servers">
                <div>
                    <label className="st-label" htmlFor={`${id}-host`}>{kind === 'imap' ? 'Receiving server' : 'Sending server'}</label>
                    <input id={`${id}-host`} className="st-input" value={value.host} disabled={disabled} spellCheck={false} autoComplete="off"
                        aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${id}-problem` : undefined}
                        onChange={e => onChange({ ...value, host: e.target.value })} />
                </div>
                <div>
                    <label className="st-label" htmlFor={`${id}-port`}>Port</label>
                    <input id={`${id}-port`} className="st-input" value={value.port} disabled={disabled} inputMode="numeric" autoComplete="off"
                        onChange={e => onChange({ ...value, port: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) })} />
                </div>
                <div>
                    <label className="st-label" htmlFor={`${id}-security`}>Security</label>
                    <select id={`${id}-security`} className="st-input" value={value.secure ? 'ssl' : 'starttls'} disabled={disabled}
                        onChange={e => {
                            const secure = e.target.value === 'ssl';
                            onChange({ ...value, secure, port: secure ? ports.secure : ports.starttls });
                        }}>
                        <option value="ssl">{compact ? 'SSL/TLS' : `SSL/TLS (usually ${ports.secure})`}</option>
                        <option value="starttls">{compact ? 'STARTTLS' : `STARTTLS (usually ${ports.starttls})`}</option>
                    </select>
                </div>
            </div>
            {problem && <Problem id={`${id}-problem`}>{problem}</Problem>}
        </div>
    );
};
