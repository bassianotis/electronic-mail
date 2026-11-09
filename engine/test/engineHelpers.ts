// Helpers for engine scenario tests against the Docker Dovecot harness.
import assert from 'node:assert/strict';
import type { ImapFlow } from 'imapflow';
import { connect, freshUser, rawMessage } from './helpers.mjs';
import { Store } from '../src/store/store.ts';
import { syncAccount, type FolderSyncResult } from '../src/sync/folderSync.ts';
import { rebuildThreads, updateThreads } from '../src/threads/threads.ts';

export { connect, freshUser, rawMessage };

export const FOLDERS = ['INBOX.Sent', 'INBOX.Drafts', 'INBOX.Archive', 'INBOX.Junk', 'INBOX.Trash', 'INBOX.Buckets.Reads'];

export interface World {
    user: string;
    account: string;
    store: Store;
    /** The engine's own connection (QRESYNC on), like production. */
    engine: ImapFlow;
    /** Another client changing the mailbox behind the engine's back. */
    phone: ImapFlow;
    sync(): Promise<FolderSyncResult[]>;
    close(): Promise<void>;
}

export async function world(): Promise<World> {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS) await phone.mailboxCreate(f);
    const engine: ImapFlow = await connect(user, { qresync: true });
    const store = new Store(':memory:');
    const account = 'acct-1';
    return {
        user, account, store, engine, phone,
        async sync() {
            const { folders, changes } = await syncAccount(engine, store, account);
            updateThreads(store, account, changes);
            return folders;
        },
        async close() {
            await engine.logout().catch(() => {});
            await phone.logout().catch(() => {});
            store.close();
        },
    };
}

let seq = 0;
/** Appends a message; returns its Message-ID (without brackets) or null. */
export async function deliver(client: ImapFlow, folder: string, opts: {
    id?: string | null; subject?: string; from?: string; inReplyTo?: string; references?: string;
    date?: Date; flags?: string[]; rawDate?: string;
} = {}): Promise<string | null> {
    seq++; // every delivery is a minute after the previous one, whatever ids the test chose
    const id = opts.id === null ? null : (opts.id ?? `m${seq}-${Date.now()}@test`);
    let raw = rawMessage({
        messageId: id ? `<${id}>` : undefined,
        subject: opts.subject ?? `Subject ${seq}`,
        from: opts.from,
        inReplyTo: opts.inReplyTo ? `<${opts.inReplyTo}>` : undefined,
        references: opts.references,
        date: opts.date ?? new Date(Date.UTC(2026, 0, 1) + seq * 60_000),
    });
    if (opts.rawDate) raw = raw.replace(/^Date: .*$/m, `Date: ${opts.rawDate}`);
    await client.append(folder, raw, opts.flags ?? []);
    return id;
}

/** Moves messages by UID on the "phone" connection. */
export async function phoneMove(phone: ImapFlow, from: string, uids: number[], to: string): Promise<void> {
    const lock = await phone.getMailboxLock(from);
    try {
        await phone.messageMove(uids.join(','), to, { uid: true });
    } finally {
        lock.release();
    }
}

/**
 * Close whatever folder is open, so the next read SELECTs afresh. A connection that keeps a
 * folder open without IDLE or NOOP sees a stale view (a Mailspring lesson): helpers that report
 * the server's truth must never read through one, or they could agree with a wrong cache.
 */
export async function fresh(client: ImapFlow): Promise<void> {
    if (client.mailbox) await client.mailboxClose();
}

export async function serverUids(client: ImapFlow, folder: string): Promise<number[]> {
    await fresh(client);
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
        return ((await client.search({ all: true }, { uid: true })) || []).sort((a, b) => a - b);
    } finally {
        lock.release();
    }
}

/** Rule 4's core assertion: for every folder, cached UIDs and flags equal the server's. */
export async function assertCacheMatchesServer(w: World): Promise<void> {
    const folders = (await w.phone.list()).filter(f => !f.flags?.has('\\Noselect') && !f.flags?.has('\\NonExistent'));
    for (const f of folders) {
        await fresh(w.phone);
        const lock = await w.phone.getMailboxLock(f.path, { readOnly: true });
        const server = new Map<number, string[]>();
        try {
            if (w.phone.mailbox && w.phone.mailbox.exists > 0) {
                for await (const m of w.phone.fetch('1:*', { uid: true, flags: true }, { uid: true })) {
                    server.set(m.uid, [...(m.flags ?? [])].filter(f => f !== '\\Recent').sort());
                }
            }
        } finally {
            lock.release();
        }
        const cached = new Map<number, string[]>(
            (w.store.db.prepare('SELECT uid, flags FROM placement WHERE account = ? AND folder = ?')
                .all(w.account, f.path) as { uid: number; flags: string }[])
                .map(r => [r.uid, (JSON.parse(r.flags) as string[]).sort()]),
        );
        assert.deepEqual(cached, server, `cache differs from server in ${f.path}`);
    }
}

export function threadOf(w: World, messageId: string): { thread_id: string; location: string | null; message_count: number; has_sent: number } {
    return w.store.db.prepare(`SELECT t.thread_id, t.location, t.message_count, t.has_sent FROM thread t
        JOIN message m ON m.account = t.account AND m.thread_id = t.thread_id
        WHERE m.account = ? AND m.msg_key = ?`).get(w.account, messageId) as never;
}

/** All thread rows of the account, in a stable order, for comparisons. */
export function threadTable(w: World): unknown[] {
    return w.store.db.prepare(`SELECT thread_id, location, location_role, latest_date, latest_msg_key, face_date, face_msg_key, subject,
        message_count, unread, has_sent, latest_sent_date FROM thread WHERE account = ? ORDER BY thread_id`).all(w.account);
}

/** The incremental thread state must equal a from-scratch rebuild (the oracle). */
export function assertIncrementalMatchesFull(w: World): void {
    const incremental = threadTable(w);
    const threadIds = w.store.db.prepare('SELECT msg_key, thread_id FROM message WHERE account = ? ORDER BY msg_key').all(w.account);
    rebuildThreads(w.store, w.account);
    assert.deepEqual(threadTable(w), incremental, 'incremental threads differ from a full rebuild');
    assert.deepEqual(w.store.db.prepare('SELECT msg_key, thread_id FROM message WHERE account = ? ORDER BY msg_key').all(w.account), threadIds);
}
