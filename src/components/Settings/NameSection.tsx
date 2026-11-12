/**
 * Name and signature (settings-spec.md §3): each field saves on its own as you go. Your name never
 * tests the sending server any more (it used to be saved with it, so a slow server blocked it).
 */
import React, { useEffect, useRef, useState } from 'react';
import { api, acct } from '../../api/client';
import type { Account, AccountSettings } from '../../api/types';
import { useMail } from '../../context/MailContext';
import { Field, FieldsSkeleton, LoadFailed } from './parts';
import { TYPING_PAUSE_MS, useSaving, useSectionData } from './useSettings';

/** The engine's limits (engine/src/app/accounts.ts). */
const TAB_NAME_MAX = 12;
const SIGNATURE_MAX = 2000;

export const NameSection: React.FC<{ account: Account }> = ({ account }) => {
    const { data, failed, retry } = useSectionData(
        () => api.get<{ settings: AccountSettings }>(`${acct(account.id)}/settings`).then(r => r.settings),
        account.id,
    );
    if (failed) return <LoadFailed onRetry={retry} />;
    if (!data) return <FieldsSkeleton />;
    return <NameFields key={account.id} account={account} settings={data} />;
};

const NameFields: React.FC<{ account: Account; settings: AccountSettings }> = ({ account, settings }) => {
    const { fetchAccounts } = useMail();
    const patch = async (body: Record<string, unknown>) => {
        await api.patch(acct(account.id), body);
        await fetchAccounts(); // the rail's tab, the composer's name and signature
    };
    return (
        <>
            <AutoField
                id="st-name"
                label="Your name"
                hint="On mail you send from this account"
                initial={settings.displayName ?? ''}
                same={(a, b) => a.trim() === b.trim()}
                save={v => patch({ displayName: v.trim() || null })}
            />
            <AutoField
                id="st-tab"
                label="Tab name"
                hint="Shown on this account's tab, up to 12 characters"
                initial={settings.tabName ?? ''}
                placeholder={account.email.split('@')[0]}
                maxLength={TAB_NAME_MAX}
                width={260}
                aside={v => ([...v].length > 10 ? `${[...v].length} of ${TAB_NAME_MAX}` : null)}
                same={(a, b) => a.trim() === b.trim()}
                save={v => patch({ tabName: v.trim() || null })}
            />
            <AutoField
                id="st-signature"
                label="Signature"
                rows={4}
                initial={settings.signature ?? ''}
                check={v => (v.length > SIGNATURE_MAX ? 'Signatures can be up to 2,000 characters' : null)}
                same={(a, b) => a.trimEnd() === b.trimEnd()}
                save={v => patch({ signature: v.trim() ? v : null })}
            />
        </>
    );
};

/**
 * A text field that saves as you go: after a short pause in typing, and when you leave it (closing
 * Settings leaves it first, so Esc keeps an edit). A problem shows under it; it keeps what you typed.
 */
const AutoField: React.FC<{
    id: string;
    label: string;
    hint?: string;
    initial: string;
    placeholder?: string;
    maxLength?: number;
    width?: number;
    rows?: number;
    aside?: (value: string) => React.ReactNode;
    /** A problem found before saving (then nothing is sent). */
    check?: (value: string) => string | null;
    same: (a: string, b: string) => boolean;
    save: (value: string) => Promise<void>;
}> = ({ id, label, hint, initial, placeholder, maxLength, width, rows, aside, check, same, save }) => {
    const [value, setValue] = useState(initial);
    const saved = useRef(initial);
    const latest = useRef(initial);
    const pause = useRef<number | undefined>(undefined);
    const saving = useSaving(save);
    const own = check?.(value) ?? null;

    const flush = useRef(() => {});
    useEffect(() => {
        flush.current = () => {
            window.clearTimeout(pause.current);
            pause.current = undefined;
            const v = latest.current;
            if (same(v, saved.current) || check?.(v)) return;
            const before = saved.current;
            saved.current = v;
            // A refusal: it isn't saved, so leaving the field again tries again
            void saving.run(v).then(ok => { if (!ok && saved.current === v) saved.current = before; });
        };
    });
    // Leaving Settings while a pause is still counting: save it now
    useEffect(() => () => { if (pause.current !== undefined) flush.current(); }, []);

    const onChange = (v: string) => {
        setValue(v);
        latest.current = v;
        window.clearTimeout(pause.current);
        pause.current = window.setTimeout(() => flush.current(), TYPING_PAUSE_MS);
    };

    const problem = own ?? saving.problem;
    const common = {
        id,
        className: 'st-input',
        value,
        placeholder,
        maxLength,
        'aria-invalid': problem ? true : undefined,
        'aria-describedby': [problem ? `${id}-problem` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined,
        onBlur: () => flush.current(),
        style: width ? { maxWidth: width } : undefined,
    };
    return (
        <Field label={label} htmlFor={id} saved={saving.state} aside={aside?.(value)} hint={hint} hintId={`${id}-hint`} problem={problem} problemId={`${id}-problem`}>
            {rows
                ? <textarea {...common} rows={rows} onChange={e => onChange(e.target.value)} />
                : <input {...common} type="text" spellCheck={false} onChange={e => onChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') flush.current(); }} />}
        </Field>
    );
};
