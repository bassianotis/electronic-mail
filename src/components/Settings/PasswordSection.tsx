/**
 * Password and servers (settings-spec.md §4): the account's status at the top; one password for
 * receiving and sending (a link opens a separate sending one); the servers in plain words, editable
 * behind "Change server details". Passwords and servers are checked with the server before
 * anything is saved ("Check and save"); one refusal saves nothing. A new password starts the
 * account again with it, so a refused account comes back online at once. The fields stay editable
 * while the server checks; a change meanwhile drops that check's answer (useServerCheck).
 */
import React, { useEffect, useState } from 'react';
import { Check, CloudOff } from 'lucide-react';
import { api, acct, ApiError, reasonFor } from '../../api/client';
import { tryAgain } from '../../api/engineWords';
import type { Account, AccountSettings, ConnectionProblem, ServerSettings } from '../../api/types';
import type { LiveStatus } from '../../api/events';
import { useMail } from '../../context/MailContext';
import { Button } from '../../ui/Button';
import { Note } from '../../ui/Note';
import { useServerCheck } from '../../ui/useServerCheck';
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
            <Note role="status" icon={<Check size={16} aria-hidden="true" className="is-good" />}>Password updated. Mail is arriving again</Note>
        );
    }
    if (status.state === 'auth-failed') {
        const at = clockTime(status.rejectedAt);
        const retry = clockTime(status.retryAt);
        return (
            <Note tone="warning" role="alert">
                <b>The mail server rejected this account's password{at ? ` at ${at}` : ''}</b><br />
                <span className="ba-quiet">
                    New mail stops arriving until it's updated. If you changed it at your provider, enter the new one here.
                    {retry ? ` Mail tries again on its own at ${retry}.` : ''}
                </span>
            </Note>
        );
    }
    const since = sinceText(status.lastSyncAt, now);
    if (status.state === 'offline') {
        return (
            <Note role="status" icon={<CloudOff size={16} aria-hidden="true" />}>Can't reach the mail server right now{since ? ` · mail checked ${since}` : ''}</Note>
        );
    }
    if (status.state !== 'online') {
        return <Note role="status" icon={<Spinner size={16} />}>Connecting…</Note>;
    }
    return (
        <Note role="status" icon={<Check size={16} aria-hidden="true" className="is-good" />}>Connected{since ? ` · mail checked ${since}` : ''}</Note>
    );
};

/** The engine's reason in plain words (without its "Incoming mail (IMAP): " label), as a sentence,
 *  and that nothing changed; with nothing worth saying, "Couldn't <action>. Try again." */
const unchanged = (err: unknown, action: string) => { const why = reasonFor(err); return why ? `${sentence(why)}. Nothing was changed` : tryAgain(action); };
const problemOf = (err: unknown): ConnectionProblem | null => (err instanceof ApiError ? (err.reason as ConnectionProblem | null) : null);
const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** A check that passed after the fields changed: the server kept what it checked (owner, 2026-11-14). */
const SAVED_EARLIER = 'Saved the earlier details. Check and save to use these.';

const PasswordFields: React.FC<{ accountId: string; settings: AccountSettings; onAccepted: () => void }> = ({ accountId, settings, onAccepted }) => {
    const [password, setPassword] = useState('');
    const [sendingPassword, setSendingPassword] = useState('');
    const [separate, setSeparate] = useState(false);
    const { checking, begin, current, end, changed } = useServerCheck();
    const [problem, setProblem] = useState<string | null>(null);
    const [sendingProblem, setSendingProblem] = useState<string | null>(null);
    const [savedEarlier, setSavedEarlier] = useState(false);
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
        const token = begin();
        setProblem(null);
        setSendingProblem(null);
        setSavedEarlier(false);
        try {
            await api.patch(acct(accountId), body);
            // Changed while it was checked: this answer is about a password no longer typed. It
            // passed, so the server keeps it: say so quietly; the one typed now waits for its own
            // Check and save
            if (!current(token)) { setSavedEarlier(true); return; }
            setPassword('');
            setSendingPassword('');
            onAccepted();
        } catch (err) {
            if (!current(token)) return;
            const why = problemOf(err);
            if (why === 'imap-refused') setProblem('The mail server rejected this password. Nothing was changed');
            else if (why === 'smtp-refused') {
                const words = 'The sending server rejected this password. Nothing was changed';
                if (separate && sendingPassword) setSendingProblem(words); else setProblem(words);
            } else if (why === 'smtp' && separate && sendingPassword) setSendingProblem(unchanged(err, 'save the password'));
            else setProblem(unchanged(err, 'save the password'));
        } finally {
            end(token);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void check(); };
    return (
        <div>
            <label className="ba-label" htmlFor="st-password">Password</label>
            <div className="st-row">
                <SecretInput id="st-password" value={password} invalid={!!problem}
                    placeholder="Saved (enter a new one to change it)"
                    aria-describedby={['st-password-hint', problem ? 'st-password-problem' : ''].filter(Boolean).join(' ')}
                    onChange={e => { setPassword(e.target.value); setProblem(null); changed(); }} onKeyDown={onKeyDown} />
                <Button kind="primary" onClick={() => void check()} disabled={!typed} working={checking && 'Checking with the server…'}>Check and save</Button>
            </div>
            {problem && <Problem id="st-password-problem">{problem}</Problem>}
            {savedEarlier && <p className="ba-hint" role="status">{SAVED_EARLIER}</p>}
            <p className="ba-hint" id="st-password-hint">
                Used for receiving and sending. Mail checks it with the server before saving. If your provider asks for an app password (Gmail, Outlook, iCloud), use that
            </p>
            {settings.smtp && (
                <Button kind="quiet" size="sm" className="st-flush" style={{ marginTop: 6 }}
                    aria-expanded={separate} aria-controls="st-sending-password-field"
                    onClick={() => { setSeparate(s => !s); setSendingPassword(''); setSendingProblem(null); changed(); }}>
                    {separate ? 'Use one password for both' : 'Sending uses a different password'}
                </Button>
            )}
            {separate && (
                <div style={{ marginTop: 10 }} id="st-sending-password-field">
                    <label className="ba-label" htmlFor="st-sending-password">Sending password</label>
                    <SecretInput id="st-sending-password" value={sendingPassword} invalid={!!sendingProblem}
                        placeholder="Saved (enter a new one to change it)"
                        aria-describedby={sendingProblem ? 'st-sending-password-problem' : undefined}
                        onChange={e => { setSendingPassword(e.target.value); setSendingProblem(null); changed(); }} onKeyDown={onKeyDown} />
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
    const { checking, begin, current, end, changed } = useServerCheck();
    const [problems, setProblems] = useState<{ imap?: string | null; smtp?: string | null }>({});
    const [saved, setSaved] = useState(false);
    const [savedEarlier, setSavedEarlier] = useState(false);

    const toggle = () => {
        if (!open) {
            setIncoming(draftOf(imap));
            setOutgoing(draftOf(smtp));
            setUser(imap.user);
            setSendingUser(smtp?.user ?? imap.user);
            setProblems({});
        }
        changed(); // hidden while it was checked: its answer is dropped
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
        const token = begin();
        setSavedEarlier(false);
        try {
            await api.patch(acct(accountId), body);
            // Changed while it was checked: no "Saved", the form stays open with what's there now. It
            // passed, so the server keeps what it checked (the summary above shows it), and says so
            if (!current(token)) { setSavedEarlier(true); onSaved(); return; }
            setOpen(false);
            setSaved(true);
            window.setTimeout(() => setSaved(false), 2000);
            onSaved();
        } catch (err) {
            if (!current(token)) return;
            const why = problemOf(err);
            const words = why?.endsWith('refused') ? 'The server rejected the username or password. Nothing was changed' : unchanged(err, 'save the server details');
            setProblems(why?.startsWith('smtp') ? { smtp: words } : { imap: words });
        } finally {
            end(token);
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
            <Button kind="quiet" size="sm" className="st-flush" style={{ marginTop: 'var(--space-2)' }} onClick={toggle} aria-expanded={open}>
                {open ? 'Hide server details' : 'Change server details'}
            </Button>
            {open && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 'var(--space-3)' }}>
                    <ServerRow kind="imap" id="st-imap" value={incoming} onChange={v => { setIncoming(v); setProblems(p => ({ ...p, imap: null })); changed(); }} problem={problems.imap} />
                    <ServerRow kind="smtp" id="st-smtp" value={outgoing} onChange={v => { setOutgoing(v); setProblems(p => ({ ...p, smtp: null })); changed(); }} problem={problems.smtp} />
                    <div className="st-row" style={{ alignItems: 'flex-start' }}>
                        <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
                            <label className="ba-label" htmlFor="st-user">{oneUser ? 'Username' : 'Receiving username'}</label>
                            <input id="st-user" className="ba-input" value={user} spellCheck={false} autoComplete="off" onChange={e => { setUser(e.target.value); changed(); }} />
                        </div>
                        {!oneUser && (
                            <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
                                <label className="ba-label" htmlFor="st-sending-user">Sending username</label>
                                <input id="st-sending-user" className="ba-input" value={sendingUser} spellCheck={false} autoComplete="off" onChange={e => { setSendingUser(e.target.value); changed(); }} />
                            </div>
                        )}
                    </div>
                    <div className="st-row">
                        <Button kind="primary" onClick={() => void save()} working={checking && 'Checking with the server…'}>Check and save</Button>
                        <span className="ba-hint" style={{ margin: 0 }}>Changing the security option sets the usual port; both servers are checked before anything is saved</span>
                    </div>
                </div>
            )}
            {savedEarlier && <p className="ba-hint" role="status" style={{ marginTop: 'var(--space-2)' }}>{SAVED_EARLIER}</p>}
        </div>
    );
};
