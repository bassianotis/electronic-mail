// Email accounts and their (encrypted) credentials.
import crypto from 'node:crypto';
import type { AppDb } from './appDb.ts';
import { decrypt, encrypt } from './secrets.ts';
import type { AccountConfig } from '../types.ts';

export interface AccountInput {
    email: string;
    displayName?: string | null;
    imap: { host: string; port: number; secure: boolean; user: string; pass: string };
    smtp?: { host: string; port: number; secure: boolean; user: string; pass: string } | null;
    inboxView?: 'expand' | 'thread';
}

/** A tab name's longest length (it is written down the side of a narrow tab). */
export const TAB_NAME_MAX = 12;
/** A few lines; a long one is a mistake (a pasted message), not a signature. */
export const SIGNATURE_MAX = 2000;

/** What the UI may see: never any password. */
export interface AccountSummary {
    id: string;
    email: string;
    displayName: string | null;
    /** The account's tab on the rail; null shows the part of the address before the @. */
    tabName: string | null;
    /** Added under everything written from this account (plain text). */
    signature: string | null;
    inboxView: 'expand' | 'thread';
    hasSmtp: boolean;
}

export interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
}

interface Row {
    id: string; email: string; display_name: string | null;
    imap_host: string; imap_port: number; imap_secure: number; imap_user: string; imap_pass: string;
    smtp_host: string | null; smtp_port: number | null; smtp_secure: number | null; smtp_user: string | null; smtp_pass: string | null;
    inbox_view: 'expand' | 'thread'; sort_order: number; tab_name: string | null; signature: string | null;
}

export class Accounts {
    private readonly app: AppDb;
    private readonly key: Buffer;

    constructor(app: AppDb, key: Buffer) {
        this.app = app;
        this.key = key;
    }

    list(): AccountSummary[] {
        return (this.app.db.prepare('SELECT * FROM accounts ORDER BY sort_order, email').all() as unknown as Row[]).map(summary);
    }

    get(id: string): AccountSummary | null {
        const row = this.row(id);
        return row ? summary(row) : null;
    }

    /** Connection details for the sync engine (decrypted in memory only). */
    imapConfigs(): AccountConfig[] {
        return (this.app.db.prepare('SELECT * FROM accounts ORDER BY sort_order, email').all() as unknown as Row[]).map(r => ({
            id: r.id, email: r.email, host: r.imap_host, port: r.imap_port, secure: !!r.imap_secure,
            user: r.imap_user, pass: decrypt(this.key, r.imap_pass),
        }));
    }

    /** Where the account connects, without its passwords (for settings export). */
    connectionInfo(id: string): { imap: { host: string; port: number; secure: boolean; user: string }; smtp: { host: string; port: number; secure: boolean; user: string } | null } | null {
        const r = this.row(id);
        if (!r) return null;
        return {
            imap: { host: r.imap_host, port: r.imap_port, secure: !!r.imap_secure, user: r.imap_user },
            smtp: r.smtp_host ? { host: r.smtp_host, port: r.smtp_port ?? 465, secure: !!r.smtp_secure, user: r.smtp_user ?? r.email } : null,
        };
    }

    smtpConfig(id: string): SmtpConfig | null {
        const r = this.row(id);
        if (!r?.smtp_host || !r.smtp_pass) return null;
        return { host: r.smtp_host, port: r.smtp_port ?? 465, secure: !!r.smtp_secure, user: r.smtp_user ?? r.email, pass: decrypt(this.key, r.smtp_pass) };
    }

    create(input: AccountInput, id: string = crypto.randomUUID()): AccountSummary {
        const order = (this.app.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts').get() as { n: number }).n;
        this.app.db.prepare(`INSERT INTO accounts (id, email, display_name, imap_host, imap_port, imap_secure, imap_user, imap_pass,
            smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, inbox_view, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            id, input.email, input.displayName ?? null,
            input.imap.host, input.imap.port, input.imap.secure ? 1 : 0, input.imap.user, encrypt(this.key, input.imap.pass),
            input.smtp?.host ?? null, input.smtp?.port ?? null, input.smtp ? (input.smtp.secure ? 1 : 0) : null,
            input.smtp?.user ?? null, input.smtp ? encrypt(this.key, input.smtp.pass) : null,
            input.inboxView ?? 'expand', order, new Date().toISOString());
        return this.get(id)!;
    }

    update(id: string, changes: { displayName?: string | null; inboxView?: 'expand' | 'thread'; tabName?: string | null; signature?: string | null }): AccountSummary | null {
        if (changes.displayName !== undefined) this.app.db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(changes.displayName, id);
        if (changes.tabName !== undefined) this.app.db.prepare('UPDATE accounts SET tab_name = ? WHERE id = ?').run(tabNameOf(changes.tabName), id);
        if (changes.signature !== undefined) this.app.db.prepare('UPDATE accounts SET signature = ? WHERE id = ?').run(signatureOf(changes.signature), id);
        if (changes.inboxView !== undefined) this.app.db.prepare('UPDATE accounts SET inbox_view = ? WHERE id = ?').run(changes.inboxView, id);
        return this.get(id);
    }

    /**
     * Changes where an account connects. A missing password keeps the saved one; `smtp: null`
     * removes sending. Changing IMAP takes effect when the account's worker next starts.
     */
    updateConnection(id: string, changes: {
        imap?: { host: string; port: number; secure: boolean; user: string; pass?: string };
        smtp?: { host: string; port: number; secure: boolean; user: string; pass?: string } | null;
    }): AccountSummary | null {
        const r = this.row(id);
        if (!r) return null;
        this.app.transaction(() => {
            if (changes.imap) {
                const i = changes.imap;
                this.app.db.prepare(`UPDATE accounts SET imap_host = ?, imap_port = ?, imap_secure = ?, imap_user = ?, imap_pass = ? WHERE id = ?`)
                    .run(i.host, i.port, i.secure ? 1 : 0, i.user, i.pass ? encrypt(this.key, i.pass) : r.imap_pass, id);
            }
            if (changes.smtp === null) {
                this.app.db.prepare(`UPDATE accounts SET smtp_host = NULL, smtp_port = NULL, smtp_secure = NULL, smtp_user = NULL, smtp_pass = NULL WHERE id = ?`).run(id);
            } else if (changes.smtp) {
                const o = changes.smtp;
                const pass = o.pass ? encrypt(this.key, o.pass) : r.smtp_pass;
                if (!pass) throw new Error('a password is required for outgoing mail');
                this.app.db.prepare(`UPDATE accounts SET smtp_host = ?, smtp_port = ?, smtp_secure = ?, smtp_user = ?, smtp_pass = ? WHERE id = ?`)
                    .run(o.host, o.port, o.secure ? 1 : 0, o.user, pass, id);
            }
        });
        return this.get(id);
    }

    remove(id: string): boolean {
        return this.app.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
    }

    private row(id: string): Row | undefined {
        return this.app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
    }
}

function summary(r: Row): AccountSummary {
    return { id: r.id, email: r.email, displayName: r.display_name, tabName: r.tab_name, signature: r.signature, inboxView: r.inbox_view, hasSmtp: !!r.smtp_host };
}

/** A signature as stored: line ends normalised, trailing blank space trimmed, empty meaning none. */
export function signatureOf(raw: string | null): string | null {
    const text = (raw ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    if (text.length > SIGNATURE_MAX) throw new RangeError(`the signature can be at most ${SIGNATURE_MAX} characters`);
    return text.trim() ? text : null;
}

/** A tab name as stored: trimmed, empty meaning none; longer than TAB_NAME_MAX characters is refused. */
export function tabNameOf(raw: string | null): string | null {
    const name = (raw ?? '').trim();
    if ([...name].length > TAB_NAME_MAX) throw new RangeError(`the tab name can be at most ${TAB_NAME_MAX} characters`);
    return name || null;
}
