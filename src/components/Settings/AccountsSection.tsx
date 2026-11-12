/**
 * Accounts (settings-spec.md §7): every account, in the rail's order (drag a handle, or use the
 * arrow keys on it), with its status; Remove asks in place, not in a browser box; "+ Add an email
 * account" turns Settings into that step (AddAccount.tsx). Without the shared sign-in, signing
 * out of this browser lives here too.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { Check, GripVertical, TriangleAlert } from 'lucide-react';
import { api, errorText } from '../../api/client';
import type { Account } from '../../api/types';
import type { LiveStatus } from '../../api/events';
import { useFamily } from '../../api/family';
import { useMail } from '../../context/MailContext';
import { tabLabel } from '../../utils/accountLabel';
import { DURATION, tween } from '../../utils/motion';
import { Problem } from './parts';
import { sentence } from './useSettings';

/** An onUpdate that does nothing: it keeps framer's animations on the page (see the question below). */
const keepOnPage = () => {};

/** The status at the right of an account's row. */
function statusText(s: LiveStatus | undefined): { text: string; warn?: boolean } {
    if (!s) return { text: '' };
    if (s.state === 'auth-failed') return { text: 'Password rejected', warn: true };
    if (s.state === 'offline') return { text: 'Offline' };
    if (!s.lastSyncAt) return { text: 'Loading mail…' }; // until its first check finishes (a new account)
    if (s.state === 'online') return { text: 'Connected' };
    return { text: 'Connecting…' };
}

export const AccountsSection: React.FC<{
    statuses: Map<string, LiveStatus>;
    /** The address of an account just added, for "… is added" at the top. */
    justAdded: string | null;
    onAdd: () => void;
}> = ({ statuses, justAdded, onAdd }) => {
    const { accounts, fetchAccounts, showToast, activeAccountId } = useMail();
    const sharedSignIn = !!useFamily();
    const ids = accounts.map(a => a.id);
    const [order, setOrder] = useState(ids);
    const [synced, setSynced] = useState(ids.join());
    if (synced !== ids.join()) {
        // Added, removed or reordered elsewhere: start from the engine's order
        setSynced(ids.join());
        setOrder(ids);
    }
    const latest = useRef(order);
    useEffect(() => { latest.current = order; });
    const [asking, setAsking] = useState<string | null>(null);
    const handles = useRef(new Map<string, HTMLButtonElement | null>());

    const commit = async (next: string[]) => {
        if (next.join() === ids.join()) return;
        try {
            await api.put('/account-order', { ids: next });
            await fetchAccounts();
        } catch (err) {
            showToast({ message: `Couldn't save the new order: ${errorText(err)}`, tone: 'error' });
            setOrder(ids);
        }
    };

    const move = (id: string, by: number) => {
        const from = order.indexOf(id);
        const to = from + by;
        if (from < 0 || to < 0 || to >= order.length) return;
        const next = [...order];
        next.splice(to, 0, ...next.splice(from, 1));
        setOrder(next);
        // Its handle keeps the focus where the row went (moving a row can drop it)
        requestAnimationFrame(() => handles.current.get(id)?.focus());
        void commit(next);
    };

    const byId = new Map(accounts.map(a => [a.id, a]));
    return (
        <>
            {justAdded && (
                <div className="st-box" role="status">
                    <span className="st-good"><Check size={16} aria-hidden="true" /></span>
                    <span><b>{justAdded} is added.</b> Its mail is loading in the background</span>
                </div>
            )}
            <div>
                <Reorder.Group as="div" axis="y" values={order} onReorder={setOrder} className="st-list" role="list" aria-label="Accounts">
                    {order.map(id => {
                        const account = byId.get(id);
                        if (!account) return null;
                        return (
                            <AccountRow key={id} account={account} label={tabLabel(account, accounts)} status={statuses.get(id)}
                                asking={asking === id} onAsk={() => setAsking(id)} onCancel={() => setAsking(null)}
                                handleRef={el => { handles.current.set(id, el); }}
                                onMove={by => move(id, by)} onDropped={() => void commit(latest.current)}
                                wasActive={id === activeAccountId} />
                        );
                    })}
                </Reorder.Group>
                {accounts.length > 1 && <p className="st-hint">Drag to change the order of the tabs</p>}
            </div>
            <div>
                <button type="button" className="st-btn" onClick={onAdd}>+ Add an email account</button>
            </div>
            {!sharedSignIn && <SignOut />}
        </>
    );
};

const AccountRow: React.FC<{
    account: Account;
    label: string;
    status: LiveStatus | undefined;
    asking: boolean;
    onAsk: () => void;
    onCancel: () => void;
    handleRef: (el: HTMLButtonElement | null) => void;
    onMove: (by: number) => void;
    onDropped: () => void;
    wasActive: boolean;
}> = ({ account, label, status, asking, onAsk, onCancel, handleRef, onMove, onDropped, wasActive }) => {
    const controls = useDragControls();
    const reduce = useReducedMotion();
    const [removing, setRemoving] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const shown = statusText(status);

    const remove = async () => {
        setRemoving(true);
        setProblem(null);
        try {
            await api.del(`/accounts/${encodeURIComponent(account.id)}`);
            // As before: the app starts again without it (on another account, if this one was open)
            if (wasActive) { try { localStorage.removeItem('activeAccountId'); } catch { /* fine */ } }
            window.location.reload();
        } catch (err) {
            setRemoving(false);
            setProblem(`Couldn't remove it: ${sentence(errorText(err))}`);
        }
    };

    return (
        // layout="position": a row moves when the order changes, but never scales when its height
        // does (the question opening under it used to squash and stretch the row's text)
        <Reorder.Item as="div" value={account.id} dragListener={false} dragControls={controls} role="listitem" layout="position"
            transition={tween(DURATION.mid)} onDragEnd={onDropped} style={{ position: 'relative' }}
            whileDrag={{ zIndex: 2, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)' }}>
            <div className="st-account">
                <button ref={handleRef} type="button" className="st-handle" aria-label={`Reorder ${label}`} title="Drag to reorder"
                    onPointerDown={e => { e.preventDefault(); controls.start(e); }}
                    onKeyDown={e => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onMove(e.key === 'ArrowUp' ? -1 : 1); }
                    }}>
                    <GripVertical size={16} aria-hidden="true" />
                </button>
                <span className="st-who">
                    <b>{label}</b>
                    <small>{account.email}</small>
                </span>
                <span className={`st-state${shown.warn ? ' st-state-warn' : ''}`}>
                    {shown.warn && <TriangleAlert size={13} aria-hidden="true" />}{shown.text}
                </span>
                <button type="button" className="st-text st-text-danger" onClick={onAsk} aria-expanded={asking} disabled={removing}>Remove…</button>
            </div>
            {/* The question opens beneath the row like the Inbox's gaps close: its space on the app's
                curve (200ms), the rows below sliding with it, the words fading in (150ms). With Reduce
                motion, it only fades.
                onUpdate keeps the fade on the page, not the browser's animation engine: handed back
                from there, its last value lands a frame late, and as the space is still moving then,
                the question flashed (hidden at the end of opening, shown at the end of closing). */}
            <AnimatePresence initial={false}>
                {asking && (
                    <motion.div key="confirm" className="st-confirm-wrap" style={{ overflow: 'hidden' }} onUpdate={keepOnPage}
                        initial={{ height: reduce ? 'auto' : 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: reduce ? 'auto' : 0, opacity: 0 }}
                        transition={{ height: reduce ? { duration: 0 } : tween(DURATION.mid), opacity: tween(DURATION.fast) }}>
                        <div className="st-confirm" role="group" aria-label={`Remove ${account.email}`}>
                            <b>Remove {account.email} from Mail?</b><br />
                            Mail forgets this account's rules, how its buckets look and its saved copy of the mail. The mail itself stays on the server, buckets included, and you can add the account again.
                            <div className="st-row" style={{ marginTop: 12 }}>
                                <button type="button" className="st-btn" onClick={onCancel} disabled={removing} autoFocus>Cancel</button>
                                <button type="button" className="st-danger" onClick={() => void remove()} disabled={removing}>{removing ? 'Removing…' : 'Remove account'}</button>
                            </div>
                            {problem && <Problem>{problem}</Problem>}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Reorder.Item>
    );
};

/** Without the shared sign-in only (with it, signing out lives in the apps menu). */
const SignOut: React.FC = () => {
    const [problem, setProblem] = useState<string | null>(null);
    return (
        <div>
            <button type="button" className="st-btn" onClick={async () => {
                try {
                    await api.post('/auth/logout');
                    window.location.reload();
                } catch (err) {
                    setProblem(`Couldn't sign out: ${sentence(errorText(err))}`);
                }
            }}>Sign out of this browser</button>
            <p className="st-hint">Signs you out of this browser only</p>
            {problem && <Problem>{problem}</Problem>}
        </div>
    );
};
