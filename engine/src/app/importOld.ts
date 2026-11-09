// One-time import of what the old app owned (read-only on its database): the login, the
// email accounts (same ids), how each bucket looks, sender rules and per-account preferences.
// Bucket appearance is keyed by the bucket's folder name (bucketFolderName), so it attaches to
// the right Buckets/ folder.
// Idempotent: a second run changes nothing.
import { DatabaseSync } from 'node:sqlite';
import type { AppDb } from './appDb.ts';
import type { Accounts } from './accounts.ts';
import type { Auth } from './auth.ts';
import { bucketFolderName } from '../imap/roles.ts';

export interface ImportSummary {
    skipped: boolean;
    users: number;
    accounts: number;
    buckets: number;
    rules: number;
}

export function importFromOldApp(app: AppDb, accounts: Accounts, auth: Auth, oldDbPath: string, delimiter = '.'): ImportSummary {
    if (app.meta('imported_from_old_app')) return { skipped: true, users: 0, accounts: 0, buckets: 0, rules: 0 };
    const old = new DatabaseSync(oldDbPath, { readOnly: true });
    old.exec('PRAGMA busy_timeout = 10000'); // the old app may be writing
    try {
        const users = old.prepare('SELECT id, email, password_hash FROM users WHERE password_hash IS NOT NULL').all() as
            { id: string; email: string; password_hash: string }[];
        const accts = old.prepare(`SELECT id, email_address, imap_host, imap_port, imap_secure, imap_user, imap_password,
            smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, sync_settings, default_inbox_view
            FROM email_accounts ORDER BY created_at`).all() as {
                id: string; email_address: string; imap_host: string; imap_port: number; imap_secure: number; imap_user: string;
                imap_password: string; smtp_host: string | null; smtp_port: number | null; smtp_secure: number | null;
                smtp_user: string | null; smtp_password: string | null; sync_settings: string | null; default_inbox_view: string | null;
            }[];
        const buckets = old.prepare(`SELECT id, label, color, emoji, sort_order, show_badge, email_account_id FROM buckets
            WHERE email_account_id IS NOT NULL`).all() as {
                id: string; label: string; color: string; emoji: string | null; sort_order: number | null; show_badge: number | null; email_account_id: string;
            }[];
        const rules = old.prepare('SELECT id, sender_pattern, bucket_id, email_account_id, created_at FROM email_rules WHERE email_account_id IS NOT NULL')
            .all() as { id: string; sender_pattern: string; bucket_id: string; email_account_id: string; created_at: string }[];

        let bucketCount = 0;
        let ruleCount = 0;
        app.transaction(() => {
            for (const u of users) auth.importUser(u.id, u.email, u.password_hash);
            for (const a of accts) {
                const settings = JSON.parse(a.sync_settings ?? '{}') as { displayName?: string };
                accounts.create({
                    email: a.email_address,
                    displayName: settings.displayName ?? null,
                    imap: { host: a.imap_host, port: a.imap_port, secure: !!a.imap_secure, user: a.imap_user, pass: a.imap_password },
                    smtp: a.smtp_host && a.smtp_password
                        ? { host: a.smtp_host, port: a.smtp_port ?? 465, secure: !!a.smtp_secure, user: a.smtp_user ?? a.email_address, pass: a.smtp_password }
                        : null,
                    inboxView: a.default_inbox_view === 'thread' ? 'thread' : 'expand',
                }, a.id);
            }
            const known = new Set(accts.map(a => a.id));
            const nameOf = new Map<string, string>();
            const insertMeta = app.db.prepare(`INSERT OR IGNORE INTO bucket_meta (account_id, name, color, emoji, sort_order, show_badge)
                VALUES (?, ?, ?, ?, ?, ?)`);
            for (const b of buckets) {
                if (!known.has(b.email_account_id)) continue;
                const name = bucketFolderName(b.label, delimiter);
                nameOf.set(b.id, name);
                bucketCount += Number(insertMeta.run(b.email_account_id, name, b.color, b.emoji, b.sort_order ?? 0, b.show_badge ? 1 : 0).changes);
            }
            const insertRule = app.db.prepare('INSERT INTO rules (id, account_id, sender_pattern, bucket, created_at) VALUES (?, ?, ?, ?, ?)');
            for (const r of rules) {
                const bucket = nameOf.get(r.bucket_id);
                if (!bucket || !known.has(r.email_account_id)) continue;
                insertRule.run(r.id, r.email_account_id, r.sender_pattern, bucket, r.created_at);
                ruleCount++;
            }
            app.setMeta('imported_from_old_app', JSON.stringify({ at: new Date().toISOString(), from: oldDbPath }));
        });
        return { skipped: false, users: users.length, accounts: accts.length, buckets: bucketCount, rules: ruleCount };
    } finally {
        old.close();
    }
}
