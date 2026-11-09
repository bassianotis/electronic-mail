// Drafts on the server (Phase 2 slice 3b, Rule 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { connect, freshUser, deliver, fresh, FOLDERS, rawMessage } from './engineHelpers.ts';
import { HARNESS } from './helpers.mjs';
import { Store } from '../src/store/store.ts';
import { AccountWorker, WATCH_AUTO_IDLE_MS } from '../src/worker/accountWorker.ts';
import { AppDb } from '../src/app/appDb.ts';
import { Accounts } from '../src/app/accounts.ts';
import { loadOrCreateKey } from '../src/app/secrets.ts';
import { Outbox, saveCopyWith } from '../src/app/outbox.ts';
import { Uploads } from '../src/app/uploads.ts';
import { Drafts } from '../src/app/drafts.ts';
import { buildMessage } from '../src/app/compose.ts';
import { folderView } from '../src/views/views.ts';

async function until(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 60));
    }
    throw new Error(`timed out: ${what}`);
}

async function setup() {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS) await phone.mailboxCreate(f);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-'));
    const app = new AppDb(path.join(dir, 'app.sqlite'));
    const accounts = new Accounts(app, loadOrCreateKey(path.join(dir, 'secret.key')));
    const account = accounts.create({
        email: user, imap: { host: HARNESS.host, port: HARNESS.port, secure: false, user, pass: 'pass' },
        smtp: { host: '127.0.0.1', port: 11025, secure: false, user, pass: 'anything' },
    });
    const store = new Store(':memory:');
    const worker = new AccountWorker(accounts.imapConfigs()[0], store, {
        backoffMinMs: 100, inboxDebounceMs: 50,
        createClient: role => new ImapFlow({
            host: HARNESS.host, port: HARNESS.port, secure: false, auth: { user, pass: 'pass' }, logger: false,
            qresync: role === 'work', ...(role === 'watch' ? { autoIdleDelay: WATCH_AUTO_IDLE_MS } : {}),
        }),
    });
    const workers = new Map([[account.id, worker]]);
    const uploads = new Uploads(path.join(dir, 'uploads'));
    const drafts = new Drafts(store, uploads);
    const outbox = new Outbox({
        app, accounts, uploads, dir: path.join(dir, 'outbox'), saveCopy: saveCopyWith(store, workers),
        sendBackoffMs: [100], saveBackoffMs: [100],
        afterSaved: async item => { if (item.draftKey) await drafts.removeAllVersions(worker, account.id, item.draftKey); },
    });
    worker.start();
    await until('online', () => worker.status().state === 'online' && store.listFolders(account.id).some(f => f.role === 'drafts'));
    outbox.start();
    const draftsOnServer = async () => {
        await fresh(phone);
        const lock = await phone.getMailboxLock('INBOX.Drafts', { readOnly: true });
        try {
            const out: { subject: string; flags: string[] }[] = [];
            if (phone.mailbox && phone.mailbox.exists) {
                for await (const m of phone.fetch('1:*', { envelope: true, flags: true })) out.push({ subject: m.envelope?.subject ?? '', flags: [...(m.flags ?? [])] });
            }
            return out;
        } finally {
            lock.release();
        }
    };
    const from = { name: 'Me', address: user };
    const synced = async () => { worker.requestCheck(); await new Promise(r => setTimeout(r, 400)); };
    return {
        user, phone, store, worker, outbox, drafts, uploads, accountId: account.id, from, draftsOnServer, synced,
        async close() { await outbox.stop(); await worker.stop(); await phone.logout().catch(() => {}); store.close(); app.close(); },
    };
}

const blank = { to: [], cc: [], bcc: [], subject: '', html: null, text: null, attachments: [] as string[] };

test('autosave keeps exactly one version on the server; opening restores every field', async () => {
    const t = await setup();
    try {
        const key = crypto.randomUUID();
        await t.drafts.save(t.worker, t.from, t.accountId, key, { ...blank, subject: 'Draft v1', text: 'first' }); // no recipients yet
        const att = t.uploads.saveBuffer(Buffer.from('notes'), 'notes.txt', 'text/plain');
        const v2 = await t.drafts.save(t.worker, t.from, t.accountId, key, {
            ...blank, to: [{ name: 'Ada', address: 'ada@example.com' }], cc: [{ address: 'cc@example.com' }], bcc: [{ address: 'hidden@example.com' }],
            subject: 'Draft v2', html: '<p>second</p>', text: 'second', attachments: [att.id],
        });
        const onServer = await t.draftsOnServer();
        assert.deepEqual(onServer.map(d => d.subject), ['Draft v2'], 'older versions are replaced, not piled up');
        assert.equal(t.drafts.list(t.accountId).find(d => d.msgKey === v2.msgKey)?.threadId, null, 'a new message belongs to no conversation yet');
        assert.ok(onServer[0].flags.includes('\\Draft'));

        await t.synced();
        assert.deepEqual(t.drafts.list(t.accountId).map(d => d.subject), ['Draft v2']);
        const opened = await t.drafts.open(t.worker, t.accountId, v2.msgKey);
        assert.equal(opened.draftKey, key);
        assert.deepEqual(opened.to, [{ name: 'Ada', address: 'ada@example.com' }]);
        assert.deepEqual(opened.bcc.map(a => a.address), ['hidden@example.com'], 'Bcc survives in a draft');
        assert.equal(opened.text?.trim(), 'second');
        assert.deepEqual(opened.attachments.map(a => [a.filename, a.size]), [['notes.txt', 5]]);
        assert.equal(folderView(t.store, t.accountId, 'INBOX.Drafts').count, 0, 'drafts are never shown as conversations');
    } finally {
        await t.close();
    }
});

test('a reply draft keeps its threading; sending it removes the draft only after the Sent copy is saved', async () => {
    const t = await setup();
    try {
        await deliver(t.phone, 'INBOX', { id: 'original@example.com', subject: 'Lunch?', from: 'ada@example.com' });
        await t.synced();
        const key = crypto.randomUUID();
        const saved = await t.drafts.save(t.worker, t.from, t.accountId, key, { ...blank, to: [{ address: 'ada@example.com' }], subject: 'Re: Lunch?', text: 'Yes!', replyTo: 'original@example.com' });
        await t.synced();
        const opened = await t.drafts.open(t.worker, t.accountId, saved.msgKey);
        assert.equal(opened.inReplyTo, '<original@example.com>');
        assert.equal(t.drafts.list(t.accountId).find(d => d.msgKey === saved.msgKey)?.threadId, 'original@example.com',
            'the draft knows its conversation (the Draft badge, reopening the reply)');

        const built = await buildMessage({ from: t.from, to: opened.to, subject: opened.subject, text: opened.text, inReplyTo: opened.inReplyTo, references: opened.references });
        const item = t.outbox.enqueue(t.accountId, built, { subject: opened.subject, recipients: ['ada@example.com'], draftKey: key });
        await until('saved', () => t.outbox.get(item.id)?.status === 'saved');
        await until('draft removed', async () => (await t.draftsOnServer()).length === 0);
    } finally {
        await t.close();
    }
});

test('a continued draft keeps its own threading and quote pictures, even when the original is not in this account', async () => {
    const t = await setup();
    try {
        const key = crypto.randomUUID();
        const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        const quoted = `<div class="em-body">Sounds good</div><div class="gmail_quote"><blockquote>Lunch? <img src="data:image/png;base64,${picture.toString('base64')}"></blockquote></div>`;
        const att = t.uploads.saveBuffer(Buffer.from('menu'), 'menu.txt', 'text/plain');
        // Saved the first time from a reply (its headers), the original nowhere in this account.
        const first = await t.drafts.save(t.worker, t.from, t.accountId, key, {
            ...blank, to: [{ address: 'ada@example.com' }], subject: 'Re: Lunch?', html: quoted, text: 'Sounds good\n\nOn Mon, Ada wrote:\n> Lunch?',
            inReplyTo: 'original@example.com', references: ['<root@example.com>', '<original@example.com>'], attachments: [att.id],
        });
        await t.synced();
        const opened = await t.drafts.open(t.worker, t.accountId, first.msgKey);
        assert.equal(opened.inReplyTo, '<original@example.com>');
        assert.deepEqual(opened.references, ['<root@example.com>', '<original@example.com>']);
        assert.deepEqual(opened.attachments.map(a => a.filename), ['menu.txt'], 'the quote\'s picture is not turned into a file');
        assert.match(opened.html ?? '', /<img src="data:image\/png;base64,/, 'the picture is back inside the quote');

        // Continued: saved again from those headers, as the screens do.
        const again = await t.drafts.save(t.worker, t.from, t.accountId, key, {
            ...blank, to: opened.to, subject: opened.subject, html: opened.html, text: opened.text,
            inReplyTo: opened.inReplyTo, references: opened.references, attachments: opened.attachments.map(a => a.id),
        });
        await t.synced();
        const reopened = await t.drafts.open(t.worker, t.accountId, again.msgKey);
        assert.equal(reopened.inReplyTo, '<original@example.com>');
        assert.deepEqual(reopened.references, ['<root@example.com>', '<original@example.com>']);
        assert.deepEqual(reopened.attachments.map(a => a.filename), ['menu.txt']);
        assert.deepEqual((await t.draftsOnServer()).map(d => d.subject), ['Re: Lunch?'], 'still one copy');
    } finally {
        await t.close();
    }
});

test('continuing another app\'s draft replaces it; an unrelated draft from another app is never touched; discard', async () => {
    const t = await setup();
    try {
        await t.phone.append('INBOX.Drafts', rawMessage({ messageId: '<phone-draft@x>', subject: 'Started on phone' }), ['\\Draft']);
        await t.phone.append('INBOX.Drafts', rawMessage({ messageId: '<other-draft@x>', subject: 'Someone else\'s draft' }), ['\\Draft']);
        await t.synced();
        const fromPhone = await t.drafts.open(t.worker, t.accountId, 'phone-draft@x');
        assert.equal(fromPhone.draftKey, null, 'not one of ours yet');

        const key = crypto.randomUUID();
        const ours = await t.drafts.save(t.worker, t.from, t.accountId, key, { ...blank, subject: 'Finished here', text: 'done', replaces: 'phone-draft@x' });
        assert.deepEqual((await t.draftsOnServer()).map(d => d.subject).sort(), ['Finished here', 'Someone else\'s draft']);

        await t.synced();
        await t.drafts.discard(t.worker, t.accountId, ours.msgKey);
        assert.deepEqual((await t.draftsOnServer()).map(d => d.subject), ['Someone else\'s draft'], 'only what was asked is removed');
    } finally {
        await t.close();
    }
});

test('changing From moves a draft to the other account; a reply from there still threads; the original account is kept', async () => {
    const users = [freshUser(), freshUser()];
    const phones: ImapFlow[] = [];
    for (const user of users) {
        const phone = await connect(user);
        for (const f of FOLDERS) await phone.mailboxCreate(f);
        phones.push(phone);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-move-'));
    const app = new AppDb(path.join(dir, 'app.sqlite'));
    const accounts = new Accounts(app, loadOrCreateKey(path.join(dir, 'secret.key')));
    const made = users.map(user => accounts.create({ email: user, imap: { host: HARNESS.host, port: HARNESS.port, secure: false, user, pass: 'pass' } }));
    const store = new Store(':memory:');
    const workers = accounts.imapConfigs().map(config => new AccountWorker(config, store, {
        backoffMinMs: 100, inboxDebounceMs: 50,
        createClient: role => new ImapFlow({
            host: HARNESS.host, port: HARNESS.port, secure: false, auth: { user: config.user, pass: 'pass' }, logger: false,
            qresync: role === 'work', ...(role === 'watch' ? { autoIdleDelay: WATCH_AUTO_IDLE_MS } : {}),
        }),
    }));
    const [wa, wb] = made.map(m => workers.find(w => w.account.id === m.id)!);
    const drafts = new Drafts(store, new Uploads(path.join(dir, 'uploads')));
    for (const w of workers) w.start();
    try {
        await until('online', () => made.every(m => store.listFolders(m.id).some(f => f.role === 'drafts')));
        await deliver(phones[0], 'INBOX', { id: 'question@example.com', subject: 'Question', from: 'ada@example.com' });
        wa.requestCheck();
        await until('synced', () => !!store.db.prepare(`SELECT 1 FROM message WHERE account = ? AND msg_key = 'question@example.com'`).get(made[0].id));

        const key = crypto.randomUUID();
        const input = { ...blank, to: [{ address: 'ada@example.com' }], subject: 'Re: Question', text: 'Answer', replyTo: 'question@example.com' };
        await drafts.save(wa, { address: users[0] }, made[0].id, key, input);
        // From changes to account B, whose cache has never seen the question
        const moved = await drafts.move({ worker: wa, accountId: made[0].id }, { worker: wb, accountId: made[1].id, address: { address: users[1] } }, key,
            { ...input, originalAccount: made[0].id });
        assert.equal(moved.oldCopyKept, false);
        const count = async (phone: ImapFlow) => {
            await fresh(phone);
            const lock = await phone.getMailboxLock('INBOX.Drafts', { readOnly: true });
            try { return phone.mailbox ? phone.mailbox.exists : 0; } finally { lock.release(); }
        };
        assert.deepEqual([await count(phones[0]), await count(phones[1])], [0, 1], 'gone from A, in B');
        wb.requestCheck();
        await until('B has it', () => drafts.list(made[1].id).length === 1);
        const opened = await drafts.open(wb, made[1].id, moved.msgKey);
        assert.equal(opened.inReplyTo, '<question@example.com>', 'threaded from the other account (the reply lookup falls back)');
        assert.equal(opened.originalAccount, made[0].id, 'it knows where its conversation is');
        assert.equal(opened.draftKey, key, 'the same draft');
    } finally {
        for (const w of workers) await w.stop();
        for (const phone of phones) await phone.logout().catch(() => {});
        store.close();
        app.close();
    }
});
