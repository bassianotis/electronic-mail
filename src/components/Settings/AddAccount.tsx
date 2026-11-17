/**
 * Adding an account, a step inside Settings (settings-spec.md §7; no dialog on a dialog): name,
 * address and password on one screen. Continue finds the servers from the address (the engine's
 * app/discover.ts, as Thunderbird does) and signs in; only if they can't be found, or don't
 * answer, does the same screen ask for them. Done goes straight back to Accounts. The fields stay
 * editable while the server checks; a change (or Back, or Cancel) meanwhile drops that check's
 * answer, and an account it had added already is taken off again (it was never shown).
 */
import React, { useState } from 'react';
import { acct, api, ApiError, reasonOr } from '../../api/client';
import type { ConnectionProblem, FoundServers } from '../../api/types';
import { useMail } from '../../context/MailContext';
import { Button } from '../../ui/Button';
import { Note } from '../../ui/Note';
import { useServerCheck } from '../../ui/useServerCheck';
import { Problem, SecretInput, ServerRow, type ServerDraft } from './parts';

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFUSED = 'The mail server rejected this address and password';

/** A check that added the account after the fields changed (owner, 2026-11-14): the line names the
 *  button on the screen it's shown on (owner, Checkpoint B). */
const NOT_ADDED = "You changed the details while checking, so the account wasn't added.";
const TRY_AGAIN = { details: 'Continue to try again.', servers: 'Check and add again.' } as const;
const NOT_ADDED_PREFIX = 'You changed the details while checking.';

/** Takes a just-added account off again: once more after a moment if the first try fails. */
async function removeAgain(id: string): Promise<boolean> {
    for (let i = 0; i < 2; i++) {
        try {
            await api.del(acct(id));
            return true;
        } catch {
            await new Promise(r => setTimeout(r, 600));
        }
    }
    return false;
}

interface Problems { name?: string; email?: string; password?: string; imap?: string; smtp?: string; form?: string }

export const AddAccount: React.FC<{ onDone: (email: string) => void; onCancel: () => void }> = ({ onDone, onCancel }) => {
    const { fetchAccounts } = useMail();
    const [step, setStep] = useState<'details' | 'servers'>('details');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [incoming, setIncoming] = useState<ServerDraft>({ host: '', port: '993', secure: true });
    const [outgoing, setOutgoing] = useState<ServerDraft>({ host: '', port: '465', secure: true });
    /** The servers screen came from not finding them (it says so), not from their failing. */
    const [notFound, setNotFound] = useState(false);
    const { checking, begin, current, end, changed } = useServerCheck();
    const [problems, setProblems] = useState<Problems>({});
    /** Added and taken off again (`gone`), or still there (`address`, as it was added). */
    const [notAdded, setNotAdded] = useState<{ gone: boolean; address: string } | null>(null);
    const notAddedLine = notAdded && (notAdded.gone
        ? <p className="ba-hint" role="status" style={{ margin: 0 }}>{NOT_ADDED} {TRY_AGAIN[step]}</p>
        : <Problem>{NOT_ADDED_PREFIX} Mail couldn't take it off again: remove {notAdded.address} in Accounts</Problem>);
    const address = email.trim();
    const domain = address.split('@')[1] ?? '';

    const add = async (servers: FoundServers, from: 'details' | 'servers', token: number) => {
        try {
            const { account } = await api.post<{ account: { id: string } }>('/accounts', {
                email: address,
                displayName: name.trim() || null,
                imap: { ...servers.imap, user: address, pass: password },
                smtp: { ...servers.smtp, user: address, pass: password },
            });
            if (!current(token)) {
                // Changed while it was checked and added: the answer is about details no longer
                // there, so the account goes again, with everything Mail kept for it (the engine
                // forgets its cached mail, rules and bucket looks); the button is back (owner, 2026-11-14)
                const gone = await removeAgain(account.id);
                setNotAdded({ gone, address });
                return;
            }
            await fetchAccounts(); // its tab is on the rail before Accounts lists it
            onDone(address);
        } catch (err) {
            if (!current(token)) return;
            const why = err instanceof ApiError ? (err.reason as ConnectionProblem | null) : null;
            const reason = reasonOr('add the account', err); // the reason alone: it shows under the server it's about
            if (why === 'imap-refused' || why === 'smtp-refused') {
                if (from === 'servers') setProblems({ form: REFUSED });
                else setProblems({ password: REFUSED });
            } else if (why === 'imap' || why === 'smtp') {
                // Found, but they don't answer: show them, with what went wrong under the one that failed
                setIncoming({ host: servers.imap.host, port: String(servers.imap.port), secure: servers.imap.secure });
                setOutgoing({ host: servers.smtp.host, port: String(servers.smtp.port), secure: servers.smtp.secure });
                if (from === 'details') setNotFound(false);
                setStep('servers');
                setProblems({ [why]: reason });
            } else if (from === 'servers') setProblems({ form: reason });
            else setProblems({ email: reason }); // e.g. it's already set up
        }
    };

    const proceed = async () => {
        const found: Problems = {};
        if (!ADDRESS.test(address)) found.email = 'Enter the whole address, like name@example.com';
        if (!password) found.password = 'Enter the password';
        setProblems(found);
        if (found.email || found.password) return;
        const token = begin();
        setNotAdded(null);
        try {
            const { servers } = await api.post<{ servers: FoundServers | null }>('/accounts/discover', { email: address });
            if (!current(token)) return;
            if (servers) await add(servers, 'details', token);
            else {
                setIncoming({ host: `mail.${domain}`, port: '993', secure: true });
                setOutgoing({ host: `mail.${domain}`, port: '465', secure: true });
                setNotFound(true);
                setStep('servers');
            }
        } catch (err) {
            if (current(token)) setProblems({ email: reasonOr('check the address', err) });
        } finally {
            end(token);
        }
    };

    const checkAndAdd = async () => {
        const found: Problems = {};
        const portOk = (p: string) => Number.isInteger(Number(p)) && Number(p) >= 1 && Number(p) <= 65535;
        if (!incoming.host.trim()) found.imap = 'Enter the receiving server';
        else if (!portOk(incoming.port)) found.imap = 'Use a port number from 1 to 65535';
        if (!outgoing.host.trim()) found.smtp = 'Mail needs a sending server to send';
        else if (!portOk(outgoing.port)) found.smtp = 'Use a port number from 1 to 65535';
        setProblems(found);
        if (found.imap || found.smtp) return;
        const token = begin();
        setNotAdded(null);
        try {
            await add({
                imap: { host: incoming.host.trim(), port: Number(incoming.port), secure: incoming.secure },
                smtp: { host: outgoing.host.trim(), port: Number(outgoing.port), secure: outgoing.secure },
            }, 'servers', token);
        } finally {
            end(token);
        }
    };

    if (step === 'servers') {
        return (
            <div className="st-adding">
                {notFound && (
                    <Note tone="warning" role="status">Mail couldn't find the servers for <b>{domain}</b>. Enter them below, or go back and check the address.</Note>
                )}
                <ServerRow kind="imap" id="st-add-imap" compact value={incoming} problem={problems.imap}
                    onChange={v => { setIncoming(v); setProblems(p => ({ ...p, imap: undefined, form: undefined })); changed(); }} />
                <ServerRow kind="smtp" id="st-add-smtp" compact value={outgoing} problem={problems.smtp}
                    onChange={v => { setOutgoing(v); setProblems(p => ({ ...p, smtp: undefined, form: undefined })); changed(); }} />
                {problems.form && <Problem>{problems.form}</Problem>}
                {notAddedLine}
                <div className="st-actions">
                    <Button onClick={() => { changed(); setStep('details'); setProblems({}); }}>Back</Button>
                    <Button kind="primary" working={checking && 'Checking with the server…'} onClick={() => void checkAndAdd()}>Check and add</Button>
                </div>
            </div>
        );
    }

    const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !checking) void proceed(); };
    return (
        <div className="st-adding">
            <div>
                <label className="ba-label" htmlFor="st-add-name">Your name</label>
                <input id="st-add-name" className="ba-input" value={name} autoComplete="name" autoFocus
                    onChange={e => { setName(e.target.value); changed(); }} onKeyDown={onEnter} />
            </div>
            <div>
                <label className="ba-label" htmlFor="st-add-email">Email address</label>
                <input id="st-add-email" className="ba-input" type="email" value={email} autoComplete="email" spellCheck={false}
                    aria-invalid={problems.email ? true : undefined} aria-describedby={problems.email ? 'st-add-email-problem' : undefined}
                    onChange={e => { setEmail(e.target.value); setProblems(p => ({ ...p, email: undefined })); changed(); }} onKeyDown={onEnter} />
                {problems.email && <Problem id="st-add-email-problem">{problems.email}</Problem>}
            </div>
            <div>
                <label className="ba-label" htmlFor="st-add-password">Password</label>
                <SecretInput id="st-add-password" value={password} invalid={!!problems.password} wide
                    aria-describedby={['st-add-password-hint', problems.password ? 'st-add-password-problem' : ''].filter(Boolean).join(' ')}
                    onChange={e => { setPassword(e.target.value); setProblems(p => ({ ...p, password: undefined })); changed(); }} onKeyDown={onEnter} />
                {problems.password && <Problem id="st-add-password-problem">{problems.password}</Problem>}
                <p className="ba-hint" id="st-add-password-hint">If your provider asks for an app password (Gmail, Outlook, iCloud), use that</p>
            </div>
            {notAddedLine}
            <div className="st-actions">
                <Button onClick={() => { changed(); onCancel(); }}>Cancel</Button>
                <Button kind="primary" working={checking && 'Checking with the server…'} onClick={() => void proceed()}>Continue</Button>
            </div>
        </div>
    );
};
