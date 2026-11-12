// Accounts in the app and settings import/export (Phase 2 slice 5).
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
import { AppDb } from '../src/app/appDb.ts';
import { Accounts } from '../src/app/accounts.ts';
import { Rules } from '../src/app/rules.ts';
import { loadOrCreateKey } from '../src/app/secrets.ts';
import { AccountManager, testConnection } from '../src/app/manager.ts';
import { exportSettings, importSettings } from '../src/app/settings.ts';
import { createApiServer } from '../src/api/server.ts';
import { discoverServers, knownProvider } from '../src/app/discover.ts';

const imap = (user: string, pass = 'pass') => ({ host: HARNESS.host, port: HARNESS.port, secure: false, user, pass });
const smtp = { host: '127.0.0.1', port: 11025, secure: false, user: 'x', pass: 'y' };

async function until(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 60));
    }
    throw new Error(`timed out: ${what}`);
}

function appLayer() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-'));
    const app = new AppDb(path.join(dir, 'app.sqlite'));
    const accounts = new Accounts(app, loadOrCreateKey(path.join(dir, 'secret.key')));
    return { app, accounts, rules: new Rules(app) };
}

test('testConnection explains failures in plain words', async () => {
    const user = freshUser();
    const ok = await testConnection({ imap: imap(user), smtp });
    assert.deepEqual(ok, { imap: { ok: true }, smtp: { ok: true } });

    const wrong = await testConnection({ imap: imap(user, 'wrong') });
    assert.match(wrong.imap.error ?? '', /rejected the username or password/);
    const refused = await testConnection({ imap: { ...imap(user), port: 1 } });
    assert.match(refused.imap.error ?? '', /refused the connection/);
    const unknown = await testConnection({ imap: { ...imap(user), host: 'no-such-host.invalid' } });
    assert.match(unknown.imap.error ?? '', /not found/);
    const badSmtp = await testConnection({ imap: imap(user), smtp: { ...smtp, port: 1 } });
    assert.equal(badSmtp.imap.ok, true);
    assert.match(badSmtp.smtp?.error ?? '', /refused the connection/);
});

test('accounts added and removed while running; the event stream hears about new accounts; mailbox untouched', async () => {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS) await phone.mailboxCreate(f);
    await deliver(phone, 'INBOX', { id: 'keep-me@test' });
    const { app, accounts, rules } = appLayer();
    const store = new Store(':memory:');
    const manager = new AccountManager({ store, accounts, rules, workerOptions: { backoffMinMs: 100, inboxDebounceMs: 50 } });
    const server = createApiServer({ store, workers: manager.workers, accounts, rules, manager, app });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    const post = (p: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    // An event stream opened before the account exists.
    const events: string[] = [];
    const controller = new AbortController();
    const stream = (async () => {
        const res = await fetch(`${base}/events`, { signal: controller.signal });
        try { for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) events.push(new TextDecoder().decode(chunk)); } catch { /* closed */ }
    })();
    try {
        assert.equal((await post('/accounts', { email: 'not-an-address', imap: imap(user) })).status, 400);
        const wrong = await post('/accounts', { email: user, imap: imap(user, 'wrong') });
        assert.equal(wrong.status, 400);
        assert.match((await wrong.json()).error, /Incoming mail \(IMAP\): the server rejected the username or password/);
        assert.equal(accounts.list().length, 0, 'nothing saved when the test fails');

        const created = await post('/accounts', { email: user, displayName: 'New', imap: imap(user), smtp });
        assert.equal(created.status, 201);
        const { account } = await created.json();
        await until('online and synced', () => manager.workers.get(account.id)?.status().state === 'online'
            && !!store.db.prepare(`SELECT 1 FROM message WHERE msg_key = 'keep-me@test'`).get());
        await until('the open stream heard about it', () => events.join('').includes('event: accounts') && events.join('').includes(account.id));
        assert.equal((await post(`/accounts/${account.id}/bad`, {})).status, 404);

        const removed = await fetch(`${base}/accounts/${account.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(removed.status, 200);
        assert.equal(manager.workers.size, 0);
        assert.equal(accounts.list().length, 0);
        for (const table of ['folder', 'message', 'placement', 'thread']) {
            assert.equal((store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n, 0, `${table} forgotten`);
        }
        const st = await phone.status('INBOX', { messages: true });
        assert.equal(st && st.messages, 1, 'the mailbox itself is untouched');
    } finally {
        controller.abort();
        await stream;
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await manager.stopAll();
        await phone.logout().catch(() => {});
        store.close();
        app.close();
    }
});

test('outgoing mail settings: shown without passwords, tried before saving, password kept when not retyped, removable', async () => {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS) await phone.mailboxCreate(f);
    const { app, accounts, rules } = appLayer();
    const store = new Store(':memory:');
    const manager = new AccountManager({ store, accounts, rules, workerOptions: { backoffMinMs: 100, inboxDebounceMs: 50 } });
    const server = createApiServer({ store, workers: manager.workers, accounts, rules, manager, app });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    const send = (method: string, p: string, body: unknown) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
        const { account } = await (await send('POST', '/accounts', { email: user, imap: imap(user), smtp })).json();
        const settings = async () => (await (await fetch(`${base}/accounts/${account.id}/settings`)).json()).settings;
        const shown = await settings();
        assert.deepEqual(shown.smtp, { host: '127.0.0.1', port: 11025, secure: false, user: 'x' });
        assert.ok(!JSON.stringify(shown).includes('pass'), 'never a password');

        const refused = await send('PATCH', `/accounts/${account.id}`, { smtp: { ...shown.smtp, port: 1 } });
        assert.equal(refused.status, 400);
        assert.match((await refused.json()).error, /Outgoing mail \(SMTP\): the server refused the connection/);
        assert.equal((await settings()).smtp.port, 11025, 'nothing saved when the try fails');

        const kept = await send('PATCH', `/accounts/${account.id}`, { smtp: { ...shown.smtp, user: 'someone' } }); // no password typed
        assert.equal(kept.status, 200);
        assert.equal((await settings()).smtp.user, 'someone');
        assert.equal(accounts.smtpConfig(account.id)?.pass, smtp.pass, 'the saved password is kept');

        const removed = await send('PATCH', `/accounts/${account.id}`, { smtp: null });
        assert.equal((await removed.json()).account.hasSmtp, false);
        assert.equal((await settings()).smtp, null);
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await manager.stopAll();
        await phone.logout().catch(() => {});
        store.close();
        app.close();
    }
});

test('settings export has no passwords; import restores bucket looks and rules; unknown accounts skipped', () => {
    const a = appLayer();
    const acct = a.accounts.create({ email: 'Me@Example.com', displayName: 'Me', inboxView: 'thread',
        imap: { host: 'mail.example.com', port: 993, secure: true, user: 'me@example.com', pass: 'imap-Secret' },
        smtp: { host: 'mail.example.com', port: 465, secure: true, user: 'me@example.com', pass: 'smtp-Secret' } });
    a.app.db.prepare(`INSERT INTO bucket_meta (account_id, name, color, emoji, sort_order, show_badge, show_on_home) VALUES (?, 'Reads', '#8b5cf6', '📖', 2, 1, 1)`).run(acct.id);
    a.rules.add(acct.id, 'news@example.com', 'Reads');
    assert.equal(a.accounts.update(acct.id, { tabName: '  Work  ' })?.tabName, 'Work', 'a tab name is trimmed');
    assert.equal(a.accounts.update(acct.id, { tabName: '' })?.tabName, null, 'empty: back to the part before the @');
    assert.throws(() => a.accounts.update(acct.id, { tabName: 'Thirteen char' }), /at most 12/);
    a.accounts.update(acct.id, { tabName: 'Work' });
    assert.equal(a.accounts.update(acct.id, { signature: 'Alex\r\nBook club   \n\n' })?.signature, 'Alex\nBook club', 'a signature keeps its lines, not the blank end');
    assert.equal(a.accounts.update(acct.id, { signature: '  ' })?.signature, null, 'blank: no signature');
    a.accounts.update(acct.id, { signature: 'Alex' });
    const file = exportSettings(a.app, a.accounts, a.rules);
    assert.equal(file.accounts[0].tabName, 'Work', 'the export carries the tab name');
    assert.equal(file.accounts[0].signature, 'Alex', 'and the signature');
    const text = JSON.stringify(file);
    assert.ok(!text.includes('Secret'), 'no passwords in the export');
    assert.equal(file.accounts[0].imap?.host, 'mail.example.com');

    const b = appLayer();
    const same = b.accounts.create({ email: 'me@example.com', imap: { host: 'h', port: 993, secure: true, user: 'u', pass: 'p' } });
    file.accounts.push({ ...file.accounts[0], email: 'stranger@example.com' });
    const summary = importSettings(b.app, b.accounts, b.rules, JSON.parse(JSON.stringify(file)));
    assert.deepEqual([summary.updatedAccounts, summary.skippedAccounts, summary.buckets, summary.rules],
        [['me@example.com'], ['stranger@example.com'], 1, 1]);
    assert.deepEqual({ ...b.app.db.prepare('SELECT name, color, emoji, sort_order, show_badge, show_on_home FROM bucket_meta').get() as object },
        { name: 'Reads', color: '#8b5cf6', emoji: '📖', sort_order: 2, show_badge: 1, show_on_home: 1 });
    assert.deepEqual(b.rules.list(same.id).map(r => [r.senderPattern, r.bucket]), [['news@example.com', 'Reads']]);
    assert.equal(b.accounts.get(same.id)?.inboxView, 'thread');
    assert.equal(b.accounts.get(same.id)?.tabName, 'Work', 'and the import restores it');
    assert.equal(b.accounts.get(same.id)?.signature, 'Alex', 'the signature too');
    assert.equal(importSettings(b.app, b.accounts, b.rules, file).rules, 0, 'importing twice adds no duplicate rules');
    assert.throws(() => importSettings(b.app, b.accounts, b.rules, { hello: 'world' }), /not an Electronic Mail settings file/);

    // A file exported before "Show on home" existed has no showOnHome: the bucket imports as off.
    // Before tab names, no tabName: the account keeps its own.
    const older = JSON.parse(JSON.stringify(file));
    delete older.accounts[0].buckets[0].showOnHome;
    delete older.accounts[0].tabName;
    importSettings(b.app, b.accounts, b.rules, older);
    assert.equal((b.app.db.prepare('SELECT show_on_home FROM bucket_meta').get() as { show_on_home: number }).show_on_home, 0);
    assert.equal(b.accounts.get(same.id)?.tabName, 'Work');
    const tooLong = JSON.parse(JSON.stringify(file));
    tooLong.accounts[0].tabName = 'Far too long a name';
    assert.ok(importSettings(b.app, b.accounts, b.rules, tooLong).problems.some(p => /at most 12/.test(p)), 'a too-long tab name is reported, not imported');
    assert.equal(b.accounts.get(same.id)?.tabName, 'Work');
});

test('a refused password: Settings saves a new one only once the host takes it, and the account is back online at once', async () => {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS) await phone.mailboxCreate(f);
    const { app, accounts, rules } = appLayer();
    const store = new Store(':memory:');
    // As if the password had been changed at the host: the saved one is refused from the start
    const created = accounts.create({ email: user, imap: imap(user, 'old-password'), smtp: { ...smtp, user, pass: 'old-password' } });
    // Waits long enough that only Settings can bring it back within the test
    const manager = new AccountManager({ store, accounts, rules, workerOptions: { backoffMinMs: 100, inboxDebounceMs: 50, authRetryMinMs: 600_000, authRetryMaxMs: 600_000 } });
    manager.start(accounts.imapConfigs());
    const server = createApiServer({ store, workers: manager.workers, accounts, rules, manager, app });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    const patch = (body: unknown) => fetch(`${base}/accounts/${created.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const status = async () => ((await (await fetch(`${base}/accounts`)).json()).accounts as { id: string; state: string; rejectedAt: string | null; retryAt: string | null }[])[0];
    const incoming = { host: HARNESS.host, port: HARNESS.port, secure: false, user };
    try {
        await until('refused', async () => (await status()).state === 'auth-failed', 30_000);
        const refused = await status();
        assert.ok(refused.rejectedAt && refused.retryAt, 'the status says when it was refused and when Mail tries again');
        assert.ok(Date.parse(refused.retryAt!) - Date.parse(refused.rejectedAt!) > 500_000, 'the next try is the long wait away');
        const before = manager.workers.get(created.id);

        // A wrong new password: refused, nothing saved, the account as it was
        const wrong = await patch({ imap: { ...incoming, pass: 'still-wrong' } });
        assert.equal(wrong.status, 400);
        const wrongBody = await wrong.json();
        // 'imap-refused' lets the screens say it was the password. (The test server slows each refused
        // login down more than the last, so when other tests refused logins just before, this one can
        // time out instead: still refused, still nothing saved.)
        assert.ok(['imap-refused', 'imap'].includes(wrongBody.reason), wrongBody.error);
        if (wrongBody.reason === 'imap-refused') assert.match(wrongBody.error, /Incoming mail \(IMAP\): the server rejected the username or password/);
        assert.equal(accounts.imapConfig(created.id)?.pass, 'old-password', 'nothing saved');
        assert.equal(manager.workers.get(created.id), before, 'not restarted');
        assert.equal((await status()).state, 'auth-failed');

        // The right one, for both directions at once (one password per account): saved, and online
        // without waiting for the next try
        const right = await patch({ imap: { ...incoming, pass: 'pass' }, smtp: { ...smtp, user, pass: 'pass' } });
        assert.equal(right.status, 200);
        assert.equal(accounts.imapConfig(created.id)?.pass, 'pass');
        assert.equal(accounts.smtpConfig(created.id)?.pass, 'pass');
        await until('online at once', async () => (await status()).state === 'online', 15_000);
        const online = await status();
        assert.equal(online.rejectedAt, null);
        assert.equal(online.retryAt, null);

        // One server failing saves nothing: an incoming change that works waits for the sending one
        const otherName = HARNESS.host === '127.0.0.1' ? 'localhost' : '127.0.0.1';
        const halfRight = await patch({ imap: { ...incoming, host: otherName, pass: 'pass' }, smtp: { ...smtp, user, port: 1 } });
        assert.equal(halfRight.status, 400);
        assert.equal((await halfRight.json()).reason, 'smtp', 'the sending server, and not its password');
        assert.equal(accounts.imapConfig(created.id)?.host, HARNESS.host, 'the incoming change wasn\'t saved either');
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await manager.stopAll();
        await phone.logout().catch(() => {});
        store.close();
        app.close();
    }
});

test('account order: set by the owner, used by the account list; every account once or nothing changes', async () => {
    const { app, accounts, rules } = appLayer();
    const store = new Store(':memory:');
    const ids = ['first', 'second', 'third'].map(n => accounts.create({ email: `${n}@example.test`, imap: { host: '127.0.0.1', port: 1, secure: false, user: n, pass: 'p' } }).id);
    const manager = new AccountManager({ store, accounts, rules, workerOptions: { backoffMinMs: 60_000 } });
    manager.start(accounts.imapConfigs());
    const server = createApiServer({ store, workers: manager.workers, accounts, rules, manager, app });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    const put = (body: unknown) => fetch(`${base}/account-order`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const listed = async () => ((await (await fetch(`${base}/accounts`)).json()).accounts as { email: string }[]).map(a => a.email.split('@')[0]);
    try {
        assert.deepEqual(await listed(), ['first', 'second', 'third']);
        assert.equal((await put({ ids: [ids[2], ids[0], ids[1]] })).status, 200);
        assert.deepEqual(await listed(), ['third', 'first', 'second']);
        assert.deepEqual(accounts.list().map(a => a.email.split('@')[0]), ['third', 'first', 'second'], 'stored');
        assert.equal((await put({ ids: [ids[0], ids[1]] })).status, 400, 'one missing');
        assert.equal((await put({ ids: [ids[0], ids[0], ids[1]] })).status, 400, 'one twice');
        assert.deepEqual(await listed(), ['third', 'first', 'second'], 'unchanged');
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await manager.stopAll();
        store.close();
        app.close();
    }
});

test('finding servers from the address: providers, SRV records, the provider behind MX, then the usual names', async () => {
    const none = { resolveSrv: async () => [], resolveMx: async () => [], answers: async () => false };
    assert.equal(knownProvider('gmail.com')?.imap.host, 'imap.gmail.com', 'a known provider, by its domain');
    assert.equal(knownProvider('example.test'), null);
    assert.equal(await discoverServers('me@nowhere.example', none), null, 'nothing answers: Settings asks');
    assert.equal(await discoverServers('not an address', none), null);

    const srv = await discoverServers('me@srv.example', {
        ...none,
        resolveSrv: async name => name === '_imaps._tcp.srv.example' ? [{ name: 'in.srv.example.', port: 993, priority: 0, weight: 0 }]
            : name === '_submission._tcp.srv.example' ? [{ name: 'out.srv.example', port: 587, priority: 0, weight: 0 }] : [],
    });
    assert.deepEqual(srv, { imap: { host: 'in.srv.example', port: 993, secure: true }, smtp: { host: 'out.srv.example', port: 587, secure: false }, via: 'srv' });

    const workspace = await discoverServers('me@company.example', { ...none, resolveMx: async () => [{ exchange: 'aspmx.l.google.com', priority: 1 }] });
    assert.equal(workspace?.via, 'mx');
    assert.equal(workspace?.smtp.host, 'smtp.gmail.com');

    // Guesses: the first that answers, in order (secure ports before the others)
    const open = new Set(['mail.guess.example:993', 'mail.guess.example:143', 'smtp.guess.example:587']);
    const guessed = await discoverServers('me@guess.example', { ...none, answers: async (host, port) => open.has(`${host}:${port}`) });
    assert.deepEqual(guessed, { imap: { host: 'mail.guess.example', port: 993, secure: true }, smtp: { host: 'smtp.guess.example', port: 587, secure: false }, via: 'guess' });
});
