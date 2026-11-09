// Bucket management against the harness, and the API's login and request-forgery protection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ImapFlow } from 'imapflow';
import { connect, freshUser, deliver, FOLDERS } from './engineHelpers.ts';
import { HARNESS } from './helpers.mjs';
import { Store } from '../src/store/store.ts';
import { AccountWorker, WATCH_AUTO_IDLE_MS } from '../src/worker/accountWorker.ts';
import { AppDb } from '../src/app/appDb.ts';
import { Auth } from '../src/app/auth.ts';
import { Accounts } from '../src/app/accounts.ts';
import { Buckets, BucketError } from '../src/app/buckets.ts';
import { loadOrCreateKey } from '../src/app/secrets.ts';
import { createApiServer } from '../src/api/server.ts';

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('timed out');
}

async function setup() {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS.filter(f => !f.includes('Buckets'))) await phone.mailboxCreate(f);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buckets-'));
    const app = new AppDb(path.join(dir, 'app.sqlite'));
    const key = loadOrCreateKey(path.join(dir, 'secret.key'));
    const accounts = new Accounts(app, key);
    const account = accounts.create({ email: user, imap: { host: HARNESS.host, port: HARNESS.port, secure: false, user, pass: 'pass' } });
    const store = new Store(':memory:');
    const worker = new AccountWorker(accounts.imapConfigs()[0], store, {
        backoffMinMs: 100, inboxDebounceMs: 50,
        createClient: role => new ImapFlow({
            host: HARNESS.host, port: HARNESS.port, secure: false, auth: { user, pass: 'pass' }, logger: false,
            qresync: role === 'work', ...(role === 'watch' ? { autoIdleDelay: WATCH_AUTO_IDLE_MS } : {}),
        }),
    });
    worker.start();
    await until(() => worker.status().state === 'online' && store.listFolders(account.id).length > 0);
    const buckets = new Buckets(app, store);
    const auth = new Auth(app);
    return {
        user, phone, store, worker, app, accounts, buckets, auth, accountId: account.id,
        async folders() { return (await phone.list()).map(f => f.path).sort(); },
        async count(folder: string) { const st = await phone.status(folder, { messages: true }); return st ? st.messages ?? 0 : 0; },
        async close() { await worker.stop(); await phone.logout().catch(() => {}); store.close(); app.close(); },
    };
}

test('buckets: create, rename keeps mail and look, reorder, delete moves mail to Archive (D18)', async () => {
    const t = await setup();
    try {
        const reads = await t.buckets.create(t.worker, t.accountId, 'Reads', { color: '#8b5cf6', emoji: '📖' });
        assert.deepEqual([reads.name, reads.path, reads.color, reads.emoji], ['Reads', 'INBOX.Buckets.Reads', '#8b5cf6', '📖']);
        assert.ok((await t.folders()).includes('INBOX.Buckets.Reads'), 'a real folder on the server');
        await assert.rejects(t.buckets.create(t.worker, t.accountId, 'reads'), BucketError, 'no duplicates');
        await t.buckets.create(t.worker, t.accountId, 'Re.Tech');
        assert.ok((await t.folders()).includes('INBOX.Buckets.Re-Tech'), 'the folder delimiter cannot split a bucket name');

        await deliver(t.phone, 'INBOX.Buckets.Reads', { id: 'essay@test' });
        await deliver(t.phone, 'INBOX.Buckets.Reads', { id: 'poem@test' });
        t.worker.requestCheck();
        await until(() => t.buckets.list(t.accountId).find(b => b.name === 'Reads')?.count === 2);
        t.app.db.prepare(`INSERT INTO rules (id, account_id, sender_pattern, bucket, created_at) VALUES ('r1', ?, 'news@x.example', 'Reads', '2026')`).run(t.accountId);

        const subscribed = async () => {
            const phone = await connect(t.user);
            try { return (await phone.list()).filter(f => f.subscribed).map(f => f.path); } finally { await phone.logout(); }
        };
        assert.ok((await subscribed()).includes('INBOX.Buckets.Reads'), 'a new bucket is subscribed');
        const renamed = await t.buckets.rename(t.worker, t.accountId, 'Reads', 'Reading');
        const afterRename = await subscribed();
        assert.ok(afterRename.includes('INBOX.Buckets.Reading') && !afterRename.includes('INBOX.Buckets.Reads'), 'the subscription follows the rename');
        assert.deepEqual([renamed.name, renamed.color, renamed.emoji, renamed.count], ['Reading', '#8b5cf6', '📖', 2], 'mail and look kept');
        assert.equal(await t.count('INBOX.Buckets.Reading'), 2);
        assert.ok(!(await t.folders()).includes('INBOX.Buckets.Reads'));
        assert.equal((t.app.db.prepare('SELECT bucket FROM rules').get() as { bucket: string }).bucket, 'Reading', 'rules follow the rename');

        const ordered = t.buckets.reorder(t.worker, t.accountId, ['Re-Tech', 'Reading']);
        assert.deepEqual(ordered.map(b => b.name), ['Re-Tech', 'Reading']);
        assert.equal(t.buckets.setAppearance(t.worker, t.accountId, 'Re-Tech', { color: '#f59e0b', showBadge: true }).showBadge, true);
        assert.equal(ordered.find(b => b.name === 'Re-Tech')?.showOnHome, false, 'not on home unless asked');
        const onHome = t.buckets.setAppearance(t.worker, t.accountId, 'Re-Tech', { showOnHome: true });
        assert.deepEqual([onHome.showOnHome, onHome.showBadge, onHome.color], [true, true, '#f59e0b'], 'the rest of the look is kept');
        assert.equal(t.buckets.setAppearance(t.worker, t.accountId, 'Re-Tech', { color: '#10b981' }).showOnHome, true, 'kept when the color changes');
        assert.throws(() => t.buckets.setAppearance(t.worker, t.accountId, 'Re-Tech', { showOnHome: 'yes' as unknown as boolean }), /true or false/);
        assert.equal(t.buckets.setAppearance(t.worker, t.accountId, 'Re-Tech', { emoji: 'icon:graduation-cap' }).emoji, 'icon:graduation-cap', 'a line icon by name');
        assert.throws(() => t.buckets.setAppearance(t.worker, t.accountId, 'Re-Tech', { emoji: 'icon:Not an icon name' }), /too long/);
        assert.throws(() => t.buckets.setAppearance(t.worker, t.accountId, 'Re-Tech', { emoji: 'a long run of text' }), /too long/);

        const { movedToArchive } = await t.buckets.remove(t.worker, t.accountId, 'Reading');
        assert.ok(!(await subscribed()).includes('INBOX.Buckets.Reading'), 'no subscription left for the deleted bucket');
        assert.equal(movedToArchive, 2);
        assert.equal(await t.count('INBOX.Archive'), 2, 'nothing deleted: the mail is in Archive');
        assert.ok(!(await t.folders()).includes('INBOX.Buckets.Reading'));
        assert.equal((t.app.db.prepare('SELECT COUNT(*) n FROM rules').get() as { n: number }).n, 0, 'its rules are gone');
        await until(() => !t.buckets.list(t.accountId).some(b => b.name === 'Reading'));
    } finally {
        await t.close();
    }
});

test('API: login required, cookie flags, cross-site and non-JSON writes refused, logout, rate limit', async () => {
    const t = await setup();
    const server = createApiServer({ store: t.store, workers: new Map([[t.accountId, t.worker]]), auth: t.auth, accounts: t.accounts, buckets: t.buckets });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    const call = (p: string, init: RequestInit & { cookie?: string } = {}) =>
        fetch(base + p, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.cookie ? { Cookie: init.cookie } : {}), ...init.headers } });
    const tryServer = () => call('/accounts/test', { method: 'POST', body: JSON.stringify({ imap: { host: '127.0.0.1', port: 1, user: 'x', pass: 'y' } }) });
    try {
        // First run, before any login exists: the setup wizard may try the mail server, nothing else.
        assert.equal((await tryServer()).status, 200);
        assert.equal((await call('/accounts')).status, 401);
        await t.auth.createUser('owner', 'correct horse battery');
        assert.equal((await tryServer()).status, 401, 'closed again once a login exists');

        assert.deepEqual(await (await call('/auth/status')).json(), { enabled: true, configured: true, authenticated: false, user: null });
        assert.equal((await call('/accounts')).status, 401, 'nothing without logging in');
        assert.equal((await call('/events')).status, 401, 'not even the event stream');

        assert.equal((await call('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'owner', passphrase: 'nope' }) })).status, 401);
        const login = await call('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'owner', passphrase: 'correct horse battery' }) });
        assert.equal(login.status, 200);
        const setCookie = login.headers.get('set-cookie') ?? '';
        assert.match(setCookie, /em_session=[\w-]{40,}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000/);
        const cookie = setCookie.split(';')[0];

        const accounts = await (await call('/accounts', { cookie })).json();
        assert.equal(accounts.accounts[0].email, t.user);
        assert.ok(!JSON.stringify(accounts).includes('"pass'), 'no password in responses');

        // Request forgery protection on writes.
        const create = (headers: Record<string, string>) => call(`/accounts/${t.accountId}/buckets`, { method: 'POST', cookie, body: JSON.stringify({ name: 'Tasks' }), headers });
        assert.equal((await create({ Origin: 'https://evil.example' })).status, 403, 'cross-site refused');
        assert.equal((await create({ 'Content-Type': 'text/plain' })).status, 415, 'form-style post refused');
        const made = await create({ Origin: base.replace('/api/v2', '') });
        assert.equal(made.status, 201, 'same-origin JSON works');
        const renamed = await call(`/accounts/${t.accountId}/buckets/Tasks`, { method: 'PATCH', cookie, body: JSON.stringify({ name: 'To do', color: '#10b981' }) });
        assert.equal((await renamed.json()).bucket.name, 'To do');
        assert.equal((await call(`/accounts/${t.accountId}/buckets/${encodeURIComponent('To do')}`, { method: 'DELETE', cookie, body: '{}' })).status, 200);

        const prefs = await call(`/accounts/${t.accountId}`, { method: 'PATCH', cookie, body: JSON.stringify({ inboxView: 'thread', displayName: 'Sam', tabName: ' Home ' }) });
        assert.deepEqual([(await prefs.json()).account.inboxView, t.accounts.get(t.accountId)?.displayName, t.accounts.get(t.accountId)?.tabName], ['thread', 'Sam', 'Home']);
        assert.equal((await call(`/accounts/${t.accountId}`, { method: 'PATCH', cookie, body: JSON.stringify({ tabName: 'Thirteen char' }) })).status, 400, 'a tab name over 12 characters is refused');
        assert.equal(t.accounts.get(t.accountId)?.tabName, 'Home');
        assert.equal((await (await call('/accounts', { cookie })).json()).accounts[0].tabName, 'Home', 'the account list carries it');

        assert.equal((await call('/auth/logout', { method: 'POST', cookie, body: '{}' })).status, 200);
        assert.equal((await call('/accounts', { cookie })).status, 401, 'logged out for real (server-side)');

        for (let i = 0; i < 20; i++) await call('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'owner', passphrase: 'guess' + i }) });
        const limited = await call('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'owner', passphrase: 'correct horse battery' }) });
        assert.equal(limited.status, 429);
        assert.ok(Number(limited.headers.get('retry-after')) > 0);
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await t.close();
    }
});

test('API: home answers Up next in one go: every conversation in the buckets shown on home', async () => {
    const t = await setup();
    const server = createApiServer({ store: t.store, workers: new Map([[t.accountId, t.worker]]), accounts: t.accounts, buckets: t.buckets });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const home = async () => (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2/accounts/${t.accountId}/home`)).json();
    try {
        await t.buckets.create(t.worker, t.accountId, 'Today');
        await t.buckets.create(t.worker, t.accountId, 'Later');
        await deliver(t.phone, 'INBOX.Buckets.Today', { id: 'call-back@test' });
        await deliver(t.phone, 'INBOX.Buckets.Today', { id: 'pay-bill@test' });
        await deliver(t.phone, 'INBOX.Buckets.Later', { id: 'someday@test' });
        t.worker.requestCheck();
        await until(() => t.buckets.list(t.accountId).find(b => b.name === 'Today')?.count === 2);
        assert.deepEqual((await home()).buckets, [], 'nothing on home until a bucket is marked');
        t.buckets.setAppearance(t.worker, t.accountId, 'Today', { showOnHome: true });
        const answer = await home();
        assert.deepEqual(answer.buckets.map((b: { name: string; path: string; threads: unknown[] }) => [b.name, b.path, b.threads.length]), [['Today', 'INBOX.Buckets.Today', 2]]);
        assert.ok(typeof answer.state === 'string' && Array.isArray(answer.drafts), 'with the state and the drafts');
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await t.close();
    }
});

test('API: a second engine on the same machine keeps its own session cookie (browsers share cookies across ports)', async () => {
    const t = await setup();
    const server = createApiServer({ store: t.store, workers: new Map([[t.accountId, t.worker]]), auth: t.auth, accounts: t.accounts, cookieName: 'em_session_copy' });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    try {
        await t.auth.createUser('owner', 'correct horse battery');
        const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'owner', passphrase: 'correct horse battery' }) });
        const token = /^em_session_copy=([\w-]{40,});/.exec(login.headers.get('set-cookie') ?? '')?.[1];
        assert.ok(token, 'set under its own name');
        const accounts = (cookie: string) => fetch(`${base}/accounts`, { headers: { Cookie: cookie } }).then(r => r.status);
        assert.equal(await accounts(`em_session=${token}`), 401, "the everyday app's cookie name is not read");
        assert.equal(await accounts(`em_session=from-the-everyday-app; em_session_copy=${token}`), 200, 'its own is, beside the other');
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await t.close();
    }
});
