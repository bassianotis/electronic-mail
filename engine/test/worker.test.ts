// Live behaviour (Rules 5, 6): IDLE, background checks, reconnects, auth failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { connect, freshUser, deliver, FOLDERS } from './engineHelpers.ts';
import { HARNESS } from './helpers.mjs';
import { Store } from '../src/store/store.ts';
import { AccountWorker, WATCH_AUTO_IDLE_MS, type AccountStatus, type WorkerOptions } from '../src/worker/accountWorker.ts';
import { enqueueMoveThread } from '../src/tasks/tasks.ts';
import { SWEEP_CAP } from '../src/app/autoArchive.ts';
import { folderView } from '../src/views/views.ts';

const COMPOSE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dovecot/docker-compose.yml');

/** Server-side disconnect of every session of a user, like a network drop or server restart. */
function kick(user: string): void {
    execFileSync('docker', ['compose', '-f', COMPOSE, 'exec', '-T', 'dovecot', 'doveadm', 'kick', user], { stdio: 'ignore' });
}

async function until(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for: ${what}`);
}

async function setup(options: WorkerOptions = {}, firstPassword = 'pass') {
    let password = firstPassword;
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS) await phone.mailboxCreate(f);
    const store = new Store(':memory:');
    const account = { id: 'acct-1', email: user, host: HARNESS.host, port: HARNESS.port, secure: false, user, pass: password };
    let connections = 0;
    const attempts: number[] = [];
    const statuses: AccountStatus[] = [];
    const worker = new AccountWorker(account, store, {
        pollIntervalMs: 60_000,
        backoffMinMs: 100,
        backoffMaxMs: 400,
        inboxDebounceMs: 50,
        ...options,
        createClient: role => {
            connections++;
            attempts.push(Date.now());
            return new ImapFlow({
                host: HARNESS.host, port: HARNESS.port, secure: false,
                auth: { user, pass: password }, logger: false, qresync: role === 'work',
                ...(role === 'watch' ? { autoIdleDelay: WATCH_AUTO_IDLE_MS } : {}),
            });
        },
    });
    worker.on('status', s => statuses.push(s));
    const inbox = () => folderView(store, account.id, 'INBOX').count;
    return {
        user, phone, store, worker, statuses, inbox,
        connections: () => connections,
        /** When each login began. */
        attempts,
        /** What the app logs in with from now on (as if the host stopped or started accepting it). */
        setPassword: (p: string) => { password = p; },
        async close() {
            await worker.stop();
            await phone.logout().catch(() => {});
            store.close();
        },
    };
}

test('initial sync, then new mail arrives via IDLE within seconds', async () => {
    const t = await setup(); // poll is 60 s: only IDLE can deliver this in time
    try {
        await deliver(t.phone, 'INBOX');
        t.worker.start();
        await until('initial sync', () => t.inbox() === 1);
        await new Promise(r => setTimeout(r, WATCH_AUTO_IDLE_MS + 200)); // watch connection is now idling
        const before = t.worker.stateToken;

        await deliver(t.phone, 'INBOX');
        await until('IDLE-driven sync', () => t.inbox() === 2, 3000);
        assert.notEqual(t.worker.stateToken, before, 'state token changes so the UI refetches');
        assert.equal(t.worker.status().state, 'online');
    } finally {
        await t.close();
    }
});

test('background check picks up changes the phone made in other folders', async () => {
    const t = await setup({ pollIntervalMs: 300 });
    try {
        await deliver(t.phone, 'INBOX.Archive', { id: 'arch@test' });
        t.worker.start();
        await until('initial sync', () => folderView(t.store, 'acct-1', 'INBOX.Archive').count === 1);

        const lock = await t.phone.getMailboxLock('INBOX.Archive');
        try { await t.phone.messageMove('1:*', 'INBOX.Buckets.Reads', { uid: true }); } finally { lock.release(); }
        await until('poll noticed the move', () => folderView(t.store, 'acct-1', 'INBOX.Buckets.Reads').count === 1);
        assert.equal(folderView(t.store, 'acct-1', 'INBOX.Archive').count, 0);
    } finally {
        await t.close();
    }
});

test('a queued move reaches the server promptly, without waiting for the poll', async () => {
    const t = await setup();
    try {
        await deliver(t.phone, 'INBOX', { id: 'drag@test' });
        t.worker.start();
        await until('initial sync', () => t.inbox() === 1);
        const threadId = folderView(t.store, 'acct-1', 'INBOX').threads[0].threadId;

        const started = Date.now();
        enqueueMoveThread(t.store, 'acct-1', threadId, 'INBOX.Archive');
        t.worker.requestTasks();
        await until('task done', () => (t.store.db.prepare(`SELECT status FROM task`).get() as { status: string }).status === 'done', 3000);
        assert.ok(Date.now() - started < 2000, `confirmed by the server in ${Date.now() - started} ms`);

        if (t.phone.mailbox) await t.phone.mailboxClose();
        const lock = await t.phone.getMailboxLock('INBOX.Archive', { readOnly: true });
        try { assert.equal(t.phone.mailbox && t.phone.mailbox.exists, 1); } finally { lock.release(); }
    } finally {
        await t.close();
    }
});

test('connection-dropped-during-idle: reconnects by itself and catches up', async () => {
    const t = await setup();
    try {
        t.worker.start();
        await until('online', () => t.worker.status().state === 'online');
        await until('watching INBOX', () => t.connections() >= 2);

        kick(t.user); // the server drops every connection, including the phone's
        await t.phone.logout().catch(() => {});
        const phone2: ImapFlow = await connect(t.user);
        try {
            await deliver(phone2, 'INBOX', { id: 'while-down@test' });
            await until('reconnected and caught up', () => t.inbox() === 1, 8000);
            assert.ok(t.statuses.some(s => s.state === 'offline'), 'went offline');
            await until('back online', () => t.worker.status().state === 'online');

            await deliver(phone2, 'INBOX'); // IDLE works again after reconnecting
            await until('IDLE after reconnect', () => t.inbox() === 2, 5000);
        } finally {
            await phone2.logout().catch(() => {});
        }
    } finally {
        await t.close();
    }
});

test('a rejected password waits a long time before trying again, instead of hammering the server', async () => {
    const t = await setup({}, 'wrong-password');
    try {
        t.worker.start();
        await until('auth-failed', () => t.worker.status().state === 'auth-failed');
        const attempts = t.connections();
        await new Promise(r => setTimeout(r, 800)); // several backoff periods
        assert.equal(t.connections(), attempts, 'no further login attempts');
        assert.match(t.worker.status().error ?? '', /password/);
    } finally {
        await t.close();
    }
});

test('after a rejected password, one login per wait until the host accepts it again, then back online with IDLE', async () => {
    const WAIT = 1000;
    const refusals: number[] = [];
    const t = await setup({
        authRetryMinMs: WAIT, authRetryMaxMs: WAIT,
        log: m => { if (/password refused/.test(m)) refusals.push(Date.now()); },
    }, 'wrong-password');
    try {
        const shown = new Set<string>();
        t.worker.on('status', s => shown.add(s.state));
        t.worker.start();
        // Dovecot slows each login after a refusal (by 2 to 15 s), so this waits for two retries, however long they take.
        await until('two retries', () => t.attempts.length >= 4, 40_000);
        assert.deepEqual([...shown], ['connecting', 'auth-failed'], 'the status stays "auth-failed" while it retries');
        for (const at of t.attempts.slice(2)) { // the first two are the two connections starting
            const refused = refusals.filter(r => r <= at).at(-1);
            assert.ok(refused !== undefined && at - refused >= WAIT * 0.9, `a retry waits after the last refusal (${refused === undefined ? 'none' : at - refused} ms)`);
            assert.equal(t.attempts.filter(a => a > refused! && a <= at).length, 1, 'one login per wait');
        }

        t.setPassword('pass'); // the host accepts it again (owner, 2026-11-10: it had refused a good password overnight)
        await deliver(t.phone, 'INBOX');
        await until('back online and caught up', () => t.worker.status().state === 'online' && t.inbox() === 1, 40_000);
        assert.equal(t.worker.status().error, null);
        await new Promise(r => setTimeout(r, WATCH_AUTO_IDLE_MS + 300));
        await deliver(t.phone, 'INBOX'); // poll is 60 s: only a restarted watch connection sees this in time
        await until('IDLE after the retry', () => t.inbox() === 2, 3000);
    } finally {
        await t.close();
    }
});

test('daily verification repairs a cache that drifted from the server', async () => {
    const t = await setup({ pollIntervalMs: 200, verifyIntervalMs: 0 });
    try {
        await deliver(t.phone, 'INBOX');
        await deliver(t.phone, 'INBOX');
        t.worker.start();
        await until('initial sync', () => t.inbox() === 2);
        // Simulate a bug that lost a placement without moving any checkpoint.
        t.store.db.prepare(`DELETE FROM placement WHERE folder = 'INBOX' AND uid = 1`).run();
        await until('verification repaired it', () =>
            (t.store.db.prepare(`SELECT COUNT(*) n FROM placement WHERE folder = 'INBOX'`).get() as { n: number }).n === 2);
    } finally {
        await t.close();
    }
});

test('auto-archive sweeps once a day: at the first start, not again on a restart, but an hour after a full batch', async () => {
    const READS = 'INBOX.Buckets.Reads';
    const t = await setup({ autoArchive: () => [{ name: 'Reads', path: READS, days: 30 }] });
    const reads = () => folderView(t.store, 'acct-1', READS).count;
    const sweeps = () => (t.store.db.prepare('SELECT COUNT(*) AS n FROM sweep').get() as { n: number }).n;
    const old = new Date(Date.now() - 40 * 24 * 60 * 60_000);
    try {
        await deliver(t.phone, READS, { id: 'old1@test', date: old });
        t.worker.start();
        await until('the first sweep', () => sweeps() === 1 && reads() === 0);

        await deliver(t.phone, READS, { id: 'old2@test', date: old });
        await t.worker.stop();
        t.worker.start();
        await until('the restart\'s check', () => reads() === 1);
        await new Promise(r => setTimeout(r, 300));
        assert.equal(sweeps(), 1, 'a restart within the day doesn\'t sweep again');
        assert.equal(reads(), 1);

        // A full batch an hour ago: more were waiting, so the next sweep is due.
        t.store.db.prepare('INSERT INTO sweep (account, created_at, moves, seen) VALUES (?, ?, ?, 1)').run('acct-1',
            new Date(Date.now() - 61 * 60_000).toISOString(), JSON.stringify(Array.from({ length: SWEEP_CAP }, () => ({ taskId: 0, bucket: 'Reads' }))));
        await t.worker.stop();
        t.worker.start();
        await until('the catch-up sweep', () => reads() === 0);
    } finally {
        await t.close();
    }
});

test('stopping while still connecting returns promptly and leaves no connection open (account removed right after adding)', async () => {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS) await phone.mailboxCreate(f);
    const store = new Store(':memory:');
    const clients: ImapFlow[] = [];
    const worker = new AccountWorker({ id: 'acct-1', email: user, host: HARNESS.host, port: HARNESS.port, secure: false, user, pass: 'pass' }, store, {
        backoffMinMs: 100,
        createClient: role => {
            const client = new ImapFlow({
                host: HARNESS.host, port: HARNESS.port, secure: false, auth: { user, pass: 'pass' }, logger: false,
                qresync: role === 'work', ...(role === 'watch' ? { autoIdleDelay: WATCH_AUTO_IDLE_MS } : {}),
            });
            const connectNow = client.connect.bind(client);
            client.connect = async () => { await new Promise(r => setTimeout(r, 300)); await connectNow(); }; // a slow server
            clients.push(client);
            return client;
        },
    });
    try {
        worker.start();
        await new Promise(r => setTimeout(r, 50)); // both connections are on their way
        const started = Date.now();
        await worker.stop();
        assert.ok(Date.now() - started < 3000, `stop() took ${Date.now() - started} ms`);
        await until('every connection closed', () => clients.length > 0 && clients.every(c => !c.usable), 3000);
        assert.equal(worker.status().state, 'stopped');
    } finally {
        await phone.logout().catch(() => {});
        store.close();
    }
});
