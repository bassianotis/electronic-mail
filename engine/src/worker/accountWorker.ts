// Keeps one account live (docs/architecture.md, rules 5 and 6). Shape borrowed from Mailspring:
//   watch connection — idles on INBOX so new mail shows within seconds; also serves bodies
//   work connection  — runs every sync and user task through one queue, so they never collide
// A cheap LIST-STATUS check runs every minute and syncs only folders that moved; a daily
// UID-list comparison repairs anything a sync might have missed; a daily sweep archives old
// items from buckets that ask for it (src/app/autoArchive.ts). Dropped connections come
// back with exponential backoff. A rejected password is tried again only after a long wait (15 min,
// doubling to 2 h), one login at a time: hosts sometimes refuse a good password for a while, and
// repeated failed logins can get an address blocked by the host's brute-force protection.
import { EventEmitter, once } from 'node:events';
import { ImapFlow } from 'imapflow';
import type { Store } from '../store/store.ts';
import { ChangeSet } from '../store/changes.ts';
import { syncChangedFolders, syncFolder, verifyFolders } from '../sync/folderSync.ts';
import { updateThreads } from '../threads/threads.ts';
import { enqueueMoveThread, hasPendingTasks, runPendingTasks, type TaskOutcome } from '../tasks/tasks.ts';
import { matchRule } from '../app/rules.ts';
import { CATCH_UP_MS, SWEEP_CAP, lastSweep, sweep, type AutoArchiveRule } from '../app/autoArchive.ts';
import { bucketNameOf } from '../imap/roles.ts';
import { fillPreviews } from '../bodies/bodies.ts';
import type { AccountConfig } from '../types.ts';

export type ConnectionState = 'stopped' | 'connecting' | 'online' | 'offline' | 'auth-failed';

export interface AccountStatus {
    account: string;
    state: ConnectionState;
    error: string | null;
    lastSyncAt: string | null;
    /** While the password is refused: when the host first refused it, and when Mail logs in again. */
    rejectedAt: string | null;
    retryAt: string | null;
    /** Opaque token that changes whenever anything the UI shows may have changed (JMAP-style). */
    stateToken: string;
}

export interface ChangedEvent {
    account: string;
    stateToken: string;
    tasks: TaskOutcome[];
}

export interface WorkerOptions {
    /** How often other folders are checked (ms). Default 60 s. */
    pollIntervalMs?: number;
    /** How often every folder's UID list is verified (ms). Default 24 h. */
    verifyIntervalMs?: number;
    /** How often buckets' old items are swept to Archive (ms). Default 24 h. */
    sweepIntervalMs?: number;
    /** Reconnect backoff bounds (ms). Default 1 s .. 5 min. */
    backoffMinMs?: number;
    backoffMaxMs?: number;
    /** After a rejected password, the wait before one more login (ms). Default 15 min, doubling to 2 h. */
    authRetryMinMs?: number;
    authRetryMaxMs?: number;
    /** Wait after an IDLE notification before syncing, to batch bursts (ms). Default 250. */
    inboxDebounceMs?: number;
    /** Never run user tasks (the read-only preview); syncing only reads. */
    readOnly?: boolean;
    /** Sender rules for this account, read fresh each time new mail arrives. */
    rules?: () => { senderPattern: string; bucket: string }[];
    /** Buckets that archive their own old items, read fresh at each sweep. */
    autoArchive?: () => AutoArchiveRule[];
    /** The app's own notices (app/notices.ts), by Message-ID: no rule ever files one. */
    isOwnNotice?: (messageId: string | null) => boolean;
    /** For tests: how to create a connection. */
    createClient?: (role: 'watch' | 'work') => ImapFlow;
    log?: (msg: string) => void;
}

class Stopped extends Error {}

/**
 * imapflow starts IDLE only after 15 s of inactivity by default, so new mail could go unnoticed
 * for 15 s after every reconnect or body fetch. The watch connection exists to idle: start fast.
 */
export const WATCH_AUTO_IDLE_MS = 300;

export class AccountWorker extends EventEmitter {
    readonly account: AccountConfig;
    private readonly store: Store;
    private readonly opts: Required<Omit<WorkerOptions, 'createClient' | 'log' | 'readOnly' | 'rules' | 'autoArchive' | 'isOwnNotice'>>;
    private readonly rules: () => { senderPattern: string; bucket: string }[];
    private readonly isOwnNotice: (messageId: string | null) => boolean;
    private readonly autoArchive: () => AutoArchiveRule[];
    private readonly readOnly: boolean;
    private readonly createClient: (role: 'watch' | 'work') => ImapFlow;
    private readonly log: (msg: string) => void;

    private work: ImapFlow | null = null;
    private watch: ImapFlow | null = null;
    private state: ConnectionState = 'stopped';
    private error: string | null = null;
    private lastSyncAt: string | null = null;
    private rejectedAt: string | null = null;
    private retryAt: string | null = null;
    private lastVerify = Date.now();
    private nextSweep = 0;
    private readonly boot = Date.now().toString(36);
    private version = 0;
    private stopped = true;
    private backoff: number;
    private authRetry: number;
    private authTimer: NodeJS.Timeout | null = null;
    /** The one login allowed after a refused password is due (the status stays "auth-failed" meanwhile)... */
    private loginRetry = false;
    /** ...and under way: a late refusal from the other connection waits for its answer. */
    private retryInFlight = false;
    private watchRunning = false;

    private readonly jobs: { fn: (client: ImapFlow) => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
    private pendingTasks = false;
    private pendingCheck = false;
    private pendingVerify = false;
    private pendingSweep = false;
    private readonly pendingFolders = new Set<string>();
    private pumping: Promise<void> | null = null;
    private watching: Promise<void> | null = null;
    private readonly timers = new Set<NodeJS.Timeout>();
    private readonly sleepers = new Set<() => void>();
    private inboxTimer: NodeJS.Timeout | null = null;
    private backToInboxTimer: NodeJS.Timeout | null = null;
    private previewTimer: NodeJS.Timeout | null = null;
    private fillingPreviews = false;
    private readsWaiting = 0;

    constructor(account: AccountConfig, store: Store, options: WorkerOptions = {}) {
        super();
        this.account = account;
        this.store = store;
        this.opts = {
            pollIntervalMs: options.pollIntervalMs ?? 60_000,
            verifyIntervalMs: options.verifyIntervalMs ?? 24 * 60 * 60_000,
            sweepIntervalMs: options.sweepIntervalMs ?? 24 * 60 * 60_000,
            backoffMinMs: options.backoffMinMs ?? 1_000,
            backoffMaxMs: options.backoffMaxMs ?? 5 * 60_000,
            authRetryMinMs: options.authRetryMinMs ?? 15 * 60_000,
            authRetryMaxMs: options.authRetryMaxMs ?? 2 * 60 * 60_000,
            inboxDebounceMs: options.inboxDebounceMs ?? 250,
        };
        this.backoff = this.opts.backoffMinMs;
        this.authRetry = this.opts.authRetryMinMs;
        this.readOnly = options.readOnly ?? false;
        this.rules = options.rules ?? (() => []);
        this.isOwnNotice = options.isOwnNotice ?? (() => false);
        this.autoArchive = options.autoArchive ?? (() => []);
        this.createClient = options.createClient ?? (role => new ImapFlow({
            host: account.host, port: account.port, secure: account.secure,
            auth: { user: account.user, pass: account.pass },
            logger: false,
            qresync: role === 'work',
            ...(role === 'watch' ? { autoIdleDelay: WATCH_AUTO_IDLE_MS } : {}),
            clientInfo: { name: 'electronic-mail', version: '2' },
        }));
        this.log = options.log ?? (() => {});
    }

    get stateToken(): string {
        return `${this.boot}.${this.version}`;
    }

    status(): AccountStatus {
        return {
            account: this.account.id, state: this.state, error: this.error, lastSyncAt: this.lastSyncAt,
            rejectedAt: this.rejectedAt, retryAt: this.retryAt, stateToken: this.stateToken,
        };
    }

    start(): void {
        if (!this.stopped) return;
        this.stopped = false;
        this.authRetry = this.opts.authRetryMinMs; // a restart (the account was edited) logs in at once
        this.loginRetry = false;
        this.pendingCheck = true;
        this.pendingTasks = !this.readOnly && hasPendingTasks(this.store, this.account.id); // resume tasks left by a restart
        const last = this.readOnly ? null : lastSweep(this.store, this.account.id);
        this.nextSweep = last ? this.sweepAfter(last.at, last.moved) : 0;
        this.pendingSweep = !this.readOnly && Date.now() >= this.nextSweep; // after the first check, so it sweeps what the server has now
        const poll = setInterval(() => {
            if (Date.now() - this.lastVerify >= this.opts.verifyIntervalMs) this.pendingVerify = true;
            if (!this.readOnly && Date.now() >= this.nextSweep) this.pendingSweep = true;
            this.requestCheck();
        }, this.opts.pollIntervalMs);
        this.timers.add(poll);
        void this.pump();
        this.startWatching();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        for (const j of this.jobs.splice(0)) j.reject(new Error(`${this.account.email} is shutting down`));
        for (const t of this.timers) clearInterval(t);
        this.timers.clear();
        for (const t of [this.inboxTimer, this.backToInboxTimer, this.previewTimer, this.authTimer]) if (t) clearTimeout(t);
        this.authTimer = null;
        for (const wake of this.sleepers) wake();
        await Promise.allSettled([this.work?.logout(), this.watch?.logout()]);
        await Promise.allSettled([this.pumping, this.watching]);
        // A connection that was still being made when stop() began is closed by connect() itself;
        // this catches anything that slipped in between.
        await Promise.allSettled([this.work?.logout(), this.watch?.logout()]);
        this.work = null;
        this.watch = null;
        this.setState('stopped', null);
    }

    /** Run queued user actions now (call after enqueueing a task). */
    requestTasks(): void {
        if (this.readOnly) return;
        this.pendingTasks = true;
        void this.pump();
    }

    /**
     * Runs fn on the work connection, in the same queue as syncs and tasks so they never
     * collide (bucket create/rename/delete). Afterwards every folder is re-checked. Refuses at
     * once when the account is offline instead of leaving the caller waiting.
     */
    runJob<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
        if (this.readOnly) return Promise.reject(new Error('read-only'));
        if (this.stopped || this.state === 'offline' || this.state === 'auth-failed') {
            return Promise.reject(new Error(`${this.account.email} is offline`));
        }
        return new Promise<T>((resolve, reject) => {
            this.jobs.push({ fn, resolve: resolve as (v: unknown) => void, reject });
            void this.pump();
        });
    }

    /** Something the UI shows changed outside a sync (e.g. a bucket's color): push a new state. */
    touch(): void {
        this.bump([]);
    }

    /** Sweep buckets' old items now (a bucket's setting changed, or the dev trigger), not at its time. */
    requestSweep(): void {
        if (this.readOnly) return;
        this.pendingSweep = true;
        void this.pump();
    }

    /** When the next sweep is due: a day after the last, or an hour after a full batch (more are waiting). */
    private sweepAfter(at: number, moved: number): number {
        return at + (moved >= SWEEP_CAP ? CATCH_UP_MS : this.opts.sweepIntervalMs);
    }

    /** Check every folder for changes now (e.g. the user pressed "Sync now"). */
    requestCheck(): void {
        this.pendingCheck = true;
        void this.pump();
    }

    /**
     * Runs fn on the watch connection, for reading message bodies and attachments without
     * waiting behind syncs. Afterwards the connection returns to idling on INBOX.
     */
    async withReader<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
        const client = this.watch;
        if (!client?.usable) throw new Error(`${this.account.email} is offline`);
        this.readsWaiting++;
        try {
            return await fn(client);
        } finally {
            this.readsWaiting--;
            this.scheduleBackToInbox(client);
        }
    }

    /** Background reads (previews) that should step aside for user reads. */
    private async withBackgroundReader<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
        const client = this.watch;
        if (!client?.usable) throw new Error(`${this.account.email} is offline`);
        try {
            return await fn(client);
        } finally {
            this.scheduleBackToInbox(client);
        }
    }

    // ------------------------------------------------------------------ work queue

    private hasWork(): boolean {
        return this.jobs.length > 0 || this.pendingTasks || this.pendingCheck || this.pendingVerify || this.pendingSweep || this.pendingFolders.size > 0;
    }

    private pump(): Promise<void> {
        if (this.pumping || this.stopped) return this.pumping ?? Promise.resolve();
        this.pumping = (async () => {
            try {
                while (!this.stopped && this.hasWork()) await this.runOneJob();
            } catch (err) {
                if (!(err instanceof Stopped)) this.log(`[${this.account.email}] work queue stopped: ${(err as Error).message}`);
            } finally {
                this.pumping = null;
            }
        })();
        return this.pumping;
    }

    private async runOneJob(): Promise<void> {
        const client = await this.workClient();
        const changes = new ChangeSet();
        let tasks: TaskOutcome[] = [];
        // User actions first: a drag should reach the server within a couple of seconds (Rule 8).
        // The rare daily verification goes before the frequent check so checks can never starve it.
        // The sweep goes last: it reads the cache, so it should see the latest check.
        const job = this.pendingTasks ? 'tasks'
            : this.jobs.length ? 'job'
            : this.pendingFolders.size ? 'folders'
            : this.pendingVerify ? 'verify'
            : this.pendingCheck ? 'check'
            : 'sweep';
        const folders = [...this.pendingFolders];
        const queued = job === 'job' ? this.jobs.shift()! : null;
        let jobResult: { value: unknown } | null = null;
        let swept = 0;
        if (job === 'tasks') this.pendingTasks = false;
        else if (job === 'folders') this.pendingFolders.clear();
        else if (job === 'verify') this.pendingVerify = false;
        else if (job === 'sweep') this.pendingSweep = false;
        else this.pendingCheck = false;

        try {
            if (job === 'tasks') {
                tasks = await runPendingTasks(client, this.store, this.account.id, changes);
                if (tasks.some(t => t.status === 'pending')) {
                    // A network problem interrupted a task: retry after a pause, never in a tight loop.
                    this.pendingTasks = true;
                    await this.sleep(this.nextBackoff());
                }
            } else if (job === 'job') {
                try {
                    jobResult = { value: await queued!.fn(client) };
                } catch (err) {
                    queued!.reject(err);
                    if (!client.usable) throw err;
                }
                // Folders may have been created, renamed or emptied: bring the cache up to date
                // before telling the caller it is done, so what it reads next is current.
                changes.merge((await syncChangedFolders(client, this.store, this.account.id)).changes);
            } else if (job === 'folders') {
                for (const path of folders) await syncFolder(client, this.store, this.account.id, path, changes);
            } else if (job === 'check') {
                changes.merge((await syncChangedFolders(client, this.store, this.account.id)).changes);
                const first = !this.lastSyncAt;
                this.lastSyncAt = new Date().toISOString();
                // Said once, when its first check finishes (a new account's "Loading mail…" ends);
                // later checks are read with the account list, not pushed every minute
                if (first) this.emit('status', this.status());
            } else if (job === 'sweep') {
                const at = Date.now();
                this.nextSweep = this.sweepAfter(at, 0); // a failed sweep waits its turn too
                swept = sweep(this.store, this.account.id, this.autoArchive())?.moved ?? 0;
                this.nextSweep = this.sweepAfter(at, swept);
                if (swept) {
                    this.log(`[${this.account.email}] auto-archive: ${swept} older item(s) queued for Archive`);
                    this.pendingTasks = true;
                }
            } else {
                const repaired = await verifyFolders(client, this.store, this.account.id, changes);
                this.lastVerify = Date.now();
                if (repaired.length) this.log(`[${this.account.email}] verification repaired: ${repaired.join(', ')}`);
            }
        } catch (err) {
            if (this.stopped) throw new Stopped();
            if (!client.usable) {
                // Connection lost mid-job: catch up on everything once reconnected.
                this.dropWork(err);
                this.pendingCheck = true;
                if (job === 'tasks') this.pendingTasks = true;
            } else {
                this.log(`[${this.account.email}] ${job} failed: ${(err as Error).message}`);
            }
        }

        const threads = updateThreads(this.store, this.account.id, changes);
        if (this.applyRules(changes.arrivedInInbox)) this.pendingTasks = true;
        if (threads.mode !== 'none' || tasks.length || job === 'job' || swept) this.bump(tasks);
        // The operation happened on the server even if the follow-up sync was cut short.
        if (jobResult) queued!.resolve(jobResult.value);
    }

    private async workClient(): Promise<ImapFlow> {
        for (;;) {
            if (this.stopped) throw new Stopped();
            if (this.work?.usable) return this.work;
            if (this.state === 'auth-failed' && !this.loginRetry) throw new Stopped();
            const retrying = this.loginRetry;
            this.loginRetry = false;
            this.retryInFlight = retrying;
            try {
                if (!retrying) this.setState('connecting', this.error);
                this.work = await this.connect('work');
                this.retryInFlight = false;
                this.backoff = this.opts.backoffMinMs;
                this.authRetry = this.opts.authRetryMinMs;
                this.setState('online', null);
                this.startWatching(); // its loop ended if a login was refused
                return this.work;
            } catch (err) {
                this.retryInFlight = false;
                if (err instanceof Stopped) throw err;
                if ((err as { authenticationFailed?: boolean }).authenticationFailed) {
                    this.passwordRefused();
                    throw new Stopped();
                }
                this.setState('offline', describe(err));
                await this.sleep(this.nextBackoff());
            }
        }
    }

    private dropWork(err: unknown): void {
        this.work = null;
        if (!this.stopped && this.state !== 'auth-failed') this.setState('offline', describe(err));
    }

    /**
     * Files newly arrived Inbox mail by sender rules. `arrived` only ever holds messages seen by
     * an incremental Inbox sync (whichever job ran it), so a first sync or a cache rebuild (full
     * listings) never files existing mail retroactively. The app's own notices are never filed.
     * Returns how many threads were queued.
     */
    private applyRules(arrived: Set<string>): number {
        if (this.readOnly || !arrived.size) return 0;
        const rules = this.rules();
        if (!rules.length) return 0;
        const buckets = new Map(this.store.listFolders(this.account.id)
            .filter(f => f.role === 'bucket').map(f => [bucketNameOf(f.path), f.path]));
        const arrivals = this.store.db.prepare(`SELECT m.from_addr, m.message_id, m.thread_id, t.location FROM message m
            JOIN placement p ON p.account = m.account AND p.msg_key = m.msg_key AND p.folder = 'INBOX'
            LEFT JOIN thread t ON t.account = m.account AND t.thread_id = m.thread_id
            WHERE m.account = ? AND m.msg_key = ?`);
        const queued = new Set<string>();
        for (const key of arrived) {
            const m = arrivals.get(this.account.id, key) as { from_addr: string | null; message_id: string | null; thread_id: string | null; location: string | null } | undefined;
            if (!m?.thread_id || queued.has(m.thread_id) || this.isOwnNotice(m.message_id)) continue;
            const bucket = matchRule(rules, m.from_addr);
            const target = bucket ? buckets.get(bucket) : undefined;
            if (!target || m.location === target) continue;
            try {
                enqueueMoveThread(this.store, this.account.id, m.thread_id, target, 'rule');
                queued.add(m.thread_id);
            } catch (err) {
                this.log(`[${this.account.email}] rule for ${m.from_addr}: ${describe(err)}`);
            }
        }
        return queued.size;
    }

    // ------------------------------------------------------------------ watch connection

    /** Starts the watch connection's loop unless it's already running. */
    private startWatching(): void {
        if (this.stopped || this.watchRunning) return;
        this.watchRunning = true;
        this.watching = this.keepWatching().finally(() => { this.watchRunning = false; });
    }

    private async keepWatching(): Promise<void> {
        let delay = this.opts.backoffMinMs;
        while (!this.stopped && this.state !== 'auth-failed') {
            try {
                const client = await this.connect('watch');
                this.watch = client;
                if (this.stopped) break; // stop() closes this.watch
                const onInbox = (e: { path?: string }) => { if (!e.path || e.path === 'INBOX') this.inboxChanged(); };
                client.on('exists', onInbox);
                client.on('expunge', onInbox);
                client.on('flags', onInbox);
                // once() rejects if 'error' fires first; swallow that so it can never become an
                // unhandled rejection (which would crash the process). Either way the connection is done.
                const closed = once(client, 'close').catch(() => undefined);
                await client.mailboxOpen('INBOX', { readOnly: true }); // imapflow then IDLEs automatically
                delay = this.opts.backoffMinMs;
                this.inboxChanged(); // catch up on anything that arrived while disconnected
                await closed;
                this.watch = null;
            } catch (err) {
                if (err instanceof Stopped) return;
                if ((err as { authenticationFailed?: boolean }).authenticationFailed) {
                    this.passwordRefused();
                    return;
                }
                this.log(`[${this.account.email}] watch connection: ${describe(err)}`);
            }
            if (this.stopped) return;
            await this.sleep(delay);
            delay = Math.min(delay * 2, this.opts.backoffMaxMs);
        }
    }

    private inboxChanged(): void {
        if (this.stopped || this.inboxTimer) return;
        this.inboxTimer = setTimeout(() => {
            this.inboxTimer = null;
            this.pendingFolders.add('INBOX');
            void this.pump();
        }, this.opts.inboxDebounceMs);
    }

    private scheduleBackToInbox(client: ImapFlow): void {
        if (this.backToInboxTimer) clearTimeout(this.backToInboxTimer);
        this.backToInboxTimer = setTimeout(async () => {
            this.backToInboxTimer = null;
            if (this.stopped || !client.usable || client.mailbox && client.mailbox.path === 'INBOX') return;
            try {
                await client.mailboxOpen('INBOX', { readOnly: true });
                this.inboxChanged(); // notifications were missed while another folder was open
            } catch (err) {
                this.log(`[${this.account.email}] could not return to INBOX: ${describe(err)}`);
            }
        }, 1_000);
    }

    // ------------------------------------------------------------------ helpers

    private async connect(role: 'watch' | 'work'): Promise<ImapFlow> {
        const client = this.createClient(role);
        // imapflow emits 'error' for socket problems; without a listener Node would crash the process.
        client.on('error', err => this.log(`[${this.account.email}] ${role} connection error: ${describe(err)}`));
        if (role === 'work') {
            client.on('close', () => {
                if (this.work === client) {
                    this.dropWork(new Error('connection closed'));
                    if (!this.stopped) this.requestCheck(); // reconnect and catch up
                }
            });
        }
        await client.connect();
        if (this.stopped) {
            // stop() ran while this connection was being made: nobody else will ever close it.
            await client.logout().catch(() => client.close());
            throw new Stopped();
        }
        return client;
    }

    private bump(tasks: TaskOutcome[]): void {
        this.version++;
        this.emit('changed', { account: this.account.id, stateToken: this.stateToken, tasks } satisfies ChangedEvent);
        this.schedulePreviews();
    }

    /**
     * Cards in the Inbox and buckets get previews in the background (first few KB of text only);
     * Archive previews load when opened. Runs on the reader connection, never blocking syncs.
     */
    private schedulePreviews(): void {
        if (this.stopped || this.previewTimer || this.fillingPreviews) return;
        this.previewTimer = setTimeout(async () => {
            this.previewTimer = null;
            if (this.stopped || !this.watch?.usable) return;
            const keys = (this.store.db.prepare(`SELECT t.face_msg_key AS k FROM thread t
                JOIN message m ON m.account = t.account AND m.msg_key = t.face_msg_key
                WHERE t.account = ? AND t.location_role IN ('inbox', 'bucket') AND m.preview IS NULL
                ORDER BY t.face_date DESC LIMIT 200`).all(this.account.id) as { k: string }[]).map(r => r.k);
            if (!keys.length) return;
            this.fillingPreviews = true;
            let again = false;
            try {
                const { filled, yielded } = await this.withBackgroundReader(client =>
                    fillPreviews(client, this.store, this.account.id, keys, () => this.readsWaiting > 0));
                if (filled > 0) {
                    this.version++;
                    this.emit('changed', { account: this.account.id, stateToken: this.stateToken, tasks: [] } satisfies ChangedEvent);
                }
                // Continue if it stepped aside for a user read or there may be more; never spin on failure.
                again = yielded || (filled > 0 && keys.length === 200);
            } catch (err) {
                this.log(`[${this.account.email}] previews: ${describe(err)}`);
            } finally {
                this.fillingPreviews = false;
            }
            if (again) this.schedulePreviews();
        }, 500);
    }

    /**
     * The host refused the password: stop logging in, then try once more after a long wait (the
     * work connection; the watch connection follows when it gets in). Hosts sometimes refuse a good
     * password for a while (owner, 2026-11-10); a wrong one costs one failed login per wait.
     */
    private passwordRefused(): void {
        if (this.state !== 'auth-failed') this.rejectedAt = new Date().toISOString();
        this.setState('auth-failed', 'The mail server rejected the password. Update it in Settings.');
        if (this.stopped || this.authTimer || this.retryInFlight) return;
        this.loginRetry = false; // a refusal that arrives late starts the wait over
        const wait = this.authRetry * (0.9 + Math.random() * 0.2);
        this.authRetry = Math.min(this.authRetry * 2, this.opts.authRetryMaxMs);
        this.log(`[${this.account.email}] password refused; trying again in ${Math.round(wait / 60_000)} min`);
        // Settings says when (the time of the next try)
        this.retryAt = new Date(Date.now() + wait).toISOString();
        this.emit('status', this.status());
        this.authTimer = setTimeout(() => {
            this.authTimer = null;
            if (this.stopped || this.state !== 'auth-failed') return;
            if (this.work?.usable) {
                // Only the watch connection was refused: the work one is still signed in.
                this.setState('online', null);
                this.startWatching();
            } else {
                this.loginRetry = true;
                this.requestCheck();
                // A check that began just before (the minute poll) is about to stop: go again after it.
                void this.pumping?.finally(() => { if (this.loginRetry) this.requestCheck(); });
            }
        }, wait);
    }

    private setState(state: ConnectionState, error: string | null): void {
        if (this.state === state && this.error === error) return;
        this.state = state;
        this.error = error;
        if (state !== 'auth-failed') {
            this.rejectedAt = null;
            this.retryAt = null;
        }
        this.emit('status', this.status());
    }

    private nextBackoff(): number {
        const current = this.backoff;
        this.backoff = Math.min(this.backoff * 2, this.opts.backoffMaxMs);
        return current * (0.8 + Math.random() * 0.4); // jitter
    }

    private sleep(ms: number): Promise<void> {
        if (this.stopped) return Promise.resolve();
        return new Promise(resolve => {
            const wake = () => { clearTimeout(timer); this.sleepers.delete(wake); resolve(); };
            const timer = setTimeout(wake, ms);
            this.sleepers.add(wake);
        });
    }
}

function describe(err: unknown): string {
    const e = err as { message?: string; code?: string; responseText?: string };
    return e?.responseText || e?.message || e?.code || String(err);
}
