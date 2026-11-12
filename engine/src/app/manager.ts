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

/** One server's test: `refused` when it was the username or password (not the network). */
export interface ServerCheck { ok: boolean; error?: string; refused?: boolean }

export interface ConnectionCheck {
    imap: ServerCheck;
    smtp: ServerCheck | null;
}

/** A server's details as changed in Settings; no password keeps the saved one. */
export interface ServerChange { host: string; port: number; secure: boolean; user: string; pass?: string }

export class AccountError extends Error {
    /** Which server failed its test, and whether it refused the password: the screens put it by that field. */
    readonly reason?: 'imap-refused' | 'imap' | 'smtp-refused' | 'smtp';
    constructor(message: string, reason?: AccountError['reason']) {
        super(message);
        this.reason = reason;
    }
}

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
        if (!check.imap.ok) throw new AccountError(`Incoming mail (IMAP): ${check.imap.error}`, check.imap.refused ? 'imap-refused' : 'imap');
        if (check.smtp && !check.smtp.ok) throw new AccountError(`Outgoing mail (SMTP): ${check.smtp.error}`, check.smtp.refused ? 'smtp-refused' : 'smtp');
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

    /**
     * Changes where an account connects, or its passwords (settings-audit.md, section 3). Each server
     * given is tested first, and one refusal saves nothing. A changed incoming server or password
     * starts the account again with it, so a refused account is back online at once.
     */
    async changeConnection(id: string, changes: { imap?: ServerChange; smtp?: ServerChange | null }): Promise<AccountSummary> {
        const accounts = this.requireAccounts();
        if (!accounts.get(id)) throw new AccountError('unknown account');
        const imap = changes.imap && { ...changes.imap, pass: changes.imap.pass || accounts.imapConfig(id)!.pass };
        const smtp = changes.smtp && { ...changes.smtp, pass: changes.smtp.pass || accounts.smtpConfig(id)?.pass || '' };
        if (smtp && !smtp.pass) throw new AccountError('Outgoing mail (SMTP): a password is required', 'smtp');
        if (imap) {
            const check = await testConnection({ imap });
            if (!check.imap.ok) throw new AccountError(`Incoming mail (IMAP): ${check.imap.error}`, check.imap.refused ? 'imap-refused' : 'imap');
        }
        if (smtp) {
            const check = await testSmtp(smtp);
            if (!check.ok) throw new AccountError(`Outgoing mail (SMTP): ${check.error}`, check.refused ? 'smtp-refused' : 'smtp');
        }
        accounts.updateConnection(id, { imap, smtp: changes.smtp === undefined ? undefined : smtp });
        if (imap) await this.reconnect(id);
        return accounts.get(id)!;
    }

    /** Starts an account again with its saved settings (its worker took the password when it was made). */
    async reconnect(id: string): Promise<void> {
        const config = this.requireAccounts().imapConfigs().find(c => c.id === id);
        const old = this.workers.get(id);
        if (old) {
            old.removeAllListeners(); // no "stopped" in between: the new worker says where it's at
            await old.stop();
            this.workers.delete(id);
        }
        if (config) this.startWorker(config);
    }

    /** The accounts' order, on the rail and in Settings. */
    setOrder(ids: string[]): void {
        try {
            this.requireAccounts().setOrder(ids);
        } catch (err) {
            throw new AccountError((err as Error).message);
        }
        this.emit('accounts', { reordered: true });
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
        result.imap = { ok: false, error: explain(err), ...(isRefusal(err) ? { refused: true } : {}) };
    } finally {
        await client.logout().catch(() => client.close());
    }
    if (input.smtp) result.smtp = await testSmtp(input.smtp);
    return result;
}

/** Logs in to the outgoing mail server without sending anything. */
export async function testSmtp(smtp: NonNullable<AccountInput['smtp']>): Promise<ServerCheck> {
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
        return { ok: false, error: explain(err), ...(isRefusal(err) ? { refused: true } : {}) };
    } finally {
        transport.close();
    }
}

/** The server refused the username or password (rather than being unreachable or misconfigured). */
function isRefusal(err: unknown): boolean {
    const e = err as { authenticationFailed?: boolean; code?: string; responseCode?: number };
    return !!e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535;
}

/** Plain-language reasons instead of error codes. */
function explain(err: unknown): string {
    const e = err as { code?: string; message?: string; responseText?: string };
    if (isRefusal(err)) return 'the server rejected the username or password';
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
