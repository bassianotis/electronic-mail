/**
 * The pieces every Settings section uses (settings-spec.md §2): one way to save (as you go, with a
 * quiet "Saved"), one way to show a problem (under the field, in words, the field keeping what was
 * typed), and one way to load (skeleton fields; "Couldn't load these settings" with Try again).
 */
import React from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { AfterDelay, Bone } from '../Loading/Skeletons';
import { Button } from '../../ui/Button';
import { Note } from '../../ui/Note';
import { Field as UiField, PasswordInput, Problem, Select, TextInput } from '../../ui/Field';
import type { SaveState } from './useSettings';

/** A field (the shared Field): its label (a character count at the right, if any), the control, and
 * a hint, or the problem in its place. A section that saves as you go says "Saved" once, under its
 * fields (SavedLine; board P5, change 1). */
export const Field: React.FC<{
    label: React.ReactNode;
    htmlFor?: string;
    /** At the label's right, e.g. a character count. */
    aside?: React.ReactNode;
    hint?: React.ReactNode;
    hintId?: string;
    problem?: string | null;
    problemId?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}> = ({ aside, ...field }) => <UiField {...field} aside={aside} />;

/**
 * The section's quiet "Saving…" / "✓ Saved" under its fields (board P5, change 1; rule A3), in a
 * polite live region that's always there, its line kept so nothing below moves when it speaks.
 */
export const SavedLine: React.FC<{ state: SaveState; style?: React.CSSProperties }> = ({ state, style }) => (
    <p className="st-saved-line" aria-live="polite" style={style}>
        {state === 'saving' ? 'Saving…' : state === 'saved' ? <><Check size={14} aria-hidden="true" />Saved</> : null}
    </p>
);

/** A password field, empty with the "Saved" placeholder, and Show / Hide (the shared PasswordInput). */
export const SecretInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; wide?: boolean }> = ({ wide, ...props }) => (
    <PasswordInput {...props} wrapStyle={wide ? { maxWidth: 'none' } : undefined} />
);

export { Problem };

export const Spinner: React.FC<{ size?: number }> = ({ size = 15 }) => (
    <LoaderCircle size={size} className="st-spin" aria-hidden="true" />
);

/** Skeleton fields while a section's settings load (after the usual 300ms). */
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
    <Note tone="problem" role="alert" action={<Button onClick={onRetry}>Try again</Button>}>Couldn't load these settings</Note>
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
                <UiField label={kind === 'imap' ? 'Receiving server' : 'Sending server'} htmlFor={`${id}-host`}>
                    <TextInput id={`${id}-host`} mono value={value.host} disabled={disabled} spellCheck={false} autoComplete="off"
                        invalid={!!problem} aria-describedby={problem ? `${id}-problem` : undefined}
                        onChange={e => onChange({ ...value, host: e.target.value })} />
                </UiField>
                <UiField label="Port" htmlFor={`${id}-port`}>
                    <TextInput id={`${id}-port`} mono value={value.port} disabled={disabled} inputMode="numeric" autoComplete="off"
                        onChange={e => onChange({ ...value, port: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) })} />
                </UiField>
                <UiField label="Security" htmlFor={`${id}-security`}>
                    <Select id={`${id}-security`} value={value.secure ? 'ssl' : 'starttls'} disabled={disabled}
                        onChange={e => {
                            const secure = e.target.value === 'ssl';
                            onChange({ ...value, secure, port: secure ? ports.secure : ports.starttls });
                        }}>
                        <option value="ssl">{compact ? 'SSL/TLS' : `SSL/TLS (usually ${ports.secure})`}</option>
                        <option value="starttls">{compact ? 'STARTTLS' : `STARTTLS (usually ${ports.starttls})`}</option>
                    </Select>
                </UiField>
            </div>
            {problem && <Problem id={`${id}-problem`}>{problem}</Problem>}
        </div>
    );
};
