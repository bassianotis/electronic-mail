// Sender -> bucket rules (Phase 2 slice 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { connect, freshUser, deliver, FOLDERS } from './engineHelpers.ts';
import { HARNESS } from './helpers.mjs';
import { Store } from '../src/store/store.ts';
import { AccountWorker, WATCH_AUTO_IDLE_MS } from '../src/worker/accountWorker.ts';
import { AppDb } from '../src/app/appDb.ts';
import { Accounts } from '../src/app/accounts.ts';
import { Buckets } from '../src/app/buckets.ts';
import { Rules, matchRule } from '../src/app/rules.ts';
import { loadOrCreateKey } from '../src/app/secrets.ts';
import { NoticeIds } from '../src/app/notices.ts';

async function until(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`timed out: ${what}`);
}

test('matchRule: exact address beats domain, case-insensitive, no sender no match', () => {
    const rules = [{ senderPattern: '@example.com', bucket: 'Domain' }, { senderPattern: 'news@example.com', bucket: 'News' }];
    assert.equal(matchRule(rules, 'News@Example.com'), 'News');
    assert.equal(matchRule(rules, 'orders@example.com'), 'Domain');
    assert.equal(matchRule(rules, 'someone@other.example'), null);
    assert.equal(matchRule(rules, null), null);
});

test('rules file new arrivals only; never retroactively, never against the user, not after a rebuild', async () => {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS.filter(f => !f.includes('Buckets'))) await phone.mailboxCreate(f);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'));
    const app = new AppDb(path.join(dir, 'app.sqlite'));
    const accounts = new Accounts(app, loadOrCreateKey(path.join(dir, 'secret.key')));
    const account = accounts.create({ email: user, imap: { host: HARNESS.host, port: HARNESS.port, secure: false, user, pass: 'pass' } });
    const rules = new Rules(app);
    const notices = new NoticeIds(loadOrCreateKey(path.join(dir, 'secret.key')));
    const store = new Store(':memory:');
    const worker = new AccountWorker(accounts.imapConfigs()[0], store, {
        backoffMinMs: 100, inboxDebounceMs: 50, pollIntervalMs: 300,
        rules: () => rules.list(account.id),
        isOwnNotice: id => notices.isOwn(id),
        createClient: role => new ImapFlow({
            host: HARNESS.host, port: HARNESS.port, secure: false, auth: { user, pass: 'pass' }, logger: false,
            qresync: role === 'work', ...(role === 'watch' ? { autoIdleDelay: WATCH_AUTO_IDLE_MS } : {}),
        }),
    });
    const inFolder = async (folder: string) => {
        if (phone.mailbox) await phone.mailboxClose(); // a fresh SELECT: never trust a stale open folder
        const lock = await phone.getMailboxLock(folder, { readOnly: true });
        try {
            const out: string[] = [];
            if (phone.mailbox && phone.mailbox.exists) for await (const m of phone.fetch('1:*', { envelope: true })) out.push(m.envelope?.messageId ?? '?');
            return out.sort();
        } finally {
            lock.release();
        }
    };
    try {
        await deliver(phone, 'INBOX', { id: 'old-news@test', from: 'news@example.com' }); // arrived before the rule
        worker.start();
        await until('online and synced', () => worker.status().state === 'online' && store.listFolders(account.id).length > 0);
        await new Buckets(app, store).create(worker, account.id, 'News');
        await new Buckets(app, store).create(worker, account.id, 'Orders');
        rules.add(account.id, 'NEWS@example.com', 'News');
        rules.add(account.id, '@shop.example', 'Orders');
        rules.add(account.id, 'me@home.example', 'News'); // a rule for the person's own address
        const notice = notices.make('me@home.example');

        await deliver(phone, 'INBOX', { id: 'fresh-news@test', from: 'news@example.com' });
        await deliver(phone, 'INBOX', { id: 'order@test', from: 'orders@shop.example' });
        await deliver(phone, 'INBOX', { id: 'friend@test', from: 'friend@other.example' });
        // The app's own notice (the new sign-in email) is never filed; one that only looks like it is
        await deliver(phone, 'INBOX', { id: notice.slice(1, -1), from: 'me@home.example' });
        await deliver(phone, 'INBOX', { id: 'notice.forged.AAAAAAAAAAAAAAAAAAAAAA@home.example', from: 'me@home.example' });
        await until('rules applied on the server', async () =>
            (await inFolder('INBOX.Buckets.News')).includes('<fresh-news@test>') && (await inFolder('INBOX.Buckets.Orders')).includes('<order@test>')
            && (await inFolder('INBOX.Buckets.News')).includes('<notice.forged.AAAAAAAAAAAAAAAAAAAAAA@home.example>'));
        assert.deepEqual(await inFolder('INBOX'), ['<friend@test>', notice, '<old-news@test>'], 'old mail, other senders and the notice stay put');
        const task = store.db.prepare(`SELECT payload FROM task WHERE status = 'done' AND payload LIKE '%fresh-news%'`).get() as { payload: string };
        assert.equal(JSON.parse(task.payload).origin, 'rule', 'recorded as filed by a rule (undoable like any move)');

        // The user disagrees and drags it back to the Inbox: it must stay there.
        const lock = await phone.getMailboxLock('INBOX.Buckets.News');
        try { await phone.messageMove('1:*', 'INBOX', { uid: true }); } finally { lock.release(); }
        await until('move back synced', async () => (await inFolder('INBOX')).includes('<fresh-news@test>'));
        await new Promise(r => setTimeout(r, 1500)); // several polls
        assert.ok((await inFolder('INBOX')).includes('<fresh-news@test>'), 'not re-filed against the user');

        // A cache rebuild (full listing) must not file existing Inbox mail either.
        store.db.prepare(`UPDATE folder SET uid_validity = NULL, highest_modseq = NULL WHERE path = 'INBOX'`).run();
        worker.requestCheck();
        await new Promise(r => setTimeout(r, 1500));
        assert.ok((await inFolder('INBOX')).includes('<old-news@test>'), 'no retroactive filing after a rebuild');
    } finally {
        await worker.stop();
        await phone.logout().catch(() => {});
        store.close();
        app.close();
    }
});
