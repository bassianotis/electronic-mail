// Sending (Phase 2 slice 3, Rule 9). Outgoing mail goes to Mailpit, never to real people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ImapFlow } from 'imapflow';
import { connect, freshUser, deliver, fresh, FOLDERS } from './engineHelpers.ts';
import { HARNESS } from './helpers.mjs';
import { Store } from '../src/store/store.ts';
import { AccountWorker, WATCH_AUTO_IDLE_MS } from '../src/worker/accountWorker.ts';
import { AppDb } from '../src/app/appDb.ts';
import { Accounts } from '../src/app/accounts.ts';
import { loadOrCreateKey } from '../src/app/secrets.ts';
import { Outbox, saveCopyWith, type OutboxDeps, type Transport } from '../src/app/outbox.ts';
import { Uploads } from '../src/app/uploads.ts';
import { buildMessage } from '../src/app/compose.ts';
import { createApiServer } from '../src/api/server.ts';
import { threadDetail, sentView } from '../src/views/views.ts';

const MAILPIT = 'http://127.0.0.1:11080/api/v1';

async function until(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 60));
    }
    throw new Error(`timed out: ${what}`);
}

/** Messages Mailpit received with this Message-ID (with or without brackets). */
async function delivered(messageId: string): Promise<{ ID: string; Bcc: { Address: string }[]; To: { Address: string }[]; Cc: { Address: string }[] }[]> {
    const id = messageId.replace(/^<|>$/g, '');
    const res = await (await fetch(`${MAILPIT}/messages?limit=1000`)).json() as { messages: { ID: string; MessageID: string }[] };
    return res.messages.filter(m => m.MessageID === id) as never;
}
const raw = async (mailpitId: string) => (await fetch(`${MAILPIT}/message/${mailpitId}/raw`)).text();

/**
 * The headers we actually sent. Mailpit prepends its own trace lines (Return-Path, Received)
 * and, to show undisclosed recipients in its UI, a Bcc line above them: skip all of that.
 */
function ourHeaders(rawMessage: string): string {
    const lines = rawMessage.split('\r\n\r\n')[0].split('\r\n');
    let start = 0;
    lines.forEach((l, i) => { if (/^Received:/i.test(l)) start = i + 1; });
    while (start < lines.length && /^[ \t]/.test(lines[start])) start++; // folded Received lines
    return lines.slice(start).join('\r\n');
}

type SaveCopy = OutboxDeps['saveCopy'];

async function setup(outboxOptions: Partial<OutboxDeps> = {}, wrapSave?: (real: SaveCopy) => SaveCopy) {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS) await phone.mailboxCreate(f);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
    const app = new AppDb(path.join(dir, 'app.sqlite'));
    const accounts = new Accounts(app, loadOrCreateKey(path.join(dir, 'secret.key')));
    const account = accounts.create({
        email: user, displayName: 'Test Sender',
        imap: { host: HARNESS.host, port: HARNESS.port, secure: false, user, pass: 'pass' },
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
    const realSave = saveCopyWith(store, workers);
    const outbox = new Outbox({
        app, accounts, uploads, dir: path.join(dir, 'outbox'), saveCopy: wrapSave ? wrapSave(realSave) : realSave,
        sendBackoffMs: [100], saveBackoffMs: [100], ...outboxOptions,
    });
    worker.start();
    await until('online', () => worker.status().state === 'online' && store.listFolders(account.id).some(f => f.role === 'sent'));
    outbox.start();
    const sentCopies = async (messageId: string) => {
        await fresh(phone);
        const lock = await phone.getMailboxLock('INBOX.Sent', { readOnly: true });
        try {
            const uids = (await phone.search({ header: { 'message-id': messageId } }, { uid: true })) || [];
            const out: { flags: string[]; source: string }[] = [];
            for (const uid of uids) {
                const m = await phone.fetchOne(String(uid), { flags: true, source: true }, { uid: true });
                if (m) out.push({ flags: [...(m.flags ?? [])], source: m.source?.toString() ?? '' });
            }
            return out;
        } finally {
            lock.release();
        }
    };
    return {
        user, phone, store, worker, workers, app, accounts, outbox, uploads, accountId: account.id, sentCopies,
        async close() { await outbox.stop(); await worker.stop(); await phone.logout().catch(() => {}); store.close(); app.close(); },
    };
}

test('send via the API: one delivery, Bcc hidden from recipients, kept in Sent, attachment, sent view', async () => {
    const t = await setup();
    const server = createApiServer({ store: t.store, workers: t.workers, accounts: t.accounts, outbox: t.outbox, uploads: t.uploads });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    try {
        const up = await fetch(`${base}/uploads`, { method: 'POST', body: 'hello attachment',
            headers: { 'Content-Type': 'text/plain', 'X-Filename': encodeURIComponent('notes ü.txt'), 'X-Requested-With': 'electronic-mail' } });
        assert.equal(up.status, 201);
        const { upload } = await up.json();
        assert.equal((await fetch(`${base}/uploads`, { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } })).status, 403, 'uploads need the header');

        const res = await fetch(`${base}/accounts/${t.accountId}/outbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            to: [{ name: 'Ada', address: 'ada@example.com' }], cc: ['cc@example.com'], bcc: ['hidden@example.com'],
            subject: 'Plans for Friday', text: 'See attached.', html: '<p>See attached.</p>', attachments: [upload.id],
        }) });
        assert.equal(res.status, 202);
        const { item } = await res.json();
        await until('saved', () => t.outbox.get(item.id)?.status === 'saved');

        const got = await delivered(item.messageId);
        assert.equal(got.length, 1, 'delivered exactly once');
        assert.deepEqual(got[0].Bcc.map(b => b.Address), ['hidden@example.com'], 'the Bcc recipient got it');
        const sentRaw = await raw(got[0].ID);
        assert.ok(!/^Bcc:/mi.test(ourHeaders(sentRaw)), 'recipients never see the Bcc header');
        const detail = await (await fetch(`${MAILPIT}/message/${got[0].ID}`)).json() as { Attachments: { FileName: string }[] };
        assert.deepEqual(detail.Attachments.map(a => a.FileName), ['notes ü.txt'], 'attachment travelled, name intact');
        assert.match(sentRaw, /From: Test Sender </);

        const copies = await t.sentCopies(item.messageId);
        assert.equal(copies.length, 1, 'exactly one copy in Sent');
        assert.ok(copies[0].flags.includes('\\Seen'));
        assert.match(copies[0].source.split('\r\n\r\n')[0], /^Bcc: hidden@example.com/mi, 'your own copy remembers the Bcc');
        await until('sent view', () => sentView(t.store, t.accountId).count === 1);
        assert.throws(() => t.uploads.info(upload.id), 'uploads are cleaned up once saved');
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await t.close();
    }
});

test('quoting a picture-heavy email: a big message is accepted, embedded pictures travel as inline attachments', async () => {
    const t = await setup();
    const server = createApiServer({ store: t.store, workers: t.workers, accounts: t.accounts, outbox: t.outbox, uploads: t.uploads });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    try {
        // ~400 KB of picture written into the HTML, the same picture twice (as a quote often has it)
        const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), crypto.randomBytes(300_000)]).toString('base64');
        const html = `<p>Thanks!</p><blockquote><img src="data:image/png;base64,${png}"><p>Original</p><img src='data:image/png;base64,${png}'></blockquote>`;
        const res = await fetch(`${base}/accounts/${t.accountId}/outbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: ['ada@example.com'], subject: 'Re: Photos', html, text: 'Thanks!' }) });
        assert.equal(res.status, 202, 'a reply quoting pictures is not "too large"');
        const { item } = await res.json();
        await until('saved', () => t.outbox.get(item.id)?.status === 'saved');
        const got = await delivered(item.messageId);
        const sentRaw = await raw(got[0].ID);
        assert.ok(!/data:image/i.test(sentRaw), 'no data: pictures left in the message');
        assert.equal((sentRaw.match(/^Content-ID: </gmi) ?? []).length, 1, 'the repeated picture is attached once');
        assert.equal((sentRaw.match(/cid:[^"']+@inline/g) ?? []).length, 2, 'both places refer to it');
        assert.ok((await fetch(`${base}/accounts/${t.accountId}/outbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: 'x'.repeat(70_000) }) })).status !== 413, 'other limits are for the content, not the size');
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await t.close();
    }
});

test('reply joins the conversation; forward carries the original attachments', async () => {
    const t = await setup();
    const server = createApiServer({ store: t.store, workers: t.workers, accounts: t.accounts, outbox: t.outbox, uploads: t.uploads });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    const post = (body: unknown) => fetch(`${base}/accounts/${t.accountId}/outbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
        await deliver(t.phone, 'INBOX', { id: 'question@example.com', subject: 'Question', from: 'ada@example.com', references: '<earlier@example.com>' });
        await t.phone.append('INBOX', [
            'From: Bob <bob@example.com>', 'To: me@test.local', 'Subject: Photos', 'Message-ID: <photos@example.com>',
            'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '',
            '--b', 'Content-Type: text/plain', '', 'Two photos.', '--b',
            'Content-Type: image/png; name="one.png"', 'Content-Disposition: attachment; filename="one.png"', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=', '--b--', '',
        ].join('\r\n'));
        t.worker.requestCheck();
        await until('synced', () => !!t.store.db.prepare(`SELECT 1 FROM message WHERE msg_key = 'photos@example.com'`).get());

        const reply = await (await post({ to: ['ada@example.com'], subject: 'Re: Question', text: 'Answer.', replyTo: 'question@example.com' })).json();
        assert.ok(reply.item, `reply refused: ${JSON.stringify(reply)}`);
        await until('reply saved', () => t.outbox.get(reply.item.id)?.status === 'saved');
        const replyRaw = await raw((await delivered(reply.item.messageId))[0].ID);
        assert.match(replyRaw, /^In-Reply-To: <question@example\.com>/m);
        assert.match(replyRaw, /^References: <earlier@example\.com> <question@example\.com>/m, 'References keeps the chain (Outlook relies on it)');
        await until('reply in the thread', () => threadDetail(t.store, t.accountId, 'question@example.com')?.messages.length === 2);
        assert.ok(threadDetail(t.store, t.accountId, 'question@example.com')!.messages.some(m => m.sent));

        const fwd = await (await post({ to: ['carol@example.com'], subject: 'Fwd: Photos', text: 'FYI', forwardOf: 'photos@example.com' })).json();
        assert.ok(fwd.item, `forward refused: ${JSON.stringify(fwd)}`);
        await until('forward saved', () => t.outbox.get(fwd.item.id)?.status === 'saved');
        const fwdRaw = await raw((await delivered(fwd.item.messageId))[0].ID);
        assert.match(fwdRaw, /filename="?one\.png"?/, 'the original attachment came along');
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await t.close();
    }
});

test('undo send: a held message can be taken back while queued (its uploads stay); once sent it cannot', async () => {
    const t = await setup();
    const server = createApiServer({ store: t.store, workers: t.workers, accounts: t.accounts, outbox: t.outbox, uploads: t.uploads });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2/accounts/${t.accountId}`;
    const post = (url: string, body?: unknown) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    try {
        const att = t.uploads.saveBuffer(Buffer.from('notes'), 'notes.txt', 'text/plain');
        const held = await (await post('/outbox', { to: ['ada@example.com'], subject: 'Held', text: 'Wait', attachments: [att.id], holdMs: 1500 })).json();
        assert.equal(held.item.status, 'queued');
        await new Promise(r => setTimeout(r, 300));
        assert.equal(t.outbox.get(held.item.id)?.status, 'queued', 'still held');
        assert.equal((await post(`/outbox/${held.item.id}/cancel`)).status, 200);
        assert.equal(t.outbox.get(held.item.id), null, 'taken back');
        assert.equal(t.uploads.load(att.id).content.toString(), 'notes', 'the attachment is still there for the composer');
        await new Promise(r => setTimeout(r, 1800));
        assert.deepEqual(await delivered(held.item.messageId), [], 'never sent');

        const sent = await (await post('/outbox', { to: ['ada@example.com'], subject: 'Gone', text: 'Out', holdMs: 300 })).json();
        await until('sent', () => ['sent', 'saved'].includes(t.outbox.get(sent.item.id)?.status ?? ''));
        const late = await post(`/outbox/${sent.item.id}/cancel`);
        assert.equal(late.status, 409);
        assert.match((await late.json()).error, /already sent/);
        assert.equal((await delivered(sent.item.messageId)).length, 1);
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await t.close();
    }
});

test('forwarding: the original\'s attachments become ordinary uploads', async () => {
    const t = await setup();
    const server = createApiServer({ store: t.store, workers: t.workers, accounts: t.accounts, outbox: t.outbox, uploads: t.uploads });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2/accounts/${t.accountId}`;
    try {
        await t.phone.append('INBOX', [
            'From: Bob <bob@example.com>', 'To: me@test.local', 'Subject: Photos', 'Message-ID: <photos2@example.com>',
            'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '',
            '--b', 'Content-Type: text/plain', '', 'Two photos.', '--b',
            'Content-Type: image/png; name="one.png"', 'Content-Disposition: attachment; filename="one.png"', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=', '--b--', '',
        ].join('\r\n'));
        t.worker.requestCheck();
        await until('synced', () => !!t.store.db.prepare(`SELECT 1 FROM message WHERE msg_key = 'photos2@example.com'`).get());
        const res = await fetch(`${base}/messages/photos2%40example.com/forward-files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const { uploads } = await res.json() as { uploads: { id: string; filename: string; size: number }[] };
        assert.deepEqual(uploads.map(u => [u.filename, u.size]), [['one.png', 8]]);
        assert.equal(t.uploads.load(uploads[0].id).content.length, 8);
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        await t.close();
    }
});

test('temporary trouble is retried; permanent rejection fails once with the reason; bad password explained', async () => {
    let calls = 0;
    const behaviours: (() => never | void)[] = [
        () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' }); },
        () => {},
    ];
    const t = await setup({
        createTransport: (): Transport => ({ async sendMail() { (behaviours[calls++] ?? (() => {}))(); }, close() {} }),
    });
    try {
        const ok = t.outbox.enqueue(t.accountId, await buildMessage({ from: { address: t.user }, to: [{ address: 'a@example.com' }], subject: 'retry me', text: 'x' }),
            { subject: 'retry me', recipients: ['a@example.com'] });
        await until('saved after one retry', () => t.outbox.get(ok.id)?.status === 'saved');
        assert.equal(calls, 2);

        const t2 = await setup({ createTransport: () => ({ async sendMail() { throw Object.assign(new Error('550'), { responseCode: 550, response: '550 5.1.1 No such user' }); }, close() {} }) });
        try {
            const bad = t2.outbox.enqueue(t2.accountId, await buildMessage({ from: { address: t2.user }, to: [{ address: 'nobody@example.com' }], subject: 's', text: 'x' }),
                { subject: 's', recipients: ['nobody@example.com'] });
            await until('failed', () => t2.outbox.get(bad.id)?.status === 'failed');
            assert.equal(t2.outbox.get(bad.id)!.attempts, 1, 'no pointless retries');
            assert.match(t2.outbox.get(bad.id)!.error!, /No such user/);
        } finally {
            await t2.close();
        }

        const t3 = await setup({ createTransport: () => ({ async sendMail() { throw Object.assign(new Error('Invalid login'), { code: 'EAUTH' }); }, close() {} }) });
        try {
            const auth = t3.outbox.enqueue(t3.accountId, await buildMessage({ from: { address: t3.user }, to: [{ address: 'a@example.com' }], subject: 's', text: 'x' }),
                { subject: 's', recipients: ['a@example.com'] });
            await until('failed', () => t3.outbox.get(auth.id)?.status === 'failed');
            assert.match(t3.outbox.get(auth.id)!.error!, /rejected the username or password/);
        } finally {
            await t3.close();
        }
    } finally {
        await t.close();
    }
});

test('crash mid-send: marked uncertain, never resent automatically; sending again is the user\'s call', async () => {
    const t = await setup();
    try {
        await t.outbox.stop();
        const item = t.outbox.enqueue(t.accountId, await buildMessage({ from: { address: t.user }, to: [{ address: 'a@example.com' }], subject: 'mid-send', text: 'x' }),
            { subject: 'mid-send', recipients: ['a@example.com'] });
        t.app.db.prepare(`UPDATE outbox SET status = 'sending' WHERE id = ?`).run(item.id); // the app died right here
        t.outbox.start();
        assert.equal(t.outbox.get(item.id)!.status, 'uncertain');
        await new Promise(r => setTimeout(r, 500));
        assert.equal((await delivered(item.messageId)).length, 0, 'not resent on its own');

        t.outbox.retry(t.accountId, item.id);
        await until('saved', () => t.outbox.get(item.id)?.status === 'saved');
        assert.equal((await delivered(item.messageId)).length, 1);
    } finally {
        await t.close();
    }
});

test('Sent copy late: delivered once, copy retried until saved, never duplicated', async () => {
    let failures = 1;
    const t = await setup({}, real => async (accountId, messageId, data) => {
        if (failures-- > 0) {
            await real(accountId, messageId, data); // the APPEND worked but its acknowledgement was lost
            throw new Error('connection reset after APPEND');
        }
        return real(accountId, messageId, data);
    });
    try {
        const item = t.outbox.enqueue(t.accountId, await buildMessage({ from: { address: t.user }, to: [{ address: 'a@example.com' }], subject: 'late copy', text: 'x' }),
            { subject: 'late copy', recipients: ['a@example.com'] });
        await until('saved', () => t.outbox.get(item.id)?.status === 'saved');
        assert.equal((await delivered(item.messageId)).length, 1, 'delivered once');
        assert.equal((await t.sentCopies(item.messageId)).length, 1, 'one copy in Sent despite the retry');
    } finally {
        await t.close();
    }
});
