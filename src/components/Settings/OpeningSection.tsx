/**
 * Opening mail (settings-spec.md §6): what clicking a card in this account's Inbox does, as two
 * neutral choices. It moves at once and saves; if the save fails it goes back, with the problem
 * under the choices.
 */
import React, { useRef, useState } from 'react';
import { api, acct, errorText } from '../../api/client';
import type { Account } from '../../api/types';
import { useMail } from '../../context/MailContext';
import { Problem } from './parts';
import { sentence } from './useSettings';

type View = Account['inboxView'];
const CHOICES: { value: View; title: string; detail: string }[] = [
    { value: 'expand', title: 'Open it in place', detail: 'Read it inside the Inbox list (the default)' },
    { value: 'thread', title: 'Open the conversation', detail: 'The reading view, with the whole thread' },
];

export const OpeningSection: React.FC<{ account: Account }> = ({ account }) => {
    const { fetchAccounts } = useMail();
    const [picked, setPicked] = useState<View>(account.inboxView);
    const [saved, setSaved] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const radios = useRef<(HTMLButtonElement | null)[]>([]);

    const pick = async (value: View) => {
        if (value === picked) return;
        const before = picked;
        setPicked(value);
        setProblem(null);
        try {
            await api.patch(acct(account.id), { inboxView: value });
            await fetchAccounts();
            setSaved(true);
            window.setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            setPicked(before);
            setProblem(`Couldn't save it: ${sentence(errorText(err))}`);
        }
    };

    // A radio group: the arrow keys move and pick
    const onKeyDown = (e: React.KeyboardEvent, i: number) => {
        const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = (i + step + CHOICES.length) % CHOICES.length;
        radios.current[next]?.focus();
        void pick(CHOICES[next].value);
    };

    return (
        <div>
            <p className="st-label" id="st-opening-label" style={{ fontWeight: 400, fontSize: 13.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                When you click a card in this account's Inbox
                <span className="st-saved" aria-live="polite">{saved ? 'Saved' : ''}</span>
            </p>
            <div role="radiogroup" aria-labelledby="st-opening-label" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
                {CHOICES.map((c, i) => (
                    <button key={c.value} ref={el => { radios.current[i] = el; }} type="button" role="radio" className="st-choice"
                        aria-checked={picked === c.value} tabIndex={picked === c.value ? 0 : -1}
                        onClick={() => void pick(c.value)} onKeyDown={e => onKeyDown(e, i)}>
                        <b>{c.title}</b>
                        <span>{c.detail}</span>
                    </button>
                ))}
            </div>
            {problem && <Problem>{problem}</Problem>}
        </div>
    );
};
