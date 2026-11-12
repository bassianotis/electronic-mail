/**
 * MailContext: the active account, its buckets and folders, and the actions that change
 * mail. Everything shown comes from the engine and is fetched again whenever the account's
 * state token changes (api/events.ts); nothing is counted or patched by hand here, so the
 * numbers on screen are always the engine's (docs/architecture.md, rule 2).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, acct, ApiError, downloadFile, errorText, paths, SESSION_RESTORED_EVENT } from '../api/client';
import { engineEvents, useAccountState } from '../api/events';
import { cancelMoving, markMoving, settleMoving } from '../api/moving';
import type { Account, BucketView, DraftSummary, FolderInfo, OutboxItem, SweepNotice } from '../api/types';
import type { Bucket } from '../store/mailStore';
import { bucketFromView } from '../utils/emailMapper';
import { formatCount } from '../utils/format';

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface Toast {
    id: number;
    message: ReactNode;
    tone?: 'info' | 'error';
    actions?: ToastAction[];
    /** Milliseconds before it goes away by itself; null keeps it until dealt with. */
    durationMs?: number | null;
}

export interface Folders {
    inbox: string;
    archive: string | null;
    sent: string | null;
    drafts: string | null;
}

/** An address, with its name if known. */
export type SendAddress = string | { name?: string | null; address: string };

export interface SendRequest {
    to: SendAddress[];
    cc: SendAddress[];
    bcc: SendAddress[];
    subject: string;
    html: string;
    text?: string;
    /** Message key being answered (the engine adds In-Reply-To and References). */
    replyTo?: string;
    /** Without replyTo: a continued draft's own threading headers, sent as they were saved. */
    inReplyTo?: string;
    references?: string[];
    /** Message key being forwarded (its attachments go along). */
    forwardOf?: string;
    /** Upload ids. */
    attachments?: string[];
    /** The draft this was written in; removed once the sent copy is saved. */
    draftKey?: string;
    /** Held this long before it goes, so it can still be taken back (Undo send). */
    holdMs?: number;
}

interface MailContextType {
    accounts: Account[];
    /** True once the engine has answered with the account list (an empty list means none yet). */
    accountsLoaded: boolean;
    /** The account list keeps failing to load (it is still being retried). */
    accountsFailing: boolean;
    activeAccountId: string | null;
    activeAccount: Account | null;
    setActiveAccountId: (id: string) => void;
    /** Loads the account list again; resolves to whether it loaded. */
    fetchAccounts: () => Promise<boolean>;

    folders: Folders;
    buckets: Bucket[];
    /** Conversations that have a reply draft waiting (the Draft badge). */
    draftThreadIds: Set<string>;
    drafts: DraftSummary[];

    addBucket: (label: string, color: string, emoji?: string, showBadge?: boolean, showOnHome?: boolean, autoArchiveDays?: number | null) => Promise<void>;
    updateBucket: (id: string, updates: Partial<Bucket>) => Promise<void>;
    deleteBucket: (id: string) => Promise<void>;
    reorderBuckets: (bucketIds: string[]) => Promise<void>;

    /** Moves a whole conversation to 'inbox', 'archive' or a bucket id. Resolves to the task id (for undo). */
    moveThread: (threadId: string, target: string) => Promise<number | null>;
    undoMove: (taskId: number) => Promise<void>;
    markThreadSeen: (threadId: string, seen?: boolean) => void;
    /** What to call a folder on screen: Inbox, a bucket's name, Archive, Sent. */
    folderLabel: (location: string | null, mailbox?: string) => string;
    /** 'inbox' | 'archive' | bucket id → folder path. */
    targetPath: (target: string) => string | null;
    /** Folder path → 'inbox' | 'archive' | bucket id (what the screens navigate by). */
    viewOf: (location: string | null) => string;

    /**
     * Sends from the given account (a composer keeps the account it was opened in), else the active
     * one. With `undo`, the notice reads "Sending…" with Undo for as long as the message is held.
     */
    /** The outbox item; null when refused (a notice says why); 'unreachable' when the server can't be reached (nothing said: the composer waits). */
    send: (message: SendRequest, accountId?: string, undo?: (item: OutboxItem) => void) => Promise<OutboxItem | null | 'unreachable'>;

    toasts: Toast[];
    showToast: (toast: Omit<Toast, 'id'>) => number;
    dismissToast: (id: number) => void;

    /** Saves a file the engine serves (an attachment, the settings export); trouble shows as a notice. */
    download: (url: string, fallbackName: string) => void;

    refreshData: () => Promise<void>;
}

const MailContext = createContext<MailContextType | undefined>(undefined);
const ACTIVE_KEY = 'activeAccountId';
const ACCOUNTS_RETRY_MS = 2_000;
const NO_FOLDERS: Folders = { inbox: 'INBOX', archive: null, sent: null, drafts: null };

export const MailProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [accountsLoaded, setAccountsLoaded] = useState(false);
    const [accountsFailing, setAccountsFailing] = useState(false);
    const accountFailures = useRef(0);
    const [activeAccountId, setActiveAccountIdState] = useState<string | null>(() => {
        try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
    });
    const [folders, setFolders] = useState<Folders>(NO_FOLDERS);
    const [bucketViews, setBucketViews] = useState<BucketView[]>([]);
    const [drafts, setDrafts] = useState<DraftSummary[]>([]);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastSeq = useRef(0);
    const stateToken = useAccountState(activeAccountId);

    // ---- toasts
    const dismissToast = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);
    const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
        const id = ++toastSeq.current;
        setToasts(prev => [...prev.slice(-2), { ...toast, id }]);
        const duration = toast.durationMs === undefined ? (toast.tone === 'error' ? 8000 : toast.actions?.length ? 6000 : 4000) : toast.durationMs;
        if (duration !== null) setTimeout(() => dismissToast(id), duration);
        return id;
    }, [dismissToast]);

    // ---- accounts
    const setActiveAccountId = useCallback((id: string) => {
        try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private window: fine */ }
        setActiveAccountIdState(id);
    }, []);

    // Resolves to whether the list loaded. A list that failed to load is not an empty one: the
    // screens keep waiting (they never show "add your first account" for it) while this retries.
    const fetchAccounts = useCallback(async (): Promise<boolean> => {
        try {
            const { accounts: list } = await api.get<{ accounts: Account[] }>('/accounts');
            setAccounts(list);
            setActiveAccountIdState(current => {
                if (current && list.some(a => a.id === current)) return current;
                const first = list[0]?.id ?? null;
                try { if (first) localStorage.setItem(ACTIVE_KEY, first); } catch { /* fine */ }
                return first;
            });
            accountFailures.current = 0;
            setAccountsFailing(false);
            setAccountsLoaded(true);
            return true;
        } catch (err) {
            console.error('Failed to fetch accounts:', err);
            if (++accountFailures.current >= 3) setAccountsFailing(true);
            return false;
        }
    }, []);

    useEffect(() => {
        engineEvents.connect();
        let alive = true;
        let retry: ReturnType<typeof setTimeout> | undefined;
        const load = async () => {
            if (await fetchAccounts() || !alive) return;
            retry = setTimeout(() => void load(), ACCOUNTS_RETRY_MS);
        };
        void load();
        const offAccounts = engineEvents.onAccounts(() => void fetchAccounts());
        return () => {
            alive = false;
            clearTimeout(retry);
            offAccounts();
            engineEvents.disconnect();
        };
    }, [fetchAccounts]);

    // ---- the active account's folders, buckets, drafts (whenever anything changes: saving or
    // deleting a draft changes the state too, so Up next always has the current drafts) and rules
    // A late answer for an account that's no longer open is dropped: otherwise, after a quick switch, the
    // dock could show (and a drag file into) the other account's buckets.
    const openAccount = useRef(activeAccountId);
    const loadAccountData = useCallback(async (accountId: string) => {
        const [f, b, d] = await Promise.allSettled([
            api.get<{ folders: FolderInfo[] }>(`${acct(accountId)}/folders`),
            api.get<{ buckets: BucketView[] }>(`${acct(accountId)}/buckets`),
            api.get<{ drafts: DraftSummary[] }>(`${acct(accountId)}/drafts`),
        ]);
        if (openAccount.current !== accountId) return;
        if (f.status === 'fulfilled') {
            const byRole = (role: string) => f.value.folders.find(x => x.role === role)?.path ?? null;
            setFolders({ inbox: byRole('inbox') ?? 'INBOX', archive: byRole('archive'), sent: byRole('sent'), drafts: byRole('drafts') });
        }
        if (b.status === 'fulfilled') setBucketViews(b.value.buckets);
        if (d.status === 'fulfilled') setDrafts(d.value.drafts);
    }, []);

    useEffect(() => {
        openAccount.current = activeAccountId;
        setFolders(NO_FOLDERS);
        setBucketViews([]);
        setDrafts([]);
    }, [activeAccountId]);

    useEffect(() => {
        if (activeAccountId) void loadAccountData(activeAccountId);
    }, [activeAccountId, stateToken, loadAccountData]);

    const refreshData = useCallback(async () => {
        await fetchAccounts();
        if (activeAccountId) await loadAccountData(activeAccountId);
    }, [fetchAccounts, activeAccountId, loadAccountData]);

    // Logged in again after the session ended: whatever failed to load meanwhile loads again.
    useEffect(() => {
        const reload = () => void refreshData();
        window.addEventListener(SESSION_RESTORED_EVENT, reload);
        return () => window.removeEventListener(SESSION_RESTORED_EVENT, reload);
    }, [refreshData]);

    const buckets = useMemo(() => bucketViews.map(bucketFromView), [bucketViews]);
    const draftThreadIds = useMemo(() => new Set(drafts.map(d => d.threadId).filter((t): t is string => !!t)), [drafts]);
    const activeAccount = accounts.find(a => a.id === activeAccountId) ?? null;

    // ---- naming folders
    const targetPath = useCallback((target: string) => {
        if (target === 'inbox') return folders.inbox;
        if (target === 'archive') return folders.archive;
        return target;
    }, [folders]);

    const viewOf = useCallback((location: string | null) => {
        if (!location || location === folders.archive) return 'archive';
        if (location === folders.inbox) return 'inbox';
        return buckets.some(b => b.id === location) ? location : 'archive';
    }, [folders, buckets]);

    const folderLabel = useCallback((location: string | null, mailbox?: string) => {
        if (!location) return mailbox === 'Sent' ? 'Sent' : 'Archive';
        if (location === folders.inbox) return 'Inbox';
        if (location === folders.archive) return 'Archive';
        return buckets.find(b => b.id === location)?.label ?? location.split(/[./]/).pop() ?? location;
    }, [folders, buckets]);

    // ---- conversations
    const moveThread = useCallback(async (threadId: string, target: string) => {
        if (!activeAccountId) return null;
        const to = targetPath(target);
        if (!to) {
            showToast({ message: 'This account has no Archive folder yet', tone: 'error' });
            return null;
        }
        markMoving(threadId); // gone from every list at once
        try {
            const r = await api.post<{ taskId: number; state: string }>(`${paths.thread(activeAccountId, threadId)}/move`, { to });
            settleMoving(threadId);
            engineEvents.noteState(activeAccountId, r.state);
            return r.taskId;
        } catch (err) {
            cancelMoving(threadId);
            showToast({ message: `Couldn't move it: ${errorText(err)}`, tone: 'error' });
            return null;
        }
    }, [activeAccountId, targetPath, showToast]);

    const undoMove = useCallback(async (taskId: number) => {
        if (!activeAccountId) return;
        try {
            const r = await api.post<{ undoTaskId: number | null; state: string }>(`${acct(activeAccountId)}/tasks/${taskId}/undo`);
            engineEvents.noteState(activeAccountId, r.state);
        } catch (err) {
            showToast({ message: `Couldn't undo: ${errorText(err)}`, tone: 'error' });
        }
    }, [activeAccountId, showToast]);

    const markThreadSeen = useCallback((threadId: string, seen = true) => {
        if (!activeAccountId) return;
        const accountId = activeAccountId;
        api.post<{ state: string }>(`${paths.thread(accountId, threadId)}/seen`, { seen })
            .then(r => engineEvents.noteState(accountId, r.state))
            .catch(err => console.error('Failed to mark as read:', err));
    }, [activeAccountId]);

    // A move the server refused is rolled back by the engine; say so instead of failing silently.
    useEffect(() => engineEvents.onTask(t => {
        if (t.status === 'failed') showToast({ message: `A move didn't go through: ${t.error ?? 'the mail server refused it'}`, tone: 'error' });
    }), [showToast]);

    // ---- buckets and rules
    const addBucket = useCallback(async (label: string, color: string, emoji?: string, showBadge?: boolean, showOnHome?: boolean, autoArchiveDays?: number | null) => {
        if (!activeAccountId) return;
        try {
            await api.post(`${acct(activeAccountId)}/buckets`, { name: label, color, emoji: emoji || null, showBadge: !!showBadge, showOnHome: !!showOnHome, autoArchiveDays: autoArchiveDays ?? null });
            await loadAccountData(activeAccountId);
        } catch (err) {
            showToast({ message: `Couldn't create the bucket: ${errorText(err)}`, tone: 'error' });
        }
    }, [activeAccountId, loadAccountData, showToast]);

    const updateBucket = useCallback(async (id: string, updates: Partial<Bucket>) => {
        const bucket = buckets.find(b => b.id === id);
        if (!activeAccountId || !bucket) return;
        const body: Record<string, unknown> = {};
        if (updates.label !== undefined && updates.label !== bucket.label) body.name = updates.label;
        if (updates.color !== undefined) body.color = updates.color;
        if (updates.emoji !== undefined || 'emoji' in updates) body.emoji = updates.emoji || null;
        if (updates.showBadge !== undefined) body.showBadge = !!updates.showBadge;
        if (updates.showOnHome !== undefined) body.showOnHome = !!updates.showOnHome;
        if (updates.autoArchiveDays !== undefined) body.autoArchiveDays = updates.autoArchiveDays;
        try {
            await api.patch(paths.bucket(activeAccountId, bucket.label), body);
            await loadAccountData(activeAccountId);
        } catch (err) {
            showToast({ message: `Couldn't change the bucket: ${errorText(err)}`, tone: 'error' });
        }
    }, [activeAccountId, buckets, loadAccountData, showToast]);

    // After a bucket's auto-archive swept (feature batch 1), once: "Archived 14 older threads from
    // Reads", with Undo for the whole batch (none once it's over 7 days old).
    const shownSweeps = useRef(new Set<number>());
    useEffect(() => {
        if (!activeAccountId) return;
        const accountId = activeAccountId;
        api.get<{ notice: SweepNotice | null }>(`${acct(accountId)}/auto-archived`).then(({ notice }) => {
            if (!notice || notice.ids.every(id => shownSweeps.current.has(id))) return;
            notice.ids.forEach(id => shownSweeps.current.add(id));
            const items = `${formatCount(notice.count)} older thread${notice.count === 1 ? '' : 's'}`;
            const undo = async () => {
                try {
                    const r = await api.post<{ state: string }>(`${acct(accountId)}/auto-archived/undo`, { ids: notice.ids });
                    engineEvents.noteState(accountId, r.state);
                } catch (err) {
                    showToast({ message: `Couldn't undo: ${errorText(err)}`, tone: 'error' });
                }
            };
            showToast({
                message: notice.buckets.length === 1
                    ? <>Archived {items} from <strong>{notice.buckets[0]}</strong></>
                    : <>Archived {items} from {notice.buckets.length} buckets</>,
                actions: notice.undoable ? [{ label: 'Undo', onClick: () => void undo() }] : undefined,
                durationMs: 10_000,
            });
            void api.post(`${acct(accountId)}/auto-archived/seen`, { ids: notice.ids }).catch(() => { /* shown again next time */ });
        }).catch(() => { /* asked again at the next change */ });
    }, [activeAccountId, stateToken, showToast]);

    const deleteBucket = useCallback(async (id: string) => {
        const bucket = buckets.find(b => b.id === id);
        if (!activeAccountId || !bucket) return;
        try {
            const r = await api.del<{ movedToArchive: number }>(paths.bucket(activeAccountId, bucket.label));
            await loadAccountData(activeAccountId);
            showToast({ message: r.movedToArchive ? `Deleted ${bucket.label}; its mail is in the Archive.` : `Deleted ${bucket.label}.` });
        } catch (err) {
            showToast({ message: `Couldn't delete the bucket: ${errorText(err)}`, tone: 'error' });
        }
    }, [activeAccountId, buckets, loadAccountData, showToast]);

    const reorderBuckets = useCallback(async (bucketIds: string[]) => {
        if (!activeAccountId) return;
        const names = bucketIds.map(id => buckets.find(b => b.id === id)?.label).filter((n): n is string => !!n);
        // Show the new order while dragging; the engine's answer replaces it.
        setBucketViews(prev => names.map((n, i) => ({ ...prev.find(b => b.name === n)!, sortOrder: i })));
        try {
            const r = await api.put<{ buckets: BucketView[] }>(`${acct(activeAccountId)}/bucket-order`, { names });
            setBucketViews(r.buckets);
        } catch (err) {
            showToast({ message: `Couldn't save the new order: ${errorText(err)}`, tone: 'error' });
            await loadAccountData(activeAccountId);
        }
    }, [activeAccountId, buckets, loadAccountData, showToast]);

    // ---- sending (docs/architecture.md, rule 9: never silent)
    const subjects = useRef(new Map<string, string>());
    const describeItem = (id: string) => {
        const subject = subjects.current.get(id);
        return subject ? `“${subject}”` : 'Your message';
    };

    const retry = useCallback(async (accountId: string, id: string) => {
        try {
            await api.post(`${acct(accountId)}/outbox/${encodeURIComponent(id)}/retry`);
        } catch (err) {
            showToast({ message: `Couldn't send it again: ${errorText(err)}`, tone: 'error' });
        }
    }, [showToast]);

    const discard = useCallback(async (accountId: string, id: string) => {
        try {
            await api.del(`${acct(accountId)}/outbox/${encodeURIComponent(id)}`);
        } catch (err) {
            showToast({ message: `Couldn't discard it: ${errorText(err)}`, tone: 'error' });
        }
    }, [showToast]);

    const noticeFor = useCallback((accountId: string, id: string, status: OutboxItem['status'], error: string | null) => {
        const what = describeItem(id);
        if (status === 'sent') showToast({ message: `${what} was sent` });
        else if (status === 'failed') {
            showToast({
                message: `${what} couldn't be sent: ${error ?? 'the mail server refused it'}`, tone: 'error', durationMs: null,
                actions: [{ label: 'Try again', onClick: () => void retry(accountId, id) }, { label: 'Discard', onClick: () => void discard(accountId, id) }],
            });
        } else if (status === 'uncertain') {
            showToast({
                message: `${what} may or may not have been sent (the app stopped while sending). Check with the recipient before sending again.`,
                tone: 'error', durationMs: null,
                actions: [{ label: 'Send again', onClick: () => void retry(accountId, id) }, { label: 'Discard', onClick: () => void discard(accountId, id) }],
            });
        }
    }, [retry, discard, showToast]);

    useEffect(() => engineEvents.onOutbox(e => noticeFor(e.accountId, e.id, e.status, e.error)), [noticeFor]);

    // Anything left failed or uncertain from before (e.g. the app was restarted) is raised once.
    const raisedOutbox = useRef(new Set<string>());
    useEffect(() => {
        for (const a of accounts) {
            api.get<{ items: OutboxItem[] }>(`${acct(a.id)}/outbox`).then(({ items }) => {
                for (const item of items) {
                    if (item.subject) subjects.current.set(item.id, item.subject);
                    if ((item.status === 'failed' || item.status === 'uncertain') && !raisedOutbox.current.has(item.id)) {
                        raisedOutbox.current.add(item.id);
                        noticeFor(a.id, item.id, item.status, item.error);
                    }
                }
            }).catch(() => { /* the account may be gone */ });
        }
    }, [accounts, noticeFor]);

    const send = useCallback(async (message: SendRequest, accountId?: string, undo?: (item: OutboxItem) => void) => {
        const from = accountId ?? activeAccountId;
        if (!from) return null;
        try {
            const { item } = await api.post<{ item: OutboxItem }>(`${acct(from)}/outbox`, message);
            subjects.current.set(item.id, message.subject || '(no subject)');
            if (undo) showToast({ message: 'Sending…', actions: [{ label: 'Undo', onClick: () => undo(item) }], durationMs: message.holdMs ?? 5000 });
            else showToast({ message: `Sending ${describeItem(item.id)}…` });
            return item;
        } catch (err) {
            if (err instanceof ApiError && err.status === 0) return 'unreachable';
            showToast({ message: `Couldn't send: ${errorText(err)}`, tone: 'error' });
            return null;
        }
    }, [activeAccountId, showToast]);

    const download = useCallback((url: string, fallbackName: string) => {
        downloadFile(url, fallbackName).catch(err => {
            if (err instanceof ApiError && err.status === 401) return; // the login screen is already up
            showToast({ message: `Couldn't download ${fallbackName}: ${errorText(err)}`, tone: 'error' });
        });
    }, [showToast]);

    const value: MailContextType = {
        accounts, accountsLoaded, accountsFailing, activeAccountId, activeAccount, setActiveAccountId, fetchAccounts,
        folders, buckets, draftThreadIds, drafts,
        addBucket, updateBucket, deleteBucket, reorderBuckets,
        moveThread, undoMove, markThreadSeen, folderLabel, targetPath, viewOf,
        send,
        toasts, showToast, dismissToast,
        download,
        refreshData,
    };

    return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
};

export const useMail = () => {
    const context = useContext(MailContext);
    if (!context) {
        throw new Error('useMail must be used within a MailProvider');
    }
    return context;
};
