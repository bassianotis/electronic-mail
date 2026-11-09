// The app's own durable state: what the app (not the mail server) owns. Unlike the mail
// cache (src/store), nothing here can be rebuilt from the server, so the schema evolves
// through numbered migrations and is never dropped. Back it up with its key (secrets.ts).
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
    // 1: login, sessions, accounts, bucket appearance, rules
    `CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE users (
         id TEXT PRIMARY KEY,
         identifier TEXT NOT NULL UNIQUE COLLATE NOCASE,
         password_hash TEXT NOT NULL,
         created_at TEXT NOT NULL
     );
     CREATE TABLE sessions (
         token_hash TEXT PRIMARY KEY,
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         created_at TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         last_seen_at TEXT NOT NULL,
         user_agent TEXT
     );
     CREATE TABLE accounts (
         id TEXT PRIMARY KEY,
         email TEXT NOT NULL UNIQUE COLLATE NOCASE,
         display_name TEXT,
         imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL,
         imap_user TEXT NOT NULL, imap_pass TEXT NOT NULL,
         smtp_host TEXT, smtp_port INTEGER, smtp_secure INTEGER, smtp_user TEXT, smtp_pass TEXT,
         inbox_view TEXT NOT NULL DEFAULT 'expand',
         sort_order INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL
     );
     -- How a bucket looks. The bucket itself is the folder Buckets/<name> on the mail server.
     CREATE TABLE bucket_meta (
         account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
         name TEXT NOT NULL,
         color TEXT NOT NULL DEFAULT '#3b82f6',
         emoji TEXT,
         sort_order INTEGER NOT NULL DEFAULT 0,
         show_badge INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (account_id, name)
     );
     CREATE TABLE rules (
         id TEXT PRIMARY KEY,
         account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
         sender_pattern TEXT NOT NULL,
         bucket TEXT NOT NULL,
         created_at TEXT NOT NULL
     );`,
    // 2: the outbox (docs/architecture.md, rule 9). Message bytes live in files next to the database.
    `CREATE TABLE outbox (
         id TEXT PRIMARY KEY,
         account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
         message_id TEXT NOT NULL,
         subject TEXT,
         recipients TEXT NOT NULL,
         envelope TEXT NOT NULL,
         status TEXT NOT NULL,
         attempts INTEGER NOT NULL DEFAULT 0,
         next_attempt_at TEXT,
         error TEXT,
         draft_key TEXT,
         uploads TEXT NOT NULL DEFAULT '[]',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         sent_at TEXT,
         saved_at TEXT
     );
     CREATE INDEX outbox_account ON outbox (account_id, status);`,
    // 3: a bucket's mail can also show on home, in Up next (off for every existing bucket)
    `ALTER TABLE bucket_meta ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 0;`,
    // 4: a short name for the account's tab on the rail (empty: the part of the address before the @)
    `ALTER TABLE accounts ADD COLUMN tab_name TEXT;`,
    // 5: a plain-text signature, added under everything written from the account (empty: none)
    `ALTER TABLE accounts ADD COLUMN signature TEXT;`,
    // 6: a bucket can archive its own old items: "Archive items older than N days" (empty: off)
    `ALTER TABLE bucket_meta ADD COLUMN auto_archive_days INTEGER;`,
];

export class AppDb {
    readonly db: DatabaseSync;

    constructor(path: string) {
        this.db = new DatabaseSync(path);
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        // Private to this user: it holds mail data. SQLite gives -wal/-shm the same permissions.
        if (path !== ':memory:') fs.chmodSync(path, 0o600);
        const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
        if (version > MIGRATIONS.length) throw new Error(`app database is newer (v${version}) than this engine (v${MIGRATIONS.length})`);
        for (let v = version; v < MIGRATIONS.length; v++) {
            this.transaction(() => {
                this.db.exec(MIGRATIONS[v]);
                this.db.exec(`PRAGMA user_version = ${v + 1}`);
            });
        }
    }

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

    meta(key: string): string | null {
        return (this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
    }

    setMeta(key: string, value: string): void {
        this.db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
    }

    close(): void {
        this.db.close();
    }
}
