// Search: sender, subject and preview, across Inbox, buckets, Archive and Sent,
// answered from the local index (instant, never waits on the mail server). Results are
// conversations, newest first, like every other list; count and list share one WHERE clause.
import type { Store } from '../store/store.ts';
import { CARD_COLUMNS, CARD_JOIN, toCard, type ViewPage } from '../views/views.ts';

/**
 * Turns what the user typed into a safe FTS5 query: every word must appear (AND), the last one
 * as a prefix once it has two letters (search as you type), and no FTS5 syntax from the input
 * is ever interpreted. Measured on the real mailbox: specific searches take 1-2 ms; a two-letter
 * prefix matching thousands of conversations ~70-120 ms on a Mac.
 */
export function ftsQuery(input: string): string | null {
    const words = input.normalize('NFC').split(/\s+/).map(w => w.replace(/["*^():{}\[\]\\-]/g, '')).filter(Boolean);
    if (!words.length) return null;
    // A lone letter as a prefix would match most of the mailbox on the first keystroke.
    return words.map((w, i) => `"${w}"${i === words.length - 1 && [...w].length > 1 ? '*' : ''}`).join(' ');
}

export function search(store: Store, account: string, input: string, options: { location?: string | null; limit?: number; offset?: number } = {}): ViewPage {
    const match = ftsQuery(input);
    if (!match) return { count: 0, unreadThreads: 0, threads: [] };
    const where = `t.account = ? AND t.thread_id IN (
            SELECT m2.thread_id FROM message_fts JOIN message m2 ON m2.rowid = message_fts.rowid
            WHERE message_fts MATCH ? AND m2.account = ?)
        AND ${options.location ? 't.location = ?' : "(t.location_role IN ('inbox', 'bucket', 'archive') OR t.has_sent = 1)"}`;
    const params: (string | number)[] = [account, match, account, ...(options.location ? [options.location] : [])];
    const totals = store.db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(t.unread > 0), 0) AS unreadThreads FROM thread t WHERE ${where}`)
        .get(...params) as { count: number; unreadThreads: number };
    const threads = store.db.prepare(`SELECT ${CARD_COLUMNS} FROM thread t ${CARD_JOIN}
        WHERE ${where} ORDER BY t.face_date DESC, t.thread_id LIMIT ? OFFSET ?`)
        .all(...params, options.limit ?? 50, options.offset ?? 0).map(toCard);
    return { count: totals.count, unreadThreads: totals.unreadThreads, threads };
}
