// What the UI lists (docs/architecture.md, rule 2): every count comes from the same WHERE clause
// as the list it describes, so a number can never disagree with the cards under it.
import type { Store } from '../store/store.ts';

export interface ThreadCard {
    threadId: string;
    location: string | null;
    /** Date of the message the card shows: the newest one someone else sent (else the newest). */
    latestDate: string | null;
    subject: string | null;
    fromName: string | null;
    fromAddr: string | null;
    messageCount: number;
    unread: number;
    /** The message the card shows (see latestDate). */
    latestMsgKey: string;
    /** First ~200 characters of that message; null until fetched. */
    preview: string | null;
    /** You sent at least one message in it. With no location, it holds only mail you sent. */
    hasSent: boolean;
}

export interface ViewPage {
    count: number;
    unreadThreads: number;
    threads: ThreadCard[];
}

/** Columns of a ThreadCard, selected from `thread t` joined to its latest `message m`. */
export const CARD_COLUMNS = `t.thread_id AS threadId, t.location, t.face_date AS latestDate, t.subject,
    t.from_name AS fromName, t.from_addr AS fromAddr, t.message_count AS messageCount, t.unread,
    t.face_msg_key AS latestMsgKey, m.preview, t.has_sent AS hasSent`;

/** Joins the message a card shows (for its preview). */
export const CARD_JOIN = 'LEFT JOIN message m ON m.account = t.account AND m.msg_key = t.face_msg_key';

/** SQLite has no booleans: turn a selected row into a card. */
export function toCard(row: unknown): ThreadCard {
    const r = row as ThreadCard;
    return { ...r, hasSent: !!r.hasSent };
}

function page(store: Store, where: string, params: (string | number)[], order: string, limit: number, offset: number): ViewPage {
    const totals = store.db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(t.unread > 0), 0) AS unreadThreads
        FROM thread t WHERE ${where}`).get(...params) as { count: number; unreadThreads: number };
    const threads = store.db.prepare(`SELECT ${CARD_COLUMNS} FROM thread t ${CARD_JOIN}
        WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset).map(toCard);
    return { count: totals.count, unreadThreads: totals.unreadThreads, threads };
}

/**
 * Threads living in one folder: the Inbox, a bucket, or the Archive. `withSentOnly` adds the
 * conversations that hold only mail you sent (they live in no folder of their own); the old app
 * listed those in its Archive, and the Archive keeps doing so.
 */
export function folderView(store: Store, account: string, folder: string, limit = 50, offset = 0,
    options: { withSentOnly?: boolean } = {}): ViewPage {
    const where = options.withSentOnly
        ? 't.account = ? AND (t.location = ? OR (t.location IS NULL AND t.has_sent = 1))'
        : 't.account = ? AND t.location = ?';
    return page(store, where, [account, folder], 't.face_date DESC, t.thread_id', limit, offset);
}

/** Threads you have sent something in, newest sent first. */
export function sentView(store: Store, account: string, limit = 50, offset = 0): ViewPage {
    return page(store, 't.account = ? AND t.has_sent = 1', [account], 't.latest_sent_date DESC, t.thread_id', limit, offset);
}

/** Counts for every folder that currently holds threads (bucket dock, nav badges). */
export function folderCounts(store: Store, account: string): { location: string; role: string; count: number; unreadThreads: number }[] {
    return store.db.prepare(`SELECT location, location_role AS role, COUNT(*) AS count, COALESCE(SUM(unread > 0), 0) AS unreadThreads
        FROM thread WHERE account = ? AND location IS NOT NULL
        GROUP BY location, location_role ORDER BY location`).all(account) as never;
}

export interface ThreadMessage {
    msgKey: string;
    messageId: string | null;
    subject: string | null;
    fromName: string | null;
    fromAddr: string | null;
    date: string | null;
    preview: string | null;
    seen: boolean;
    sent: boolean;
    folders: { path: string; role: string }[];
    /**
     * The message it answers, when that's in this conversation: its In-Reply-To, else the last id
     * in its References that is here (the thread tree, docs/design/reading-navigation-spec.md §2).
     */
    parentKey: string | null;
}

/** A conversation's messages, oldest first, without copies that only exist in Junk/Trash/Drafts. */
export function threadDetail(store: Store, account: string, threadId: string): { thread: ThreadCard; messages: ThreadMessage[] } | null {
    const row = store.db.prepare(`SELECT ${CARD_COLUMNS} FROM thread t ${CARD_JOIN}
        WHERE t.account = ? AND t.thread_id = ?`).get(account, threadId);
    if (!row) return null;
    const thread = toCard(row);
    const rows = store.db.prepare(`SELECT m.msg_key, m.message_id, m.in_reply_to, m.refs, m.subject, m.from_name, m.from_addr, m.date, m.preview,
            p.folder, p.seen, f.role
        FROM message m
        JOIN placement p ON p.account = m.account AND p.msg_key = m.msg_key
        JOIN folder f ON f.account = p.account AND f.path = p.folder
        WHERE m.account = ? AND m.thread_id = ?
        ORDER BY m.date IS NULL, m.date, m.msg_key`).all(account, threadId) as {
            msg_key: string; message_id: string | null; in_reply_to: string | null; refs: string; subject: string | null;
            from_name: string | null; from_addr: string | null; date: string | null; preview: string | null; folder: string; seen: number; role: string;
        }[];
    const byKey = new Map<string, ThreadMessage>();
    const answers = new Map<string, string[]>(); // msg_key → the ids it answers, nearest first
    for (const r of rows) {
        let msg = byKey.get(r.msg_key);
        if (!msg) {
            msg = { msgKey: r.msg_key, messageId: r.message_id, subject: r.subject, fromName: r.from_name, fromAddr: r.from_addr,
                date: r.date, preview: r.preview, seen: true, sent: false, folders: [], parentKey: null };
            byKey.set(r.msg_key, msg);
            answers.set(r.msg_key, [r.in_reply_to, ...(JSON.parse(r.refs) as string[]).reverse()].filter((id): id is string => !!id).map(bare));
        }
        msg.folders.push({ path: r.folder, role: r.role });
        if (r.role === 'sent') msg.sent = true;
        else if (!r.seen && !['junk', 'trash', 'drafts'].includes(r.role)) msg.seen = false;
    }
    const messages = [...byKey.values()].filter(m => m.folders.some(f => !['junk', 'trash', 'drafts'].includes(f.role)));
    const keyOf = new Map(messages.filter(m => m.messageId).map(m => [bare(m.messageId!), m.msgKey]));
    for (const m of messages) {
        const parent = answers.get(m.msgKey)!.map(id => keyOf.get(id)).find(k => k && k !== m.msgKey);
        m.parentKey = parent ?? null;
    }
    return { thread, messages };
}

const bare = (id: string) => id.trim().replace(/^<|>$/g, '');

/** Every folder with its role and thread counts, including empty buckets (for the bucket dock). */
export function folderList(store: Store, account: string): { path: string; role: string; count: number; unreadThreads: number }[] {
    const counts = new Map(folderCounts(store, account).map(c => [c.location, c]));
    return (store.db.prepare('SELECT path, role FROM folder WHERE account = ? ORDER BY path').all(account) as { path: string; role: string }[])
        .map(f => ({ path: f.path, role: f.role, count: counts.get(f.path)?.count ?? 0, unreadThreads: counts.get(f.path)?.unreadThreads ?? 0 }));
}
