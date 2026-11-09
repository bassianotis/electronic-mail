// The engine's local cache. Disposable: everything here can be rebuilt from the server
// (docs/architecture.md, rule 3). Message identity is the placement (account, folder, uid); header
// facts live once per message key (Rule 4, borrowed from Mailspring's 1:N placements).
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { FolderRole } from '../types.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folder (
    account TEXT NOT NULL,
    path TEXT NOT NULL,
    role TEXT NOT NULL,
    uid_validity TEXT,
    highest_modseq TEXT,
    uid_next INTEGER,
    synced_at TEXT,
    PRIMARY KEY (account, path)
);
CREATE TABLE IF NOT EXISTS message (
    account TEXT NOT NULL,
    msg_key TEXT NOT NULL,
    message_id TEXT,
    in_reply_to TEXT,
    refs TEXT NOT NULL,
    addresses TEXT NOT NULL,
    subject TEXT,
    from_name TEXT,
    from_addr TEXT,
    date TEXT,
    size INTEGER,
    thread_id TEXT,
    preview TEXT,
    PRIMARY KEY (account, msg_key)
);
CREATE INDEX IF NOT EXISTS message_thread ON message (account, thread_id);
CREATE TABLE IF NOT EXISTS placement (
    account TEXT NOT NULL,
    folder TEXT NOT NULL,
    uid INTEGER NOT NULL,
    msg_key TEXT NOT NULL,
    flags TEXT NOT NULL,
    seen INTEGER NOT NULL,
    modseq TEXT,
    PRIMARY KEY (account, folder, uid)
);
CREATE INDEX IF NOT EXISTS placement_msg ON placement (account, msg_key);
CREATE TABLE IF NOT EXISTS thread (
    account TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    location TEXT,
    location_role TEXT,
    latest_date TEXT,
    latest_msg_key TEXT,
    face_date TEXT,
    face_msg_key TEXT,
    subject TEXT,
    from_name TEXT,
    from_addr TEXT,
    message_count INTEGER NOT NULL,
    unread INTEGER NOT NULL,
    has_sent INTEGER NOT NULL,
    latest_sent_date TEXT,
    PRIMARY KEY (account, thread_id)
);
CREATE INDEX IF NOT EXISTS thread_location ON thread (account, location, face_date DESC);
CREATE TABLE IF NOT EXISTS thread_link (
    account TEXT NOT NULL,
    id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    PRIMARY KEY (account, id)
);
CREATE INDEX IF NOT EXISTS thread_link_thread ON thread_link (account, thread_id);
-- Search over sender, subject and preview, kept in step with message by triggers
-- (SQLite's external-content FTS5 pattern). Diacritics folded: "cafe" finds "Café".
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    subject, from_name, from_addr, preview,
    content='message', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
CREATE TRIGGER IF NOT EXISTS message_fts_insert AFTER INSERT ON message BEGIN
    INSERT INTO message_fts (rowid, subject, from_name, from_addr, preview)
    VALUES (new.rowid, new.subject, new.from_name, new.from_addr, new.preview);
END;
CREATE TRIGGER IF NOT EXISTS message_fts_delete AFTER DELETE ON message BEGIN
    INSERT INTO message_fts (message_fts, rowid, subject, from_name, from_addr, preview)
    VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_addr, old.preview);
END;
CREATE TRIGGER IF NOT EXISTS message_fts_update AFTER UPDATE OF subject, from_name, from_addr, preview ON message BEGIN
    INSERT INTO message_fts (message_fts, rowid, subject, from_name, from_addr, preview)
    VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_addr, old.preview);
    INSERT INTO message_fts (rowid, subject, from_name, from_addr, preview)
    VALUES (new.rowid, new.subject, new.from_name, new.from_addr, new.preview);
END;
CREATE TABLE IF NOT EXISTS body (
    account TEXT NOT NULL,
    msg_key TEXT NOT NULL,
    data TEXT NOT NULL,
    size INTEGER NOT NULL,
    accessed_at TEXT NOT NULL,
    PRIMARY KEY (account, msg_key)
);
CREATE INDEX IF NOT EXISTS body_lru ON body (accessed_at);
CREATE TABLE IF NOT EXISTS task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    progress TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_status ON task (account, status, id);
-- Auto-archive sweeps (src/app/autoArchive.ts): each one's moves, so the app can say so once and
-- undo the whole batch, and when the last one ran. Kept with the tasks it refers to, through a
-- cache rebuild.
CREATE TABLE IF NOT EXISTS sweep (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL,
    created_at TEXT NOT NULL,
    moves TEXT NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    undone_at TEXT
);
CREATE INDEX IF NOT EXISTS sweep_account ON sweep (account, seen);
`;

export interface FolderState {
    account: string;
    path: string;
    role: FolderRole;
    uid_validity: string | null;
    highest_modseq: string | null;
    uid_next: number | null;
    synced_at: string | null;
}

export interface MessageFacts {
    msgKey: string;
    messageId: string | null;
    inReplyTo: string | null;
    refs: string[];
    addresses: string[];
    subject: string | null;
    fromName: string | null;
    fromAddr: string | null;
    date: string | null;
    size: number | null;
}

export interface PlacementRow {
    uid: number;
    msgKey: string;
    flags: string[];
    modseq: string | null;
}

/** Bump when the cache schema changes. */
const SCHEMA_VERSION = 4;
/** Tables that only cache server state: safe to drop and resync. `task` (user actions) and `sweep` are kept. */
const CACHE_TABLES = ['message_fts', 'folder', 'message', 'placement', 'thread', 'thread_link', 'body'];

export class Store {
    readonly db: DatabaseSync;

    constructor(path: string) {
        this.db = new DatabaseSync(path);
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
        // Private to this user: it holds mail data. SQLite gives -wal/-shm the same permissions.
        if (path !== ':memory:') fs.chmodSync(path, 0o600);
        const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
        if (version !== SCHEMA_VERSION) {
            // The cache is disposable (Rule 3): on a schema change, rebuild it from the server
            // instead of migrating it. Queued user actions survive.
            for (const table of CACHE_TABLES) this.db.exec(`DROP TABLE IF EXISTS ${table}`);
            this.db.exec(SCHEMA);
            this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        } else {
            this.db.exec(SCHEMA);
        }
    }

    close(): void {
        this.db.close();
    }

    /** Runs fn in one transaction; rolls back and rethrows on error. */
    transaction<T>(fn: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.db.exec('COMMIT');
            return result;
        } catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
    }

    getFolder(account: string, path: string): FolderState | undefined {
        return this.db.prepare('SELECT * FROM folder WHERE account = ? AND path = ?')
            .get(account, path) as FolderState | undefined;
    }

    listFolders(account: string): FolderState[] {
        return this.db.prepare('SELECT * FROM folder WHERE account = ? ORDER BY path')
            .all(account) as unknown as FolderState[];
    }

    upsertFolderRole(account: string, path: string, role: FolderRole): void {
        this.db.prepare(`INSERT INTO folder (account, path, role) VALUES (?, ?, ?)
            ON CONFLICT (account, path) DO UPDATE SET role = excluded.role`).run(account, path, role);
    }

    /** Saves a folder's sync checkpoint. Call inside the transaction that applied its changes. */
    saveCheckpoint(account: string, path: string, uidValidity: string, highestModseq: string | null, uidNext: number | null): void {
        this.db.prepare(`UPDATE folder SET uid_validity = ?, highest_modseq = ?, uid_next = ?, synced_at = ?
            WHERE account = ? AND path = ?`)
            .run(uidValidity, highestModseq, uidNext, new Date().toISOString(), account, path);
    }

    /** Forgets every placement in a folder (UIDVALIDITY changed). Returns the affected message keys. */
    resetFolder(account: string, path: string): string[] {
        const keys = this.folderMsgKeys(account, path);
        this.db.prepare('DELETE FROM placement WHERE account = ? AND folder = ?').run(account, path);
        this.db.prepare(`UPDATE folder SET uid_validity = NULL, highest_modseq = NULL, uid_next = NULL
            WHERE account = ? AND path = ?`).run(account, path);
        return keys;
    }

    /** Drops a folder that no longer exists on the server. Returns the affected message keys. */
    removeFolder(account: string, path: string): string[] {
        const keys = this.folderMsgKeys(account, path);
        this.db.prepare('DELETE FROM placement WHERE account = ? AND folder = ?').run(account, path);
        this.db.prepare('DELETE FROM folder WHERE account = ? AND path = ?').run(account, path);
        return keys;
    }

    private folderMsgKeys(account: string, path: string): string[] {
        return (this.db.prepare('SELECT DISTINCT msg_key FROM placement WHERE account = ? AND folder = ?')
            .all(account, path) as { msg_key: string }[]).map(r => r.msg_key);
    }

    folderUids(account: string, path: string): number[] {
        return (this.db.prepare('SELECT uid FROM placement WHERE account = ? AND folder = ?')
            .all(account, path) as { uid: number }[]).map(r => r.uid);
    }

    /** Header facts are immutable per message key, so the first copy seen wins. Returns true if new. */
    insertMessage(account: string, m: MessageFacts): boolean {
        return this.db.prepare(`INSERT OR IGNORE INTO message
            (account, msg_key, message_id, in_reply_to, refs, addresses, subject, from_name, from_addr, date, size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(account, m.msgKey, m.messageId, m.inReplyTo, JSON.stringify(m.refs), JSON.stringify(m.addresses),
                m.subject, m.fromName, m.fromAddr, m.date, m.size).changes > 0;
    }

    upsertPlacement(account: string, folder: string, p: PlacementRow): void {
        this.db.prepare(`INSERT INTO placement (account, folder, uid, msg_key, flags, seen, modseq)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (account, folder, uid) DO UPDATE SET
                flags = excluded.flags, seen = excluded.seen, modseq = excluded.modseq`)
            .run(account, folder, p.uid, p.msgKey, JSON.stringify(p.flags), p.flags.includes('\\Seen') ? 1 : 0, p.modseq);
    }

    hasPlacement(account: string, folder: string, uid: number): boolean {
        return !!this.db.prepare('SELECT 1 FROM placement WHERE account = ? AND folder = ? AND uid = ?')
            .get(account, folder, uid);
    }

    /** Returns the message keys of the placements actually deleted. */
    deletePlacements(account: string, folder: string, uids: number[]): string[] {
        const stmt = this.db.prepare('DELETE FROM placement WHERE account = ? AND folder = ? AND uid = ? RETURNING msg_key');
        const keys: string[] = [];
        for (const uid of uids) {
            const row = stmt.get(account, folder, uid) as { msg_key: string } | undefined;
            if (row) keys.push(row.msg_key);
        }
        return keys;
    }

    /** Removes everything cached for an account (used when the account is removed from the app). */
    forgetAccount(account: string): void {
        this.transaction(() => {
            for (const table of ['body', 'thread', 'thread_link', 'placement', 'message', 'folder', 'task', 'sweep']) {
                this.db.prepare(`DELETE FROM ${table} WHERE account = ?`).run(account);
            }
        });
    }

    /** Drops header facts no placement refers to any more. Returns the threads they belonged to. */
    pruneOrphanMessages(account: string): string[] {
        const rows = this.db.prepare(`DELETE FROM message WHERE account = ? AND NOT EXISTS
            (SELECT 1 FROM placement p WHERE p.account = message.account AND p.msg_key = message.msg_key)
            RETURNING thread_id`).all(account) as { thread_id: string | null }[];
        return [...new Set(rows.map(r => r.thread_id).filter((t): t is string => !!t))];
    }
}
