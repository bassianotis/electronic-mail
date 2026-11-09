// Owns the running accounts: one AccountWorker each, started and stopped as accounts are added
// and removed while the app runs, with every worker's events funnelled through this one emitter
// (so an open event stream hears about accounts added after it connected). Adding an account
// first tests its connections, like Thunderbird's account setup, and explains failures plainly.
import { EventEmitter } from 'node:events';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type { Store } from '../store/store.ts';
import { AccountWorker, type AccountStatus, type ChangedEvent, type WorkerOptions } from '../worker/accountWorker.ts';
import type { AccountInput, Accounts, AccountSummary } from './accounts.ts';
import type { Rules } from './rules.ts';
import type { Buckets } from './buckets.ts';
import type { AccountConfig } from '../types.ts';

export interface ConnectionCheck {
    imap: { ok: boolean; error?: string };
    smtp: { ok: boolean; error?: string } | null;
}

export class AccountError extends Error {}

export interface ManagerOptions {
    store: Store;
    accounts?: Accounts;
    rules?: Rules;
    /** For each bucket's "Archive items older than N days". */
    buckets?: Buckets;
    readOnly?: boolean;
    log?: (msg: string) => void;
    workerOptions?: Omit<WorkerOptions, 'rules' | 'autoArchive' | 'readOnly' | 'log'>;
    /** Called before an account's cached data is removed (e.g. drop its outbox files). */
    onForget?: (accountId: string) => void | Promise<void>;
}

export class AccountManager extends EventEmitter {
    readonly workers = new Map<string, AccountWorker>();
    private readonly o: ManagerOptions;

    constructor(options: ManagerOptions) {
        super();
        this.o = options;
    }

    start(configs: AccountConfig[]): void {
        for (const c of configs) this.startWorker(c);
    }

    async stopAll(): Promise<void> {
        await Promise.allSettled([...this.workers.values()].map(w => w.stop()));
    }

    /** Tests the connections, then saves the account and starts syncing it. */
    async add(input: AccountInput): Promise<AccountSummary> {
        const accounts = this.requireAccounts();
        if (accounts.list().some(a => a.email.toLowerCase() === input.email.trim().toLowerCase())) {
            throw new AccountError(`${input.email} is already set up`);
        }
        const check = await testConnection(input);
        if (!check.imap.ok) throw new AccountError(`Incoming mail (IMAP): ${check.imap.error}`);
        if (check.smtp && !check.smtp.ok) throw new AccountError(`Outgoing mail (SMTP): ${check.smtp.error}`);
        const created = accounts.create({ ...input, email: input.email.trim() });
        const config = accounts.imapConfigs().find(c => c.id === created.id)!;
        this.startWorker(config);
        this.emit('accounts', { added: created.id });
        return created;
    }

    /** Stops syncing, then forgets everything stored for the account (the mailbox itself is untouched). */
    async remove(id: string): Promise<void> {
        const accounts = this.requireAccounts();
        if (!accounts.get(id)) throw new AccountError('unknown account');
        const worker = this.workers.get(id);
        if (worker) {
            await worker.stop();
            worker.removeAllListeners();
            this.workers.delete(id);
        }
        await this.o.onForget?.(id);
        this.o.store.forgetAccount(id);
        accounts.remove(id);
        this.emit('accounts', { removed: id });
    }

    private startWorker(config: AccountConfig): void {
        const { rules, buckets } = this.o;
        const worker = new AccountWorker(config, this.o.store, {
            ...this.o.workerOptions,
            log: this.o.log,
            readOnly: this.o.readOnly,
            rules: rules ? () => rules.list(config.id) : undefined,
            autoArchive: buckets ? () => buckets.autoArchiveRules(config.id) : undefined,
        });
        worker.on('changed', (e: ChangedEvent) => this.emit('changed', e));
        worker.on('status', (s: AccountStatus) => this.emit('status', s));
        this.workers.set(config.id, worker);
        worker.start();
    }

    private requireAccounts(): Accounts {
        if (!this.o.accounts) throw new AccountError('accounts cannot be changed here');
        return this.o.accounts;
    }
}

/** Logs in to IMAP (and checks SMTP, if given) without saving anything. */
export async function testConnection(input: Pick<AccountInput, 'imap' | 'smtp'>): Promise<ConnectionCheck> {
    const result: ConnectionCheck = { imap: { ok: false }, smtp: null };
    const client = new ImapFlow({
        host: input.imap.host, port: input.imap.port, secure: input.imap.secure,
        auth: { user: input.imap.user, pass: input.imap.pass }, logger: false,
        connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
    client.on('error', () => {}); // reported through connect()'s rejection
    try {
        await client.connect();
        result.imap = { ok: true };
    } catch (err) {
        result.imap = { ok: false, error: explain(err) };
    } finally {
        await client.logout().catch(() => client.close());
    }
    if (input.smtp) result.smtp = await testSmtp(input.smtp);
    return result;
}

/** Logs in to the outgoing mail server without sending anything. */
export async function testSmtp(smtp: NonNullable<AccountInput['smtp']>): Promise<{ ok: boolean; error?: string }> {
    const transport = nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
        connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
        tls: { minVersion: 'TLSv1.2' },
    });
    try {
        await transport.verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: explain(err) };
    } finally {
        transport.close();
    }
}

/** Plain-language reasons instead of error codes. */
function explain(err: unknown): string {
    const e = err as { authenticationFailed?: boolean; code?: string; responseCode?: number; message?: string; responseText?: string };
    if (e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535) return 'the server rejected the username or password';
    // nodemailer wraps socket errors in its own codes (ESOCKET, ECONNECTION) and keeps the
    // underlying cause only in the message, so look there first.
    const cause = /\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET)\b/.exec(e.message ?? '')?.[1];
    switch (cause ?? e.code) {
        case 'EAI_AGAIN':
        case 'ENOTFOUND': case 'EDNS': return 'the server name was not found (check the host name)';
        case 'ECONNREFUSED': return 'the server refused the connection (check the port)';
        case 'ETIMEDOUT': case 'ETIMEOUT': case 'ECONNRESET': case 'ESOCKET': case 'ECONNECTION': return 'could not reach the server (check the host, port and network)';
        case 'CERT_HAS_EXPIRED': case 'DEPTH_ZERO_SELF_SIGNED_CERT': case 'ERR_TLS_CERT_ALTNAME_INVALID': case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
            return 'the secure connection failed: the server\'s certificate is not valid';
    }
    if (/wrong version number|ssl3_get_record|EPROTO/i.test(e.message ?? '')) return 'the secure connection failed (try the other security setting or port)';
    return e.responseText || e.message || 'the connection failed';
}
