/**
 * Opening mail (settings-spec.md §6): what clicking a card in this account's Inbox does, as two
 * neutral choices. It moves at once and saves; if the save fails it goes back, with the problem
 * under the choices.
 */
import React, { useState } from 'react';
import { api, acct, couldnt } from '../../api/client';
import type { Account } from '../../api/types';
import { useMail } from '../../context/MailContext';
import { RadioGroup } from '../../ui/Choice';
import { Problem, SavedLine } from './parts';

type View = Account['inboxView'];
const CHOICES: { value: View; title: string; detail: string }[] = [
    { value: 'expand', title: 'Open it in place', detail: 'Read it inside the Inbox list (the default)' },
    { value: 'thread', title: 'Open the thread', detail: 'The reading view, with all its messages' },
];

export const OpeningSection: React.FC<{ account: Account }> = ({ account }) => {
    const { fetchAccounts } = useMail();
    const [picked, setPicked] = useState<View>(account.inboxView);
    const [saved, setSaved] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

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
            setProblem(couldnt('save it', err));
        }
    };

    return (
        <div>
            <p className="ba-label" id="st-opening-label" style={{ fontWeight: 400, fontSize: 'var(--size-small)', color: 'var(--text-3)', marginBottom: 'var(--space-3)' }}>
                When you click a card in this account's Inbox
            </p>
            {/* Radio buttons (board C1): one Tab stop, the arrow keys move and pick, and each pick saves */}
            <RadioGroup name={`st-opening-${account.id}`} labelledBy="st-opening-label" value={picked} onChange={v => void pick(v)}
                options={CHOICES.map(c => ({ value: c.value, label: c.title, hint: c.detail }))} style={{ gap: 10 }} />
            {problem ? <Problem>{problem}</Problem> : <SavedLine state={saved ? 'saved' : 'idle'} style={{ marginTop: 'var(--space-3)' }} />}
        </div>
    );
};
