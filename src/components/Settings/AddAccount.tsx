/**
 * Adding an account, a step inside Settings (settings-spec.md §7; no dialog on a dialog): name,
 * address and password on one screen. Continue finds the servers from the address (the engine's
 * app/discover.ts, as Thunderbird does) and signs in; only if they can't be found, or don't
 * answer, does the same screen ask for them. Done goes straight back to Accounts.
 */
import React, { useState } from 'react';
import { api, ApiError, errorText } from '../../api/client';
import type { ConnectionProblem, FoundServers } from '../../api/types';
import { useMail } from '../../context/MailContext';
import { Problem, SecretInput, ServerRow, Spinner, type ServerDraft } from './parts';
import { sentence } from './useSettings';

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFUSED = 'The mail server rejected this address and password';

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
    const [checking, setChecking] = useState(false);
    const [problems, setProblems] = useState<Problems>({});
    const address = email.trim();
    const domain = address.split('@')[1] ?? '';

    const add = async (servers: FoundServers, from: 'details' | 'servers') => {
        try {
            await api.post('/accounts', {
                email: address,
                displayName: name.trim() || null,
                imap: { ...servers.imap, user: address, pass: password },
                smtp: { ...servers.smtp, user: address, pass: password },
            });
            await fetchAccounts(); // its tab is on the rail before Accounts lists it
            onDone(address);
        } catch (err) {
            const why = err instanceof ApiError ? (err.reason as ConnectionProblem | null) : null;
            const reason = sentence(errorText(err).replace(/^(Incoming|Outgoing) mail \((IMAP|SMTP)\): /, ''));
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
        setChecking(true);
        try {
            const { servers } = await api.post<{ servers: FoundServers | null }>('/accounts/discover', { email: address });
            if (servers) await add(servers, 'details');
            else {
                setIncoming({ host: `mail.${domain}`, port: '993', secure: true });
                setOutgoing({ host: `mail.${domain}`, port: '465', secure: true });
                setNotFound(true);
                setStep('servers');
            }
        } catch (err) {
            setProblems({ email: sentence(errorText(err)) });
        } finally {
            setChecking(false);
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
        setChecking(true);
        try {
            await add({
                imap: { host: incoming.host.trim(), port: Number(incoming.port), secure: incoming.secure },
                smtp: { host: outgoing.host.trim(), port: Number(outgoing.port), secure: outgoing.secure },
            }, 'servers');
        } finally {
            setChecking(false);
        }
    };

    const busy = checking && <Spinner />;
    if (step === 'servers') {
        return (
            <div className="st-adding">
                {notFound && (
                    <div className="st-alert" role="status">
                        <span>Mail couldn't find the servers for <b>{domain}</b>. Enter them below, or go back and check the address.</span>
                    </div>
                )}
                <ServerRow kind="imap" id="st-add-imap" compact value={incoming} disabled={checking} problem={problems.imap}
                    onChange={v => { setIncoming(v); setProblems(p => ({ ...p, imap: undefined, form: undefined })); }} />
                <ServerRow kind="smtp" id="st-add-smtp" compact value={outgoing} disabled={checking} problem={problems.smtp}
                    onChange={v => { setOutgoing(v); setProblems(p => ({ ...p, smtp: undefined, form: undefined })); }} />
                {problems.form && <Problem>{problems.form}</Problem>}
                <div className="st-actions">
                    <button type="button" className="st-btn" disabled={checking} onClick={() => { setStep('details'); setProblems({}); }}>Back</button>
                    <button type="button" className="st-primary" disabled={checking} onClick={() => void checkAndAdd()}>
                        {busy}{checking ? 'Checking with the server…' : 'Check and add'}
                    </button>
                </div>
            </div>
        );
    }

    const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void proceed(); };
    return (
        <div className="st-adding">
            <div>
                <label className="st-label" htmlFor="st-add-name">Your name</label>
                <input id="st-add-name" className="st-input" value={name} disabled={checking} autoComplete="name" autoFocus
                    onChange={e => setName(e.target.value)} onKeyDown={onEnter} />
            </div>
            <div>
                <label className="st-label" htmlFor="st-add-email">Email address</label>
                <input id="st-add-email" className="st-input" type="email" value={email} disabled={checking} autoComplete="email" spellCheck={false}
                    aria-invalid={problems.email ? true : undefined} aria-describedby={problems.email ? 'st-add-email-problem' : undefined}
                    onChange={e => { setEmail(e.target.value); setProblems(p => ({ ...p, email: undefined })); }} onKeyDown={onEnter} />
                {problems.email && <Problem id="st-add-email-problem">{problems.email}</Problem>}
            </div>
            <div>
                <label className="st-label" htmlFor="st-add-password">Password</label>
                <SecretInput id="st-add-password" value={password} disabled={checking} invalid={!!problems.password} wide
                    aria-describedby={['st-add-password-hint', problems.password ? 'st-add-password-problem' : ''].filter(Boolean).join(' ')}
                    onChange={e => { setPassword(e.target.value); setProblems(p => ({ ...p, password: undefined })); }} onKeyDown={onEnter} />
                {problems.password && <Problem id="st-add-password-problem">{problems.password}</Problem>}
                <p className="st-hint" id="st-add-password-hint">If your provider asks for an app password (Gmail, Outlook, iCloud), use that</p>
            </div>
            <div className="st-actions">
                <button type="button" className="st-btn" disabled={checking} onClick={onCancel}>Cancel</button>
                <button type="button" className="st-primary" disabled={checking} onClick={() => void proceed()}>
                    {busy}{checking ? 'Checking with the server…' : 'Continue'}
                </button>
            </div>
        </div>
    );
};
