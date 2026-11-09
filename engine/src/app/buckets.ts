// Buckets (docs/architecture.md, rule 7): a bucket IS the folder Buckets/<name> on the mail server,
// so every client sees it; the app only remembers how it looks (color, emoji, order, badge),
// whether its mail also shows on home, and whether it archives its own old items.
// Create and rename are server operations (rename keeps every message in place); deleting a
// bucket first moves its mail to Archive (D18) and only then removes the empty folder.
import type { ImapFlow } from 'imapflow';
import type { AppDb } from './appDb.ts';
import type { Store } from '../store/store.ts';
import type { AccountWorker } from '../worker/accountWorker.ts';
import { bucketFolderName, bucketNameOf, bucketPath } from '../imap/roles.ts';
import { folderList } from '../views/views.ts';
import { MAX_DAYS, type AutoArchiveRule } from './autoArchive.ts';

export interface BucketView {
    name: string;
    path: string;
    color: string;
    emoji: string | null;
    sortOrder: number;
    showBadge: boolean;
    /** Its conversations also appear in Up next, above the Inbox. */
    showOnHome: boolean;
    /** "Archive items older than N days" (null: off). */
    autoArchiveDays: number | null;
    count: number;
    unreadThreads: number;
}

export interface Appearance {
    color?: string;
    emoji?: string | null;
    showBadge?: boolean;
    showOnHome?: boolean;
    autoArchiveDays?: number | null;
}

export class BucketError extends Error {}

const DEFAULT_COLOR = '#3b82f6';
const COLOR = /^#[0-9a-f]{6}$/i;
/** A line icon, stored by its lucide name in the emoji field ("icon:book-open"). */
const ICON = /^icon:[a-z0-9-]{1,40}$/;

export class Buckets {
    private readonly app: AppDb;
    private readonly store: Store;

    constructor(app: AppDb, store: Store) {
        this.app = app;
        this.store = store;
    }

    /** Bucket folders on the server, with their look and live counts, in the user's order. */
    list(accountId: string): BucketView[] {
        const meta = new Map((this.app.db.prepare('SELECT * FROM bucket_meta WHERE account_id = ?').all(accountId) as
            { name: string; color: string; emoji: string | null; sort_order: number; show_badge: number; show_on_home: number; auto_archive_days: number | null }[])
            .map(m => [m.name, m]));
        return folderList(this.store, accountId)
            .filter(f => f.role === 'bucket')
            .map(f => {
                const name = nameOf(f.path);
                const m = meta.get(name);
                return {
                    name, path: f.path, count: f.count, unreadThreads: f.unreadThreads,
                    color: m?.color ?? DEFAULT_COLOR, emoji: m?.emoji ?? null,
                    sortOrder: m?.sort_order ?? Number.MAX_SAFE_INTEGER, showBadge: !!m?.show_badge, showOnHome: !!m?.show_on_home,
                    autoArchiveDays: m?.auto_archive_days ?? null,
                };
            })
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }

    async create(worker: AccountWorker, accountId: string, label: string, look: Appearance = {}): Promise<BucketView> {
        validate(look);
        const name = await worker.runJob(async client => {
            const ns = namespaceOf(client);
            const clean = bucketFolderName(label, ns.delimiter);
            const path = bucketPath(ns, clean);
            if ((await client.list()).some(f => f.path.toLowerCase() === path.toLowerCase())) throw new BucketError(`a bucket called "${clean}" already exists`);
            await client.mailboxCreate(path);
            return clean;
        });
        const order = (this.app.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM bucket_meta WHERE account_id = ?').get(accountId) as { n: number }).n;
        this.app.db.prepare(`INSERT INTO bucket_meta (account_id, name, color, emoji, sort_order, show_badge, show_on_home, auto_archive_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (account_id, name) DO UPDATE SET color = excluded.color, emoji = excluded.emoji, show_badge = excluded.show_badge,
            show_on_home = excluded.show_on_home, auto_archive_days = excluded.auto_archive_days`)
            .run(accountId, name, look.color ?? DEFAULT_COLOR, look.emoji ?? null, order, look.showBadge ? 1 : 0, look.showOnHome ? 1 : 0,
                look.autoArchiveDays ?? null);
        return this.get(accountId, name);
    }

    /** Renames the folder on the server (messages stay put) and carries its look and rules along. */
    async rename(worker: AccountWorker, accountId: string, from: string, to: string): Promise<BucketView> {
        const newName = await worker.runJob(async client => {
            const ns = namespaceOf(client);
            const clean = bucketFolderName(to, ns.delimiter);
            if (clean === from) return clean;
            const target = bucketPath(ns, clean);
            if ((await client.list()).some(f => f.path.toLowerCase() === target.toLowerCase())) throw new BucketError(`a bucket called "${clean}" already exists`);
            await closeIfOpen(client, this.pathOf(accountId, from));
            await client.mailboxRename(this.pathOf(accountId, from), target);
            // A subscription keeps the old name on many servers: move it, so webmail and phones
            // that list only subscribed folders still show the bucket (Rule 7).
            await client.mailboxSubscribe(target).catch(() => {});
            await client.mailboxUnsubscribe(this.pathOf(accountId, from)).catch(() => {});
            return clean;
        });
        if (newName !== from) {
            this.app.transaction(() => {
                this.app.db.prepare('UPDATE bucket_meta SET name = ? WHERE account_id = ? AND name = ?').run(newName, accountId, from);
                this.app.db.prepare('UPDATE rules SET bucket = ? WHERE account_id = ? AND bucket = ?').run(newName, accountId, from);
            });
        }
        return this.get(accountId, newName);
    }

    setAppearance(worker: AccountWorker, accountId: string, name: string, look: Appearance): BucketView {
        validate(look);
        this.pathOf(accountId, name); // must exist
        const current = this.get(accountId, name);
        this.app.db.prepare(`INSERT INTO bucket_meta (account_id, name, color, emoji, sort_order, show_badge, show_on_home, auto_archive_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (account_id, name) DO UPDATE SET color = excluded.color, emoji = excluded.emoji, show_badge = excluded.show_badge,
            show_on_home = excluded.show_on_home, auto_archive_days = excluded.auto_archive_days`)
            .run(accountId, name, look.color ?? current.color, look.emoji !== undefined ? look.emoji : current.emoji,
                current.sortOrder === Number.MAX_SAFE_INTEGER ? 0 : current.sortOrder, (look.showBadge ?? current.showBadge) ? 1 : 0,
                (look.showOnHome ?? current.showOnHome) ? 1 : 0,
                look.autoArchiveDays !== undefined ? look.autoArchiveDays : current.autoArchiveDays);
        worker.touch();
        return this.get(accountId, name);
    }

    /** The buckets that archive their own old items, for the account's daily sweep. */
    autoArchiveRules(accountId: string): AutoArchiveRule[] {
        return this.list(accountId).flatMap(b => (b.autoArchiveDays ? [{ name: b.name, path: b.path, days: b.autoArchiveDays }] : []));
    }

    reorder(worker: AccountWorker, accountId: string, names: string[]): BucketView[] {
        this.app.transaction(() => {
            const upsert = this.app.db.prepare(`INSERT INTO bucket_meta (account_id, name, sort_order) VALUES (?, ?, ?)
                ON CONFLICT (account_id, name) DO UPDATE SET sort_order = excluded.sort_order`);
            names.forEach((name, i) => upsert.run(accountId, name, i));
        });
        worker.touch();
        return this.list(accountId);
    }

    /** Moves the bucket's mail to Archive (D18), then removes the empty folder, its look and its rules. */
    async remove(worker: AccountWorker, accountId: string, name: string): Promise<{ movedToArchive: number }> {
        const path = this.pathOf(accountId, name);
        const archive = this.store.listFolders(accountId).find(f => f.role === 'archive')?.path;
        if (!archive) throw new BucketError('this account has no Archive folder to move the bucket\'s mail into');
        const moved = await worker.runJob(async client => {
            let count = 0;
            await closeIfOpen(client, path); // it may be open read-only from a sync; moving needs read-write
            const lock = await client.getMailboxLock(path);
            try {
                if (client.mailbox && client.mailbox.exists > 0) {
                    const res = await client.messageMove('1:*', archive, { uid: true });
                    if (!res) throw new BucketError(`the server refused to move "${name}" to Archive; nothing was deleted`);
                    count = res.uidMap?.size ?? 0;
                }
            } finally {
                lock.release();
            }
            await closeIfOpen(client, path); // never delete (or STATUS) the selected mailbox
            const status = await client.status(path, { messages: true });
            if (!status || status.messages !== 0) throw new BucketError(`"${name}" is not empty; nothing was deleted`);
            await client.mailboxDelete(path);
            await client.mailboxUnsubscribe(path).catch(() => {}); // servers keep subscriptions to deleted folders
            return count;
        });
        this.app.transaction(() => {
            this.app.db.prepare('DELETE FROM bucket_meta WHERE account_id = ? AND name = ?').run(accountId, name);
            this.app.db.prepare('DELETE FROM rules WHERE account_id = ? AND bucket = ?').run(accountId, name);
        });
        return { movedToArchive: moved };
    }

    private get(accountId: string, name: string): BucketView {
        const found = this.list(accountId).find(b => b.name === name);
        if (!found) throw new BucketError(`no bucket called "${name}"`);
        return found;
    }

    private pathOf(accountId: string, name: string): string {
        const folder = this.store.listFolders(accountId).find(f => f.role === 'bucket' && nameOf(f.path) === name);
        if (!folder) throw new BucketError(`no bucket called "${name}"`);
        return folder.path;
    }
}

/** "INBOX.Buckets.Reads" -> "Reads" (whatever the namespace prefix and delimiter). */
function nameOf(path: string): string {
    return bucketNameOf(path) ?? path;
}

async function closeIfOpen(client: ImapFlow, path: string): Promise<void> {
    if (client.mailbox && client.mailbox.path === path) await client.mailboxClose();
}

function namespaceOf(client: ImapFlow) {
    return { prefix: client.namespace?.prefix ?? '', delimiter: client.namespace?.delimiter ?? '/' };
}

function validate(look: Appearance): void {
    if (look.color !== undefined && !COLOR.test(look.color)) throw new BucketError('color must look like #3b82f6');
    if (look.emoji && !ICON.test(look.emoji) && [...look.emoji].length > 8) throw new BucketError('emoji is too long');
    if (look.showBadge !== undefined && typeof look.showBadge !== 'boolean') throw new BucketError('showBadge must be true or false');
    if (look.showOnHome !== undefined && typeof look.showOnHome !== 'boolean') throw new BucketError('showOnHome must be true or false');
    if (look.autoArchiveDays !== undefined && look.autoArchiveDays !== null
        && !(Number.isInteger(look.autoArchiveDays) && look.autoArchiveDays >= 1 && look.autoArchiveDays <= MAX_DAYS)) {
        throw new BucketError(`autoArchiveDays must be a whole number of days from 1 to ${MAX_DAYS}, or null for off`);
    }
}
