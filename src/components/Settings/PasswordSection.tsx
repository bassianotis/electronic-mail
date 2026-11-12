/**
 * Password and servers (settings-spec.md §4): the account's status at the top; one password for
 * receiving and sending (a link opens a separate sending one); the servers in plain words, editable
 * behind "Change server details". Passwords and servers are checked with the server before
 * anything is saved ("Check and save"); one refusal saves nothing. A new password starts the
 * account again with it, so a refused account comes back online at once.
 */
import React, { useEffect, useState } from 'react';
import { Check, CloudOff, TriangleAlert } from 'lucide-react';
import { api, acct, ApiError, errorText } from '../../api/client';
import type { Account, AccountSettings, ConnectionProblem, ServerSettings } from '../../api/types';
import type { LiveStatus } from '../../api/events';
import { useMail } from '../../context/MailContext';
import { FieldsSkeleton, LoadFailed, Problem, SecretInput, ServerRow, Spinner, type ServerDraft } from './parts';
import { clockTime, sentence, sinceText, useSectionData } from './useSettings';

export const PasswordSection: React.FC<{ account: Account; status: LiveStatus }> = ({ account, status }) => {
    const { data, failed, retry, refresh } = useSectionData(
        () => api.get<{ settings: AccountSettings }>(`${acct(account.id)}/settings`).then(r => r.settings),
        account.id,
    );
    // "Password updated. Mail is arriving again", until the host refuses it again (a refusal newer
    // than the one it answered; the old refusal can still be on screen for a moment)
    const [acceptedOver, setAcceptedOver] = useState<string | null | undefined>(undefined);
    const showAccepted = acceptedOver !== undefined && (status.state !== 'auth-failed' || status.rejectedAt === acceptedOver);
    return (
        <>
            <StatusBox status={status} accepted={showAccepted} />
            {failed ? <LoadFailed onRetry={retry} /> : !data ? <FieldsSkeleton rows={2} /> : (
                <>
                    <PasswordFields key={`pw-${account.id}`} accountId={account.id} settings={data}
                        onAccepted={() => { setAcceptedOver(status.rejectedAt); void refresh(); }} />
                    <Servers key={`srv-${account.id}`} accountId={account.id} settings={data} onSaved={() => void refresh()} />
                </>
            )}
        </>
    );
};

/** Connected, or rejected (when, and when Mail tries again), or just updated. */
const StatusBox: React.FC<{ status: LiveStatus; accepted: boolean }> = ({ status, accepted }) => {
    const { fetchAccounts } = useMail();
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        // "mail checked 2 minutes ago" stays true: the time moves on, and the last check is asked again
        const tick = window.setInterval(() => { setNow(Date.now()); void fetchAccounts(); }, 30_000);
        return () => window.clearInterval(tick);
    }, [fetchAccounts]);

    if (accepted) {
        return (
            <div className="st-box" role="status">
                <span className="st-good"><Check size={16} aria-hidden="true" /></span>
                <span>Password updated. Mail is arriving again</span>
            </div>
        );
    }
    if (status.state === 'auth-failed') {
        const at = clockTime(status.rejectedAt);
        const retry = clockTime(status.retryAt);
        return (
            <div className="st-alert" role="alert">
                <span className="st-icon-warn"><TriangleAlert size={16} aria-hidden="true" /></span>
                <span>
                    <b>The mail server rejected this account's password{at ? ` at ${at}` : ''}</b><br />
                    <span className="st-secondary">
                        New mail stops arriving until it's updated. If you changed it at your provider, enter the new one here.
                        {retry ? ` Mail tries again on its own at ${retry}.` : ''}
                    </span>
                </span>
            </div>
        );
    }
    const since = sinceText(status.lastSyncAt, now);
    if (status.state === 'offline') {
        return (
            <div className="st-box" role="status">
                <span className="st-quiet"><CloudOff size={16} aria-hidden="true" /></span>
                <span>Can't reach the mail server right now{since ? ` · mail checked ${since}` : ''}</span>
            </div>
        );
    }
    if (status.state !== 'online') {
        return <div className="st-box" role="status"><span className="st-quiet"><Spinner size={16} /></span><span>Connecting…</span></div>;
    }
    return (
        <div className="st-box" role="status">
            <span className="st-good"><Check size={16} aria-hidden="true" /></span>
            <span>Connected{since ? ` · mail checked ${since}` : ''}</span>
        </div>
    );
};

/** The engine's reason without its "Incoming mail (IMAP): " label, as a sentence. */
const reasonOf = (err: unknown) => sentence(errorText(err).replace(/^(Incoming|Outgoing) mail \((IMAP|SMTP)\): /, ''));
const problemOf = (err: unknown): ConnectionProblem | null => (err instanceof ApiError ? (err.reason as ConnectionProblem | null) : null);
const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const PasswordFields: React.FC<{ accountId: string; settings: AccountSettings; onAccepted: () => void }> = ({ accountId, settings, onAccepted }) => {
    const [password, setPassword] = useState('');
    const [sendingPassword, setSendingPassword] = useState('');
    const [separate, setSeparate] = useState(false);
    const [checking, setChecking] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [sendingProblem, setSendingProblem] = useState<string | null>(null);
    const typed = !!password || (separate && !!sendingPassword);

    const check = async () => {
        if (!typed || checking) return;
        // The password goes to receiving, and to sending when it signs in with the same username;
        // a separate sending password goes to sending only. Each is tried before anything is saved.
        const smtp = settings.smtp;
        const body: { imap?: ServerSettings & { pass: string }; smtp?: ServerSettings & { pass: string } } = {};
        if (password) body.imap = { ...settings.imap, pass: password };
        if (smtp && separate && sendingPassword) body.smtp = { ...smtp, pass: sendingPassword };
        else if (smtp && !separate && password && sameUser(smtp.user, settings.imap.user)) body.smtp = { ...smtp, pass: password };
        setChecking(true);
        setProblem(null);
        setSendingProblem(null);
        try {
            await api.patch(acct(accountId), body);
            setPassword('');
            setSendingPassword('');
            onAccepted();
        } catch (err) {
            const why = problemOf(err);
            if (why === 'imap-refused') setProblem('The mail server rejected this password. Nothing was changed');
            else if (why === 'smtp-refused') {
                const words = 'The sending server rejected this password. Nothing was changed';
                if (separate && sendingPassword) setSendingProblem(words); else setProblem(words);
            } else if (why === 'smtp' && separate && sendingPassword) setSendingProblem(`${reasonOf(err)}. Nothing was changed`);
            else setProblem(`${reasonOf(err)}. Nothing was changed`);
        } finally {
            setChecking(false);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void check(); };
    return (
        <div>
            <label className="st-label" htmlFor="st-password">Password</label>
            <div className="st-row">
                <SecretInput id="st-password" value={password} disabled={checking} invalid={!!problem}
                    placeholder="Saved (enter a new one to change it)"
                    aria-describedby={['st-password-hint', problem ? 'st-password-problem' : ''].filter(Boolean).join(' ')}
                    onChange={e => { setPassword(e.target.value); setProblem(null); }} onKeyDown={onKeyDown} />
                <button type="button" className="st-primary" onClick={() => void check()} disabled={!typed || checking}>
                    {checking && <Spinner />}{checking ? 'Checking with the server…' : 'Check and save'}
                </button>
            </div>
            {problem && <Problem id="st-password-problem">{problem}</Problem>}
            <p className="st-hint" id="st-password-hint">
                Used for receiving and sending. Mail checks it with the server before saving. If your provider asks for an app password (Gmail, Outlook, iCloud), use that
            </p>
            {settings.smtp && (
                <button type="button" className="st-text st-flush" style={{ marginTop: 6 }} disabled={checking}
                    aria-expanded={separate} aria-controls="st-sending-password-field"
                    onClick={() => { setSeparate(s => !s); setSendingPassword(''); setSendingProblem(null); }}>
                    {separate ? 'Use one password for both' : 'Sending uses a different password'}
                </button>
            )}
            {separate && (
                <div style={{ marginTop: 10 }} id="st-sending-password-field">
                    <label className="st-label" htmlFor="st-sending-password">Sending password</label>
                    <SecretInput id="st-sending-password" value={sendingPassword} disabled={checking} invalid={!!sendingProblem}
                        placeholder="Saved (enter a new one to change it)"
                        aria-describedby={sendingProblem ? 'st-sending-password-problem' : undefined}
                        onChange={e => { setSendingPassword(e.target.value); setSendingProblem(null); }} onKeyDown={onKeyDown} />
                    {sendingProblem && <Problem id="st-sending-password-problem">{sendingProblem}</Problem>}
                </div>
            )}
        </div>
    );
};

const describe = (s: ServerSettings) => `${s.host} · port ${s.port} · ${s.secure ? 'secure (SSL/TLS)' : 'STARTTLS'}`;
const draftOf = (s: ServerSettings | null): ServerDraft => (s ? { host: s.host, port: String(s.port), secure: s.secure } : { host: '', port: '465', secure: true });

/** What's wrong with a server as typed, before asking the server anything. */
function checkServer(d: ServerDraft, kind: 'imap' | 'smtp'): string | null {
    if (!d.host.trim()) return kind === 'smtp' ? 'Mail needs a sending server to send' : 'Mail needs a receiving server to get new mail';
    const port = Number(d.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Use a port number from 1 to 65535';
    return null;
}

const Servers: React.FC<{ accountId: string; settings: AccountSettings; onSaved: () => void }> = ({ accountId, settings, onSaved }) => {
    const { imap, smtp } = settings;
    const oneUser = !smtp || sameUser(smtp.user, imap.user);
    const [open, setOpen] = useState(false);
    const [incoming, setIncoming] = useState(() => draftOf(imap));
    const [outgoing, setOutgoing] = useState(() => draftOf(smtp));
    const [user, setUser] = useState(imap.user);
    const [sendingUser, setSendingUser] = useState(smtp?.user ?? imap.user);
    const [checking, setChecking] = useState(false);
    const [problems, setProblems] = useState<{ imap?: string | null; smtp?: string | null }>({});
    const [saved, setSaved] = useState(false);

    const toggle = () => {
        if (!open) {
            setIncoming(draftOf(imap));
            setOutgoing(draftOf(smtp));
            setUser(imap.user);
            setSendingUser(smtp?.user ?? imap.user);
            setProblems({});
        }
        setOpen(o => !o);
    };

    const save = async () => {
        // The sending server can't be emptied by accident (it used to remove sending without a word)
        const found = {
            imap: checkServer(incoming, 'imap') ?? (user.trim() ? null : 'Enter the username'),
            smtp: !smtp && !outgoing.host.trim() ? null : checkServer(outgoing, 'smtp') ?? ((oneUser ? user : sendingUser).trim() ? null : 'Enter the username'),
        };
        setProblems(found);
        if (found.imap || found.smtp) return;
        const nextImap = { host: incoming.host.trim(), port: Number(incoming.port), secure: incoming.secure, user: user.trim() };
        const nextSmtp = outgoing.host.trim()
            ? { host: outgoing.host.trim(), port: Number(outgoing.port), secure: outgoing.secure, user: (oneUser ? user : sendingUser).trim() }
            : null;
        const body: { imap?: ServerSettings; smtp?: ServerSettings } = {};
        if (JSON.stringify(nextImap) !== JSON.stringify({ host: imap.host, port: imap.port, secure: imap.secure, user: imap.user })) body.imap = nextImap;
        if (nextSmtp && JSON.stringify(nextSmtp) !== JSON.stringify(smtp && { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user })) body.smtp = nextSmtp;
        if (!body.imap && !body.smtp) { setOpen(false); return; }
        setChecking(true);
        try {
            await api.patch(acct(accountId), body);
            setOpen(false);
            setSaved(true);
            window.setTimeout(() => setSaved(false), 2000);
            onSaved();
        } catch (err) {
            const why = problemOf(err);
            const words = why?.endsWith('refused') ? 'The server rejected the username or password. Nothing was changed' : `${reasonOf(err)}. Nothing was changed`;
            setProblems(why?.startsWith('smtp') ? { smtp: words } : { imap: words });
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="st-section">
            <h4 style={{ display: 'flex', alignItems: 'baseline' }}>
                Servers
                <span className="st-saved" aria-live="polite">{saved ? 'Saved' : ''}</span>
            </h4>
            <div className="st-list">
                <div className="st-kv"><span className="st-k">Receiving</span><span className="st-v">{describe(imap)}</span></div>
                <div className="st-kv"><span className="st-k">Sending</span><span className="st-v">{smtp ? describe(smtp) : 'Not set up'}</span></div>
                <div className="st-kv"><span className="st-k">Username</span><span className="st-v">{imap.user}</span></div>
                {!oneUser && smtp && <div className="st-kv"><span className="st-k">Sending username</span><span className="st-v">{smtp.user}</span></div>}
            </div>
            <button type="button" className="st-text st-flush" style={{ marginTop: 8 }} onClick={toggle} aria-expanded={open} disabled={checking}>
                {open ? 'Hide server details' : 'Change server details'}
            </button>
            {open && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                    <ServerRow kind="imap" id="st-imap" value={incoming} onChange={v => { setIncoming(v); setProblems(p => ({ ...p, imap: null })); }} disabled={checking} problem={problems.imap} />
                    <ServerRow kind="smtp" id="st-smtp" value={outgoing} onChange={v => { setOutgoing(v); setProblems(p => ({ ...p, smtp: null })); }} disabled={checking} problem={problems.smtp} />
                    <div className="st-row" style={{ alignItems: 'flex-start' }}>
                        <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
                            <label className="st-label" htmlFor="st-user">{oneUser ? 'Username' : 'Receiving username'}</label>
                            <input id="st-user" className="st-input" value={user} disabled={checking} spellCheck={false} autoComplete="off" onChange={e => setUser(e.target.value)} />
                        </div>
                        {!oneUser && (
                            <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
                                <label className="st-label" htmlFor="st-sending-user">Sending username</label>
                                <input id="st-sending-user" className="st-input" value={sendingUser} disabled={checking} spellCheck={false} autoComplete="off" onChange={e => setSendingUser(e.target.value)} />
                            </div>
                        )}
                    </div>
                    <div className="st-row">
                        <button type="button" className="st-primary" onClick={() => void save()} disabled={checking}>
                            {checking && <Spinner />}{checking ? 'Checking with the server…' : 'Check and save'}
                        </button>
                        <span className="st-hint" style={{ margin: 0 }}>Changing the security option sets the usual port; both servers are checked before anything is saved</span>
                    </div>
                </div>
            )}
        </div>
    );
};
