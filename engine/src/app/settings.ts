// Settings export/import: how buckets look, sender rules and per-account
// preferences, as a JSON file. Passwords are never included; accounts are matched by address.
import type { AppDb } from './appDb.ts';
import { signatureOf, tabNameOf, type Accounts } from './accounts.ts';
import type { Rules } from './rules.ts';
import { MAX_DAYS } from './autoArchive.ts';

export const SETTINGS_FORMAT = 'electronic-mail-settings';

export interface SettingsFile {
    format: typeof SETTINGS_FORMAT;
    version: 1;
    exportedAt: string;
    accounts: {
        email: string;
        displayName: string | null;
        /** Added after version 1 shipped: older files have none (the account keeps its own). */
        tabName?: string | null;
        /** Added with Explore 2, the same way: older files have none. */
        signature?: string | null;
        inboxView: 'expand' | 'thread';
        imap: { host: string; port: number; secure: boolean; user: string } | null;
        smtp: { host: string; port: number; secure: boolean; user: string } | null;
        buckets: {
            name: string; color: string; emoji: string | null; sortOrder: number; showBadge: boolean; showOnHome: boolean;
            /** Added with feature batch 1: older files have none (imports as off). */
            autoArchiveDays?: number | null;
        }[];
        rules: { senderPattern: string; bucket: string }[];
    }[];
}

export interface ImportSummary {
    updatedAccounts: string[];
    skippedAccounts: string[];
    buckets: number;
    rules: number;
    problems: string[];
}

export class SettingsError extends Error {}

export function exportSettings(app: AppDb, accounts: Accounts, rules: Rules): SettingsFile {
    return {
        format: SETTINGS_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        accounts: accounts.list().map(a => {
            const conn = accounts.connectionInfo(a.id);
            return {
                email: a.email, displayName: a.displayName, tabName: a.tabName, signature: a.signature, inboxView: a.inboxView,
                imap: conn?.imap ?? null, smtp: conn?.smtp ?? null,
                buckets: (app.db.prepare('SELECT name, color, emoji, sort_order, show_badge, show_on_home, auto_archive_days FROM bucket_meta WHERE account_id = ? ORDER BY sort_order, name')
                    .all(a.id) as { name: string; color: string; emoji: string | null; sort_order: number; show_badge: number; show_on_home: number; auto_archive_days: number | null }[])
                    .map(b => ({ name: b.name, color: b.color, emoji: b.emoji, sortOrder: b.sort_order, showBadge: !!b.show_badge, showOnHome: !!b.show_on_home,
                        autoArchiveDays: b.auto_archive_days })),
                rules: rules.list(a.id).map(r => ({ senderPattern: r.senderPattern, bucket: r.bucket })),
            };
        }),
    };
}

/** Applies a settings file to the accounts that exist here; never creates accounts (no passwords). */
export function importSettings(app: AppDb, accounts: Accounts, rules: Rules, file: unknown): ImportSummary {
    const f = file as Partial<SettingsFile>;
    if (f?.format !== SETTINGS_FORMAT || f.version !== 1 || !Array.isArray(f.accounts)) {
        throw new SettingsError('this is not an Electronic Mail settings file');
    }
    const summary: ImportSummary = { updatedAccounts: [], skippedAccounts: [], buckets: 0, rules: 0, problems: [] };
    const byEmail = new Map(accounts.list().map(a => [a.email.toLowerCase(), a]));
    app.transaction(() => {
        for (const entry of f.accounts!) {
            const account = typeof entry?.email === 'string' ? byEmail.get(entry.email.toLowerCase()) : undefined;
            if (!account) {
                summary.skippedAccounts.push(String(entry?.email ?? '(no address)'));
                continue;
            }
            let tabName: string | null | undefined;
            if (typeof entry.tabName === 'string' || entry.tabName === null) {
                try {
                    tabName = tabNameOf(entry.tabName);
                } catch (err) {
                    summary.problems.push(`${account.email}: ${(err as Error).message}`);
                }
            }
            let signature: string | null | undefined;
            if (typeof entry.signature === 'string' || entry.signature === null) {
                try {
                    signature = signatureOf(entry.signature);
                } catch (err) {
                    summary.problems.push(`${account.email}: ${(err as Error).message}`);
                }
            }
            accounts.update(account.id, {
                displayName: typeof entry.displayName === 'string' || entry.displayName === null ? entry.displayName : undefined,
                inboxView: entry.inboxView === 'thread' || entry.inboxView === 'expand' ? entry.inboxView : undefined,
                tabName,
                signature,
            });
            for (const b of Array.isArray(entry.buckets) ? entry.buckets : []) {
                if (typeof b?.name !== 'string' || !/^#[0-9a-f]{6}$/i.test(String(b.color))) {
                    summary.problems.push(`${account.email}: skipped a bucket with an unreadable name or color`);
                    continue;
                }
                // A file from before "Show on home" (or auto-archive) existed has none: it imports as off.
                const days = Number.isInteger(b.autoArchiveDays) && b.autoArchiveDays! >= 1 && b.autoArchiveDays! <= MAX_DAYS ? b.autoArchiveDays! : null;
                if (b.autoArchiveDays != null && days === null) summary.problems.push(`${account.email}: ${b.name}: auto-archive days must be 1 to ${MAX_DAYS}; left off`);
                app.db.prepare(`INSERT INTO bucket_meta (account_id, name, color, emoji, sort_order, show_badge, show_on_home, auto_archive_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (account_id, name) DO UPDATE SET color = excluded.color, emoji = excluded.emoji,
                    sort_order = excluded.sort_order, show_badge = excluded.show_badge, show_on_home = excluded.show_on_home,
                    auto_archive_days = excluded.auto_archive_days`)
                    .run(account.id, b.name, b.color, typeof b.emoji === 'string' ? b.emoji : null, Number(b.sortOrder) || 0, b.showBadge ? 1 : 0,
                        b.showOnHome === true ? 1 : 0, days);
                summary.buckets++;
            }
            const existing = new Set(rules.list(account.id).map(r => r.senderPattern));
            for (const r of Array.isArray(entry.rules) ? entry.rules : []) {
                if (typeof r?.senderPattern !== 'string' || typeof r.bucket !== 'string') continue;
                if (existing.has(r.senderPattern.toLowerCase())) continue;
                try {
                    rules.add(account.id, r.senderPattern, r.bucket);
                    summary.rules++;
                } catch (err) {
                    summary.problems.push(`${account.email}: rule ${r.senderPattern}: ${(err as Error).message}`);
                }
            }
            summary.updatedAccounts.push(account.email);
        }
    });
    return summary;
}
