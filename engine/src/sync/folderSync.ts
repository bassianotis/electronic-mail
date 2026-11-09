// Keeps the cache's view of each folder identical to the server (docs/architecture.md, rule 4).
// Order per RFC 7162 / RFC 4549:
//   1. compare UIDVALIDITY first; a change means the cached folder is meaningless (reset)
//   2. fetch only what changed since the stored HIGHESTMODSEQ (new messages + flag changes)
//   3. learn deletions from QRESYNC VANISHED, or by comparing UID lists when QRESYNC is off
//   4. save the new checkpoint in the same transaction as the changes, only once complete
// Every folder is opened read-only (EXAMINE): syncing never changes anything on the server.
import type { ExpungeEvent, FetchMessageObject, FetchQueryObject, ImapFlow } from 'imapflow';
import type { Store } from '../store/store.ts';
import { ChangeSet } from '../store/changes.ts';
import { folderRole } from '../imap/roles.ts';
import { firstId, idList, messageKey } from './messageKey.ts';

export type SyncMode = 'full' | 'reset' | 'incremental' | 'unchanged';

export interface FolderSyncResult {
    path: string;
    mode: SyncMode;
    fetched: number;
    vanished: number;
}

const WRITE_BATCH = 500;

const FETCH_QUERY: FetchQueryObject = {
    uid: true, flags: true, envelope: true, size: true, internalDate: true,
    headers: ['references'],
};

export interface AccountSyncResult {
    folders: FolderSyncResult[];
    changes: ChangeSet;
}

interface ServerFolder {
    path: string;
    uidValidity: string | null;
    highestModseq: string | null;
}

/** Full pass: every selectable folder is synced (cheap for folders that did not change). */
export async function syncAccount(client: ImapFlow, store: Store, account: string): Promise<AccountSyncResult> {
    const changes = new ChangeSet();
    const folders: FolderSyncResult[] = [];
    for (const f of await refreshFolders(client, store, account, changes, false)) {
        folders.push(await syncFolder(client, store, account, f.path, changes));
    }
    prune(store, account, changes);
    return { folders, changes };
}

/**
 * Background check (Mailspring's background worker): one LIST-STATUS round trip tells which
 * folders moved; only those are synced. ~1 s for both accounts on the Pi when nothing changed.
 */
export async function syncChangedFolders(client: ImapFlow, store: Store, account: string): Promise<AccountSyncResult> {
    const changes = new ChangeSet();
    const folders: FolderSyncResult[] = [];
    // STATUS should not be used on the selected mailbox (RFC 3501 6.3.10).
    if (client.mailbox) await client.mailboxClose();
    for (const f of await refreshFolders(client, store, account, changes, true)) {
        const cached = store.getFolder(account, f.path);
        const moved = !cached?.uid_validity || !f.highestModseq
            || cached.uid_validity !== f.uidValidity || cached.highest_modseq !== f.highestModseq;
        if (moved) folders.push(await syncFolder(client, store, account, f.path, changes));
    }
    prune(store, account, changes);
    return { folders, changes };
}

/** Updates the cached folder list (new, renamed, deleted folders) and returns the selectable ones. */
async function refreshFolders(client: ImapFlow, store: Store, account: string, changes: ChangeSet, withStatus: boolean): Promise<ServerFolder[]> {
    const ns = client.namespace ?? { prefix: '', delimiter: '/' };
    const namespace = { prefix: ns.prefix ?? '', delimiter: ns.delimiter ?? '/' };
    const listed = (await client.list(withStatus ? { statusQuery: { uidValidity: true, highestModseq: true } } : undefined))
        .filter(f => !f.flags?.has('\\Noselect') && !f.flags?.has('\\NonExistent'));

    const onServer = new Set(listed.map(f => f.path));
    store.transaction(() => {
        for (const cached of store.listFolders(account)) {
            if (!onServer.has(cached.path)) for (const k of store.removeFolder(account, cached.path)) changes.touched.add(k);
        }
        for (const f of listed) store.upsertFolderRole(account, f.path, folderRole(f.path, f.specialUse, namespace));
    });
    return listed.map(f => ({
        path: f.path,
        uidValidity: f.status?.uidValidity?.toString() ?? null,
        highestModseq: f.status?.highestModseq?.toString() ?? null,
    }));
}

function prune(store: Store, account: string, changes: ChangeSet): void {
    store.transaction(() => {
        for (const t of store.pruneOrphanMessages(account)) changes.threads.add(t);
    });
}

export async function syncFolder(client: ImapFlow, store: Store, account: string, path: string, changes: ChangeSet = new ChangeSet()): Promise<FolderSyncResult> {
    const cached = store.getFolder(account, path);
    const qresync = client.enabled.has('QRESYNC') && !!cached?.uid_validity && !!cached?.highest_modseq;

    // QRESYNC parameters only apply on a fresh SELECT/EXAMINE, and a fresh select also
    // flushes a stale view of the folder (Mailspring: send NOOP / reselect before reading).
    if (client.mailbox && client.mailbox.path === path) await client.mailboxClose();

    const vanished = new Set<number>();
    const onExpunge = (e: ExpungeEvent) => {
        if (e.path === path && e.vanished && e.uid) vanished.add(e.uid);
    };
    client.on('expunge', onExpunge);

    const lock = await client.getMailboxLock(path, qresync
        ? { readOnly: true, uidValidity: cached!.uid_validity!, changedSince: cached!.highest_modseq! }
        : { readOnly: true });
    try {
        const box = client.mailbox;
        if (!box) throw new Error(`mailbox ${path} not open`);
        const uidValidity = box.uidValidity.toString();
        const highestModseq = box.highestModseq?.toString() ?? null;

        let mode: SyncMode;
        if (!cached?.uid_validity) mode = 'full';
        else if (cached.uid_validity !== uidValidity) mode = 'reset';
        else if (highestModseq && cached.highest_modseq === highestModseq && vanished.size === 0) mode = 'unchanged';
        else mode = 'incremental';

        // Write as messages stream in (batches of WRITE_BATCH), so memory stays flat however big the
        // folder is (holding a 15,000-message INBOX cost ~400 MB). The checkpoint is saved only at
        // the end: an interrupted sync simply runs again, and every write is an idempotent upsert.
        if (mode === 'reset') store.transaction(() => { for (const k of store.resetFolder(account, path)) changes.touched.add(k); });
        // A full listing is authoritative: afterwards, cached messages it did not contain are gone.
        const seen = mode === 'full' || mode === 'reset' ? new Set<number>() : null;
        const missingId: FetchMessageObject[] = [];
        let fetched = 0;
        let batch: FetchMessageObject[] = [];
        const arrivals = mode === 'incremental' && path === 'INBOX';
        const write = (messages: FetchMessageObject[], rawHeaders?: Map<number, Buffer>) => {
            if (!messages.length) return;
            store.transaction(() => {
                for (const m of messages) {
                    const facts = toFacts(m, rawHeaders?.get(m.uid) ?? null);
                    if (store.insertMessage(account, facts)) {
                        changes.inserted.add(facts.msgKey);
                        if (arrivals) changes.arrivedInInbox.add(facts.msgKey);
                    }
                    changes.touched.add(facts.msgKey);
                    store.upsertPlacement(account, path, {
                        uid: m.uid,
                        msgKey: facts.msgKey,
                        flags: persistentFlags(m.flags),
                        modseq: m.modseq?.toString() ?? null,
                    });
                }
            });
        };

        if (mode !== 'unchanged' && box.exists > 0) {
            const options = mode === 'incremental' && cached?.highest_modseq
                ? { uid: true, changedSince: BigInt(cached.highest_modseq) }
                : { uid: true };
            for await (const m of client.fetch('1:*', FETCH_QUERY, options)) {
                fetched++;
                seen?.add(m.uid);
                // Messages without a Message-ID need their full header block for a stable key,
                // which takes another command: collect them (rare) and handle them afterwards.
                if (!firstId(m.envelope?.messageId)) missingId.push(m);
                else batch.push(m);
                if (batch.length >= WRITE_BATCH) { write(batch); batch = []; }
            }
            write(batch);
            batch = [];
        }

        // Without QRESYNC, deletions are only visible by comparing UID lists (deep scan).
        if (mode === 'incremental' && !qresync) {
            const serverUids = new Set((await client.search({ all: true }, { uid: true })) || []);
            for (const uid of store.folderUids(account, path)) if (!serverUids.has(uid)) vanished.add(uid);
        }

        const rawHeaders = new Map<number, Buffer>();
        if (missingId.length) {
            for await (const m of client.fetch(missingId.map(m => m.uid).join(','), { uid: true, headers: true }, { uid: true })) {
                if (m.headers) rawHeaders.set(m.uid, m.headers);
            }
        }
        write(missingId, rawHeaders);

        store.transaction(() => {
            for (const k of store.deletePlacements(account, path, [...vanished])) changes.touched.add(k);
            if (seen) {
                const stale = store.folderUids(account, path).filter(uid => !seen.has(uid));
                for (const k of store.deletePlacements(account, path, stale)) changes.touched.add(k);
            }
            store.saveCheckpoint(account, path, uidValidity, highestModseq, box.uidNext ?? null);
        });

        return { path, mode, fetched, vanished: vanished.size };
    } finally {
        lock.release();
        client.off('expunge', onExpunge);
    }
}

function toFacts(m: FetchMessageObject, rawHeaders: Buffer | null) {
    const e = m.envelope ?? {};
    const messageId = firstId(e.messageId);
    const addresses = [...(e.from ?? []), ...(e.to ?? []), ...(e.cc ?? [])]
        .map(a => a.address?.toLowerCase())
        .filter((a): a is string => !!a);
    return {
        msgKey: messageKey(messageId, rawHeaders),
        messageId,
        inReplyTo: firstId(e.inReplyTo),
        refs: idList(referencesHeader(m.headers)),
        addresses,
        subject: e.subject ?? null,
        fromName: e.from?.[0]?.name || null,
        fromAddr: e.from?.[0]?.address?.toLowerCase() ?? null,
        // Real mail has unparseable Date headers (9 in the live mailboxes): fall back to arrival time.
        date: isoDate(e.date) ?? isoDate(m.internalDate),
        size: m.size ?? null,
    };
}

// \Recent is per-session state, not a property of the message (dropped in IMAP4rev2):
// two clients see different values, so storing it would make cache and server disagree.
function persistentFlags(flags: Set<string> | undefined): string[] {
    return [...(flags ?? [])].filter(f => f !== '\\Recent');
}

function referencesHeader(headers: Buffer | undefined): string | null {
    if (!headers) return null;
    const unfolded = headers.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
    return unfolded.match(/^references:(.*)$/im)?.[1] ?? null;
}

function isoDate(value: Date | string | undefined): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Daily safety net (Mailspring's "deep scan"): compare each folder's full UID list with the
 * cache. Any difference means an earlier sync missed something; that folder is rebuilt from
 * scratch. Returns the folders that had to be repaired (normally none).
 */
export async function verifyFolders(client: ImapFlow, store: Store, account: string, changes: ChangeSet): Promise<string[]> {
    const repaired: string[] = [];
    for (const folder of store.listFolders(account)) {
        if (!folder.uid_validity) continue;
        if (client.mailbox && client.mailbox.path === folder.path) await client.mailboxClose();
        const lock = await client.getMailboxLock(folder.path, { readOnly: true });
        let serverUids: number[];
        try {
            serverUids = (await client.search({ all: true }, { uid: true })) || [];
        } finally {
            lock.release();
        }
        const cached = new Set(store.folderUids(account, folder.path));
        const same = serverUids.length === cached.size && serverUids.every(uid => cached.has(uid));
        if (same) continue;
        store.transaction(() => { for (const k of store.resetFolder(account, folder.path)) changes.touched.add(k); });
        await syncFolder(client, store, account, folder.path, changes);
        repaired.push(folder.path);
    }
    return repaired;
}
