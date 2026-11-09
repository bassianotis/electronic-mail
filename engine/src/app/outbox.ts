// The outbox (docs/architecture.md, rule 9): a message either goes out or clearly says it did not;
// it is never sent twice; its copy in Sent is never duplicated.
//
//   queued -> sending -> sent -> saved          (normal path; a send can be held a few seconds
//                                                first, and cancelled while still queued: Undo)
//   queued <- (temporary SMTP trouble, retried with growing pauses, up to 5 tries) -> failed
//   sending -> failed                           (permanent: bad address, wrong password, ...)
//   sending -> uncertain                        (the app stopped mid-send: we cannot know whether
//                                                the server took it, so we ask instead of resending)
//
// "sending" is written before talking to SMTP, so a crash can never lead to a silent resend.
// Saving the copy to Sent first searches for its Message-ID (Mailspring's duplicate-APPEND
// lesson), so a retry after a lost acknowledgement never makes a second copy.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { ImapFlow } from 'imapflow';
import type { AppDb } from './appDb.ts';
import type { Accounts, SmtpConfig } from './accounts.ts';
import type { BuiltMessage } from './compose.ts';
import type { Uploads } from './uploads.ts';
import type { Store } from '../store/store.ts';
import type { AccountWorker } from '../worker/accountWorker.ts';

export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'saved' | 'failed' | 'uncertain';

export interface OutboxItem {
    id: string;
    accountId: string;
    messageId: string;
    subject: string | null;
    recipients: string[];
    status: OutboxStatus;
    attempts: number;
    error: string | null;
    draftKey: string | null;
    createdAt: string;
    sentAt: string | null;
    savedAt: string | null;
}

export interface Transport {
    sendMail(mail: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<unknown>;
    close(): void;
}

export interface OutboxDeps {
    app: AppDb;
    accounts: Accounts;
    /** Where message files live (private). */
    dir: string;
    uploads?: Uploads;
    /** Saves a copy to the account's Sent folder unless one with this Message-ID is there. */
    saveCopy: (accountId: string, messageId: string, raw: Buffer) => Promise<'saved' | 'already-there'>;
    /** After the copy is saved (e.g. remove the draft the message was written in). */
    afterSaved?: (item: OutboxItem) => Promise<void>;
    createTransport?: (smtp: SmtpConfig) => Transport;
    log?: (msg: string) => void;
    now?: () => number;
    /** Pauses before retrying a send / a Sent copy (defaults: 30 s .. 30 min / 1 min .. 30 min). */
    sendBackoffMs?: number[];
    saveBackoffMs?: number[];
}

const MAX_SEND_ATTEMPTS = 5;
const SEND_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
const SAVE_BACKOFF_MS = [60_000, 300_000, 1_800_000];

export class Outbox extends EventEmitter {
    private readonly d: Required<Omit<OutboxDeps, 'uploads' | 'afterSaved'>> & Pick<OutboxDeps, 'uploads' | 'afterSaved'>;
    private readonly chains = new Map<string, Promise<void>>();
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private stopped = false;

    constructor(deps: OutboxDeps) {
        super();
        this.d = {
            createTransport: smtp => nodemailer.createTransport({
                host: smtp.host, port: smtp.port, secure: smtp.secure, auth: { user: smtp.user, pass: smtp.pass },
                connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 60_000,
                tls: { minVersion: 'TLSv1.2' },
                disableFileAccess: true, disableUrlAccess: true,
            }) as unknown as Transport,
            log: () => {},
            now: Date.now,
            sendBackoffMs: SEND_BACKOFF_MS,
            saveBackoffMs: SAVE_BACKOFF_MS,
            ...deps,
        };
        fs.mkdirSync(this.d.dir, { recursive: true, mode: 0o700 });
    }

    /** On start-up: anything caught mid-send is uncertain (never resent automatically). */
    start(): void {
        this.stopped = false;
        const interrupted = this.d.app.db.prepare(`UPDATE outbox SET status = 'uncertain', updated_at = ?,
            error = 'The app stopped while this was being sent. It may or may not have gone out: check with the recipient, then send it again or discard it.'
            WHERE status = 'sending' RETURNING account_id, id`).all(this.iso()) as { account_id: string; id: string }[];
        for (const r of interrupted) this.d.log(`outbox ${r.id}: interrupted mid-send, marked uncertain`);
        const accounts = this.d.app.db.prepare(`SELECT DISTINCT account_id FROM outbox WHERE status IN ('queued', 'sent')`).all() as { account_id: string }[];
        for (const a of accounts) this.kick(a.account_id);
    }

    async stop(): Promise<void> {
        this.stopped = true;
        for (const t of this.timers.values()) clearTimeout(t);
        this.timers.clear();
        await Promise.allSettled(this.chains.values());
    }

    /** `holdMs`: wait that long before sending, so the user can still cancel it (Undo send). */
    enqueue(accountId: string, built: BuiltMessage, meta: { subject: string | null; recipients: string[]; draftKey?: string | null; uploads?: string[]; holdMs?: number }): OutboxItem {
        const id = crypto.randomUUID();
        fs.writeFileSync(this.file(id, 'smtp'), built.forSmtp, { mode: 0o600 });
        fs.writeFileSync(this.file(id, 'saved'), built.forSaving, { mode: 0o600 });
        const now = this.iso();
        this.d.app.db.prepare(`INSERT INTO outbox (id, account_id, message_id, subject, recipients, envelope, status, draft_key, uploads, created_at, updated_at, next_attempt_at)
            VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`).run(id, accountId, built.messageId, meta.subject, JSON.stringify(meta.recipients),
            JSON.stringify(built.envelope), meta.draftKey ?? null, JSON.stringify(meta.uploads ?? []), now, now, meta.holdMs ? this.iso(meta.holdMs) : null);
        this.changed(id);
        this.kick(accountId);
        return this.get(id)!;
    }

    /** Items still in flight or needing attention (everything not yet saved to Sent). */
    list(accountId: string): OutboxItem[] {
        return (this.d.app.db.prepare(`SELECT * FROM outbox WHERE account_id = ? AND status != 'saved' ORDER BY created_at`)
            .all(accountId) as unknown as Row[]).map(toItem);
    }

    get(id: string): OutboxItem | null {
        const row = this.d.app.db.prepare('SELECT * FROM outbox WHERE id = ?').get(id) as Row | undefined;
        return row ? toItem(row) : null;
    }

    /** The user decides to try a failed or uncertain message again. */
    retry(accountId: string, id: string): OutboxItem {
        const r = this.d.app.db.prepare(`UPDATE outbox SET status = 'queued', attempts = 0, error = NULL, next_attempt_at = NULL, updated_at = ?
            WHERE id = ? AND account_id = ? AND status IN ('failed', 'uncertain')`).run(this.iso(), id, accountId);
        if (!r.changes) throw new OutboxError('only failed or uncertain messages can be sent again');
        this.changed(id);
        this.kick(accountId);
        return this.get(id)!;
    }

    /** The user gives up on a failed or uncertain message. */
    discard(accountId: string, id: string): void {
        const r = this.d.app.db.prepare(`DELETE FROM outbox WHERE id = ? AND account_id = ? AND status IN ('failed', 'uncertain') RETURNING uploads`)
            .get(id, accountId) as { uploads: string } | undefined;
        if (!r) throw new OutboxError('only failed or uncertain messages can be discarded');
        this.removeFiles(id, JSON.parse(r.uploads) as string[]);
        this.emit('change', { accountId, id, status: 'discarded', error: null });
    }

    /**
     * Undo send: takes back a message that is still queued (being held, or waiting to retry).
     * Once it is being sent it can't be (status 'sending' is written before SMTP is contacted, with
     * nothing in between, so this either wins or finds it gone). The uploads stay: the composer
     * comes back with the same attachments.
     */
    cancel(accountId: string, id: string): void {
        const r = this.d.app.db.prepare(`DELETE FROM outbox WHERE id = ? AND account_id = ? AND status = 'queued' RETURNING id`).get(id, accountId);
        if (!r) throw new OutboxError('already sent');
        this.removeFiles(id, []);
        this.emit('change', { accountId, id, status: 'cancelled', error: null });
    }

    /** Before an account is removed: its queued messages and their files go too. */
    forgetAccount(accountId: string): void {
        const rows = this.d.app.db.prepare('SELECT id, uploads FROM outbox WHERE account_id = ?').all(accountId) as { id: string; uploads: string }[];
        for (const r of rows) this.removeFiles(r.id, JSON.parse(r.uploads) as string[]);
        this.d.app.db.prepare('DELETE FROM outbox WHERE account_id = ?').run(accountId);
        clearTimeout(this.timers.get(accountId));
        this.timers.delete(accountId);
    }

    // ------------------------------------------------------------------ processing

    private kick(accountId: string): void {
        if (this.stopped) return;
        const previous = this.chains.get(accountId) ?? Promise.resolve();
        const next = previous.then(() => this.process(accountId)).catch(err => this.d.log(`outbox ${accountId}: ${(err as Error).message}`));
        this.chains.set(accountId, next);
    }

    private async process(accountId: string): Promise<void> {
        while (!this.stopped) {
            const now = this.iso();
            const row = this.d.app.db.prepare(`SELECT * FROM outbox WHERE account_id = ? AND status IN ('queued', 'sent')
                AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT 1`).get(accountId, now) as Row | undefined;
            if (!row) break;
            if (row.status === 'queued') await this.send(row);
            else await this.save(row);
        }
        // Wake up again for the next retry, if any.
        const next = this.d.app.db.prepare(`SELECT MIN(next_attempt_at) AS at FROM outbox WHERE account_id = ? AND status IN ('queued', 'sent')`)
            .get(accountId) as { at: string | null };
        clearTimeout(this.timers.get(accountId));
        if (next.at && !this.stopped) {
            this.timers.set(accountId, setTimeout(() => this.kick(accountId), Math.max(0, Date.parse(next.at) - this.d.now())));
        }
    }

    private async send(row: Row): Promise<void> {
        const smtp = this.d.accounts.smtpConfig(row.account_id);
        if (!smtp) return this.fail(row, 'This account has no outgoing (SMTP) server set up.');
        // Recorded before talking to SMTP: a crash from here on can never cause a silent resend.
        this.set(row.id, { status: 'sending' });
        const transport = this.d.createTransport(smtp);
        try {
            await transport.sendMail({ envelope: JSON.parse(row.envelope), raw: fs.readFileSync(this.file(row.id, 'smtp')) });
        } catch (err) {
            const attempts = row.attempts + 1;
            if (isPermanent(err) || attempts >= MAX_SEND_ATTEMPTS) return this.fail(row, describeSmtpError(err), attempts);
            this.set(row.id, { status: 'queued', attempts, error: describeSmtpError(err), next_attempt_at: this.iso(this.d.sendBackoffMs[Math.min(attempts - 1, this.d.sendBackoffMs.length - 1)]) });
            return;
        } finally {
            transport.close();
        }
        this.set(row.id, { status: 'sent', sent_at: this.iso(), error: null, next_attempt_at: null, attempts: 0 });
        await this.save({ ...row, status: 'sent', attempts: 0 });
    }

    private async save(row: Row): Promise<void> {
        try {
            await this.d.saveCopy(row.account_id, row.message_id, fs.readFileSync(this.file(row.id, 'saved')));
        } catch (err) {
            // Delivered already; only the copy in Sent is late. Keep trying, never resend.
            const attempts = row.attempts + 1;
            this.set(row.id, { attempts, error: `Sent, but the copy in Sent is not saved yet: ${(err as Error).message}`,
                next_attempt_at: this.iso(this.d.saveBackoffMs[Math.min(attempts - 1, this.d.saveBackoffMs.length - 1)]) });
            return;
        }
        this.set(row.id, { status: 'saved', saved_at: this.iso(), error: null, next_attempt_at: null });
        this.removeFiles(row.id, JSON.parse(row.uploads) as string[]);
        const item = this.get(row.id)!;
        if (this.d.afterSaved) await this.d.afterSaved(item).catch(err => this.d.log(`outbox ${row.id}: after saving: ${(err as Error).message}`));
    }

    private fail(row: Row, error: string, attempts = row.attempts): void {
        this.set(row.id, { status: 'failed', error, attempts, next_attempt_at: null });
    }

    private set(id: string, fields: Partial<Record<'status' | 'error' | 'attempts' | 'next_attempt_at' | 'sent_at' | 'saved_at', string | number | null>>): void {
        const keys = Object.keys(fields);
        this.d.app.db.prepare(`UPDATE outbox SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .run(...keys.map(k => (fields as Record<string, string | number | null>)[k]), this.iso(), id);
        this.changed(id);
    }

    private changed(id: string): void {
        const item = this.get(id);
        if (item) this.emit('change', { accountId: item.accountId, id, status: item.status, error: item.error });
    }

    private removeFiles(id: string, uploads: string[]): void {
        fs.rmSync(this.file(id, 'smtp'), { force: true });
        fs.rmSync(this.file(id, 'saved'), { force: true });
        for (const u of uploads) this.d.uploads?.remove(u);
    }

    private file(id: string, kind: 'smtp' | 'saved'): string {
        return path.join(this.d.dir, `${id}.${kind}.eml`);
    }

    private iso(offsetMs = 0): string {
        return new Date(this.d.now() + offsetMs).toISOString();
    }
}

export class OutboxError extends Error {}

/** saveCopy for a real account: search Sent for the Message-ID first, APPEND only if absent. */
export function saveCopyWith(store: Store, workers: Map<string, AccountWorker>) {
    return async (accountId: string, messageId: string, raw: Buffer): Promise<'saved' | 'already-there'> => {
        const worker = workers.get(accountId);
        if (!worker) throw new Error('account not running');
        const sent = store.listFolders(accountId).find(f => f.role === 'sent')?.path;
        if (!sent) throw new Error('this account has no Sent folder');
        return worker.runJob(async (client: ImapFlow) => {
            if (client.mailbox && client.mailbox.path === sent) await client.mailboxClose(); // fresh view, never a stale one
            const lock = await client.getMailboxLock(sent, { readOnly: true });
            let found: number[] | false | undefined;
            try {
                found = await client.search({ header: { 'message-id': messageId } }, { uid: true });
            } finally {
                lock.release();
            }
            if (found && found.length) return 'already-there';
            await client.append(sent, raw, ['\\Seen']);
            return 'saved';
        });
    };
}

interface Row {
    id: string; account_id: string; message_id: string; subject: string | null; recipients: string; envelope: string;
    status: OutboxStatus; attempts: number; next_attempt_at: string | null; error: string | null; draft_key: string | null;
    uploads: string; created_at: string; updated_at: string; sent_at: string | null; saved_at: string | null;
}

function toItem(r: Row): OutboxItem {
    return {
        id: r.id, accountId: r.account_id, messageId: r.message_id, subject: r.subject, recipients: JSON.parse(r.recipients),
        status: r.status, attempts: r.attempts, error: r.error, draftKey: r.draft_key, createdAt: r.created_at, sentAt: r.sent_at, savedAt: r.saved_at,
    };
}

/** 5xx replies, rejected credentials and bad envelopes will not get better by retrying. */
function isPermanent(err: unknown): boolean {
    const e = err as { responseCode?: number; code?: string };
    if (typeof e.responseCode === 'number') return e.responseCode >= 500;
    return e.code === 'EAUTH' || e.code === 'EENVELOPE' || e.code === 'EMESSAGE';
}

function describeSmtpError(err: unknown): string {
    const e = err as { code?: string; response?: string; responseCode?: number; message?: string };
    if (e.code === 'EAUTH') return 'The outgoing mail server rejected the username or password.';
    if (e.responseCode && e.responseCode >= 500) return `The outgoing mail server refused the message: ${e.response ?? e.message}`;
    if (e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'ESOCKET' || e.code === 'EDNS') return `Could not reach the outgoing mail server (${e.code}); will retry.`;
    return e.response ?? e.message ?? String(err);
}
