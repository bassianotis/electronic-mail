// Strict threading and thread location (docs/architecture.md, rule 1).
//
// Threading: messages join only through Message-ID / References / In-Reply-To, never by
// subject (Thunderbird's mail.strict_threading default; Gmail's 2019 rule). Following JWZ,
// In-Reply-To is appended to References, and an "id" that is really one of the message's own
// addresses is ignored (notmuch's thread-fusing bug).
//
// Maintenance is incremental, like Thunderbird, Mailspring and notmuch: `thread_link` maps
// every known id (including ids of messages we do not have) to a thread, so a new message
// joins — and if it bridges two threads, merges — them as it arrives, and a reply that came
// before its parent still joins once the parent appears. Only affected threads are
// re-summarized. `rebuildThreads` recomputes everything from scratch; it is used for the first
// sync and as the oracle the incremental path is tested against.
//
// Identity: a thread's id is the key of its earliest message, so both paths agree.
// Location: a thread lives in the folder of its newest *received* message; Sent copies only
// join for display. Junk, Trash and Drafts copies never place a thread.
import type { Store } from '../store/store.ts';
import type { ChangeSet } from '../store/changes.ts';
import { HIDDEN_ROLES, LOCATION_ROLES, type FolderRole } from '../types.ts';

interface MessageRow {
    msg_key: string;
    in_reply_to: string | null;
    refs: string;
    addresses: string;
    subject: string | null;
    from_name: string | null;
    from_addr: string | null;
    date: string | null;
}

interface PlacementInfo {
    msg_key: string;
    folder: string;
    seen: number;
    role: FolderRole;
}

export interface ThreadRow {
    threadId: string;
    location: string | null;
    locationRole: FolderRole | null;
    latestDate: string | null;
    latestMsgKey: string;
    /**
     * The message a card shows (its date, preview and sort position): the newest one someone else
     * sent, so answering a conversation doesn't move it or replace its preview with your own words
     * (as the old app did). With nothing received, the newest message.
     */
    faceDate: string | null;
    faceMsgKey: string;
    subject: string | null;
    fromName: string | null;
    fromAddr: string | null;
    messageCount: number;
    unread: number;
    hasSent: boolean;
    latestSentDate: string | null;
}

const ROLE_PRIORITY: FolderRole[] = ['inbox', 'bucket', 'archive', 'other'];
const MESSAGE_COLUMNS = 'msg_key, in_reply_to, refs, addresses, subject, from_name, from_addr, date';

/** Above this many new messages (e.g. first sync), a full rebuild is cheaper than linking one by one. */
const FULL_REBUILD_THRESHOLD = 2000;

/** Applies a sync's or task's changes to threads. */
export function updateThreads(store: Store, account: string, changes: ChangeSet): { mode: 'none' | 'incremental' | 'full'; threads: number } {
    if (changes.empty) return { mode: 'none', threads: 0 };
    const hasThreads = !!store.db.prepare('SELECT 1 FROM thread WHERE account = ? LIMIT 1').get(account);
    if (!hasThreads || changes.inserted.size > FULL_REBUILD_THRESHOLD) {
        return { mode: 'full', threads: rebuildThreads(store, account).threads };
    }
    return store.transaction(() => {
        const { affected, removed } = linkNewMessages(store, account, [...changes.inserted]);
        const threadOfKey = store.db.prepare('SELECT thread_id FROM message WHERE account = ? AND msg_key = ?');
        for (const key of changes.touched) {
            const row = threadOfKey.get(account, key) as { thread_id: string | null } | undefined;
            if (row?.thread_id) affected.add(row.thread_id);
        }
        for (const t of changes.threads) affected.add(t);
        summarizeThreads(store, account, affected, removed);
        return { mode: 'incremental' as const, threads: affected.size };
    });
}

/** Recomputes every thread of an account from scratch. */
export function rebuildThreads(store: Store, account: string): { threads: number } {
    const messages = store.db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM message WHERE account = ?`)
        .all(account) as unknown as MessageRow[];
    const placementsByMsg = groupPlacements(store.db.prepare(`SELECT p.msg_key, p.folder, p.seen, f.role
        FROM placement p JOIN folder f ON f.account = p.account AND f.path = p.folder
        WHERE p.account = ?`).all(account) as unknown as PlacementInfo[]);

    const rows: ThreadRow[] = [];
    const threadOf = new Map<string, string>();
    const links: [string, string][] = [];
    for (const members of groupIntoThreads(messages)) {
        const threadId = rootOf(members);
        for (const m of members) {
            threadOf.set(m.msg_key, threadId);
            for (const id of linkedIds(m)) links.push([id, threadId]);
        }
        const row = summarize(threadId, members, placementsByMsg);
        if (row) rows.push(row);
    }
    applyPendingTasks(store, account, new Map(rows.map(r => [r.threadId, r])), key => threadOf.get(key));

    store.transaction(() => {
        store.db.prepare('DELETE FROM thread WHERE account = ?').run(account);
        store.db.prepare('DELETE FROM thread_link WHERE account = ?').run(account);
        const insertLink = store.db.prepare('INSERT OR REPLACE INTO thread_link (account, id, thread_id) VALUES (?, ?, ?)');
        for (const [id, threadId] of links) insertLink.run(account, id, threadId);
        const insert = insertThreadStatement(store);
        for (const r of rows) insertThreadRow(insert, account, r);
        const update = store.db.prepare('UPDATE message SET thread_id = ? WHERE account = ? AND msg_key = ? AND thread_id IS NOT ?');
        for (const [msgKey, threadId] of threadOf) update.run(threadId, account, msgKey, threadId);
    });
    return { threads: rows.length };
}

/** Union-find over message keys and the ids they reference. Exported for unit tests. */
export function groupIntoThreads<T extends Pick<MessageRow, 'msg_key' | 'in_reply_to' | 'refs' | 'addresses'>>(messages: T[]): T[][] {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
        let root = x;
        while (parent.get(root) !== root) root = parent.get(root)!;
        while (parent.get(x) !== root) { const next = parent.get(x)!; parent.set(x, root); x = next; }
        return root;
    };
    const add = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
    for (const m of messages) {
        add(m.msg_key);
        for (const id of linkedIds(m)) {
            add(id);
            const ra = find(m.msg_key), rb = find(id);
            if (ra !== rb) parent.set(ra, rb);
        }
    }
    const groups = new Map<string, T[]>();
    for (const m of messages) {
        const root = find(m.msg_key);
        const g = groups.get(root);
        if (g) g.push(m);
        else groups.set(root, [m]);
    }
    return [...groups.values()];
}

/** The message's own key plus the ids it points at, minus ids that are really its own addresses. */
function linkedIds(m: Pick<MessageRow, 'msg_key' | 'in_reply_to' | 'refs' | 'addresses'>): string[] {
    const own = new Set(JSON.parse(m.addresses) as string[]);
    const related = [...(JSON.parse(m.refs) as string[]), ...(m.in_reply_to ? [m.in_reply_to] : [])];
    return [m.msg_key, ...related.filter(id => id !== m.msg_key && !own.has(id.toLowerCase()))];
}

// ------------------------------------------------------------------ incremental path

function linkNewMessages(store: Store, account: string, keys: string[]): { affected: Set<string>; removed: Set<string> } {
    const affected = new Set<string>();
    const removed = new Set<string>();
    if (!keys.length) return { affected, removed };

    const getMessage = store.db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM message WHERE account = ? AND msg_key = ?`);
    const getLink = store.db.prepare('SELECT thread_id FROM thread_link WHERE account = ? AND id = ?');
    const setLink = store.db.prepare(`INSERT INTO thread_link (account, id, thread_id) VALUES (?, ?, ?)
        ON CONFLICT (account, id) DO UPDATE SET thread_id = excluded.thread_id`);
    const relabel = (from: string, to: string) => {
        store.db.prepare('UPDATE thread_link SET thread_id = ? WHERE account = ? AND thread_id = ?').run(to, account, from);
        store.db.prepare('UPDATE message SET thread_id = ? WHERE account = ? AND thread_id = ?').run(to, account, from);
    };

    for (const key of keys) {
        const m = getMessage.get(account, key) as MessageRow | undefined;
        if (!m) continue;
        const ids = linkedIds(m);
        const found = [...new Set(ids.map(id => (getLink.get(account, id) as { thread_id: string } | undefined)?.thread_id)
            .filter((t): t is string => !!t))];
        const target = found[0] ?? key;
        for (const other of found.slice(1)) { // this message bridges threads: merge them
            relabel(other, target);
            affected.delete(other);
            removed.add(other);
        }
        for (const id of ids) setLink.run(account, id, target);
        store.db.prepare('UPDATE message SET thread_id = ? WHERE account = ? AND msg_key = ?').run(target, account, key);
        affected.add(target);
    }

    // Canonical id = earliest message's key, so incremental and full rebuild always agree.
    for (const threadId of [...affected]) {
        const members = store.db.prepare('SELECT msg_key, date FROM message WHERE account = ? AND thread_id = ?')
            .all(account, threadId) as { msg_key: string; date: string | null }[];
        if (!members.length) continue;
        const root = rootOf(members);
        if (root !== threadId) {
            relabel(threadId, root);
            affected.delete(threadId);
            removed.add(threadId);
            affected.add(root);
        }
    }
    return { affected, removed };
}

function summarizeThreads(store: Store, account: string, threadIds: Set<string>, removed: Set<string>): void {
    const getMembers = store.db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM message WHERE account = ? AND thread_id = ?`);
    const getPlacements = store.db.prepare(`SELECT p.msg_key, p.folder, p.seen, f.role FROM placement p
        JOIN folder f ON f.account = p.account AND f.path = p.folder
        JOIN message m ON m.account = p.account AND m.msg_key = p.msg_key
        WHERE p.account = ? AND m.thread_id = ?`);
    const remove = store.db.prepare('DELETE FROM thread WHERE account = ? AND thread_id = ?');

    const rows = new Map<string, ThreadRow>();
    for (const threadId of threadIds) {
        const members = getMembers.all(account, threadId) as unknown as MessageRow[];
        const row = members.length
            ? summarize(threadId, members, groupPlacements(getPlacements.all(account, threadId) as unknown as PlacementInfo[]))
            : null;
        if (row) rows.set(threadId, row);
        else remove.run(account, threadId);
    }
    const threadOfKey = store.db.prepare('SELECT thread_id FROM message WHERE account = ? AND msg_key = ?');
    applyPendingTasks(store, account, rows, key => (threadOfKey.get(account, key) as { thread_id: string } | undefined)?.thread_id);

    for (const threadId of removed) if (!rows.has(threadId)) remove.run(account, threadId);
    const insert = insertThreadStatement(store);
    for (const r of rows.values()) insertThreadRow(insert, account, r);
}

// ------------------------------------------------------------------ shared

/**
 * Local phase of pending user actions (src/tasks): a queued move or read-state change shows
 * immediately and survives resyncs that happen before the server has performed it.
 */
function applyPendingTasks(store: Store, account: string, rows: Map<string, ThreadRow>, threadOf: (key: string) => string | undefined): void {
    const pending = store.db.prepare(`SELECT kind, payload FROM task WHERE account = ? AND status = 'pending' ORDER BY id`)
        .all(account) as { kind: string; payload: string }[];
    if (!pending.length) return;
    const roleOf = new Map((store.db.prepare('SELECT path, role FROM folder WHERE account = ?')
        .all(account) as { path: string; role: FolderRole }[]).map(r => [r.path, r.role]));
    for (const t of pending) {
        const p = JSON.parse(t.payload) as { msgKeys: string[]; to?: string; restoreTo?: string | null; seen?: boolean };
        const row = p.msgKeys.map(k => rows.get(threadOf(k) ?? '')).find(r => r !== undefined);
        if (!row) continue;
        if (t.kind === 'setSeen') {
            row.unread = p.seen ? 0 : Math.max(1, row.unread);
            continue;
        }
        const target = t.kind === 'moveThread' ? p.to : p.restoreTo;
        if (target === undefined) continue;
        row.location = target;
        row.locationRole = target ? roleOf.get(target) ?? null : null;
    }
}

function groupPlacements(placements: PlacementInfo[]): Map<string, PlacementInfo[]> {
    const byMsg = new Map<string, PlacementInfo[]>();
    for (const p of placements) {
        const list = byMsg.get(p.msg_key);
        if (list) list.push(p);
        else byMsg.set(p.msg_key, [p]);
    }
    return byMsg;
}

function summarize(threadId: string, members: MessageRow[], placementsByMsg: Map<string, PlacementInfo[]>): ThreadRow | null {
    const visible = members.filter(m => (placementsByMsg.get(m.msg_key) ?? []).some(p => !HIDDEN_ROLES.has(p.role)));
    if (!visible.length) return null;
    const newestFirst = [...visible].sort((a, b) => compareDate(b, a));

    const received = newestFirst.filter(m => (placementsByMsg.get(m.msg_key) ?? []).some(p => LOCATION_ROLES.has(p.role)));
    const sent = newestFirst.filter(m => (placementsByMsg.get(m.msg_key) ?? []).some(p => p.role === 'sent'));

    let location: string | null = null;
    let locationRole: FolderRole | null = null;
    if (received.length) {
        const where = (placementsByMsg.get(received[0].msg_key) ?? [])
            .filter(p => LOCATION_ROLES.has(p.role))
            .sort((a, b) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role) || a.folder.localeCompare(b.folder))[0];
        location = where.folder;
        locationRole = where.role;
    }

    const unread = received.filter(m => (placementsByMsg.get(m.msg_key) ?? [])
        .some(p => LOCATION_ROLES.has(p.role) && !p.seen)).length;
    const face = received[0] ?? newestFirst[0];

    return {
        threadId,
        location,
        locationRole,
        latestDate: newestFirst[0].date,
        latestMsgKey: newestFirst[0].msg_key,
        faceDate: face.date,
        faceMsgKey: face.msg_key,
        subject: face.subject,
        fromName: face.from_name,
        fromAddr: face.from_addr,
        messageCount: visible.length,
        unread,
        hasSent: sent.length > 0,
        latestSentDate: sent[0]?.date ?? null,
    };
}

function insertThreadStatement(store: Store) {
    return store.db.prepare(`INSERT OR REPLACE INTO thread (account, thread_id, location, location_role, latest_date,
        latest_msg_key, face_date, face_msg_key, subject, from_name, from_addr, message_count, unread, has_sent, latest_sent_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
}

function insertThreadRow(insert: ReturnType<typeof insertThreadStatement>, account: string, r: ThreadRow): void {
    insert.run(account, r.threadId, r.location, r.locationRole, r.latestDate, r.latestMsgKey, r.faceDate, r.faceMsgKey, r.subject,
        r.fromName, r.fromAddr, r.messageCount, r.unread, r.hasSent ? 1 : 0, r.latestSentDate);
}

function rootOf(members: Pick<MessageRow, 'date' | 'msg_key'>[]): string {
    return members.reduce((a, b) => (compareDate(a, b) <= 0 ? a : b)).msg_key;
}

/** Oldest first; undated messages sort last; ties broken by key for determinism. */
function compareDate(a: Pick<MessageRow, 'date' | 'msg_key'>, b: Pick<MessageRow, 'date' | 'msg_key'>): number {
    if (a.date !== b.date) {
        if (a.date === null) return 1;
        if (b.date === null) return -1;
        return a.date < b.date ? -1 : 1;
    }
    return a.msg_key < b.msg_key ? -1 : a.msg_key > b.msg_key ? 1 : 0;
}
