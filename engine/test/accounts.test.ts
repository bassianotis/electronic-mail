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
