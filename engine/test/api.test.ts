// HTTP API + event stream, end to end against the harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { ImapFlow } from 'imapflow';
import { connect, freshUser, deliver, FOLDERS } from './engineHelpers.ts';
import { HARNESS } from './helpers.mjs';
import { Store } from '../src/store/store.ts';
import { AccountWorker, WATCH_AUTO_IDLE_MS } from '../src/worker/accountWorker.ts';
import { createApiServer } from '../src/api/server.ts';

const RICH = [
    'From: Ada <ada@example.com>',
    'To: me@test.local',
    'Subject: Rich message',
    'Date: Mon, 05 Jan 2026 10:00:00 +0000',
    'Message-ID: <rich@test>',
    'List-Unsubscribe: <https://example.com/unsub?u=1>',
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    'List-Id: Cafe news <news.cafe.example>',
    'Precedence: bulk',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mixed"',
    '',
    '--mixed',
    'Content-Type: multipart/alternative; boundary="alt"',
    '',
    '--alt',
    'Content-Type: text/plain; charset=iso-8859-1',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Caf=E9 au lait, plain text.',
    '--alt',
    'Content-Type: multipart/related; boundary="rel"',
    '',
    '--rel',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Hello <img src="cid:logo@x"></p>',
    '--rel',
    'Content-Type: image/png',
    'Content-ID: <logo@x>',
    'Content-Transfer-Encoding: base64',
    '',
    'iVBORw0KGgo=',
    '--rel--',
    '--alt--',
    '--mixed',
    'Content-Type: text/html; name="evil.html"',
    'Content-Disposition: attachment; filename="evil.html"',
    '',
    '<script>alert(1)</script>',
    '--mixed--',
    '',
].join('\r\n');

async function setup(options: { readOnly?: boolean } = {}) {
    const user = freshUser();
    const phone: ImapFlow = await connect(user);
    for (const f of FOLDERS) await phone.mailboxCreate(f);
    await phone.append('INBOX', RICH);
    await deliver(phone, 'INBOX', { id: 'plain@test', subject: 'Plain one' });

    const store = new Store(':memory:');
    const account = { id: 'acct-1', email: user, host: HARNESS.host, port: HARNESS.port, secure: false, user, pass: 'pass' };
    const worker = new AccountWorker(account, store, {
        backoffMinMs: 100, inboxDebounceMs: 50, readOnly: options.readOnly,
        createClient: role => new ImapFlow({
            host: HARNESS.host, port: HARNESS.port, secure: false, auth: { user, pass: 'pass' }, logger: false,
            qresync: role === 'work', ...(role === 'watch' ? { autoIdleDelay: WATCH_AUTO_IDLE_MS } : {}),
        }),
    });
    const viewerDir = new URL('../viewer', import.meta.url).pathname;
    const server = createApiServer({ store, workers: new Map([[account.id, worker]]), readOnly: options.readOnly, viewerDir: options.readOnly ? viewerDir : undefined });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const base = `${origin}/api/v2`;
    worker.start();
    const api = async (path: string, init?: RequestInit) => {
        const res = await fetch(base + path, init);
        return { status: res.status, headers: res.headers, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
    };
    const post = (path: string, body: unknown) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await until(async () => (await api('/accounts/acct-1/threads?location=INBOX')).body.count === 2);
    return {
        phone, store, worker, base, origin, api, post,
        async close() {
            server.closeAllConnections();
            await new Promise(r => server.close(r));
            await worker.stop();
            await phone.logout().catch(() => {});
            store.close();
        },
    };
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('timed out');
}

/** Collects Server-Sent Events from /events until `stop` returns true. */
function subscribe(base: string) {
    const events: { event: string; data: any }[] = [];
    const controller = new AbortController();
    const done = (async () => {
        const res = await fetch(`${base}/events`, { signal: controller.signal });
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
                buffer += decoder.decode(chunk, { stream: true });
                let i;
                while ((i = buffer.indexOf('\n\n')) >= 0) {
                    const block = buffer.slice(0, i);
                    buffer = buffer.slice(i + 2);
                    const event = /^event: (.*)$/m.exec(block)?.[1];
                    const data = /^data: (.*)$/m.exec(block)?.[1];
                    if (event && data) events.push({ event, data: JSON.parse(data) });
                }
            }
        } catch { /* aborted */ }
    })();
    return { events, close: async () => { controller.abort(); await done; } };
}

test('views, thread detail, previews and folder list', async () => {
    const t = await setup();
    try {
        const accounts = await t.api('/accounts');
        assert.equal(accounts.body.accounts[0].state, 'online');

        const inbox = await t.api('/accounts/acct-1/threads?location=INBOX');
        assert.equal(inbox.status, 200);
        assert.equal(inbox.body.count, 2);
        assert.ok(inbox.body.state);

        const folders = await t.api('/accounts/acct-1/folders');
        const reads = folders.body.folders.find((f: any) => f.path === 'INBOX.Buckets.Reads');
        assert.deepEqual([reads.role, reads.count], ['bucket', 0], 'empty buckets are listed too');

        await until(async () => (await t.api('/accounts/acct-1/threads?location=INBOX')).body.threads.every((c: any) => c.preview !== null));
        const cards = (await t.api('/accounts/acct-1/threads?location=INBOX')).body.threads;
        assert.equal(cards.find((c: any) => c.threadId === 'rich@test').preview, 'Café au lait, plain text.');

        const detail = await t.api(`/accounts/acct-1/threads/${encodeURIComponent('rich@test')}`);
        assert.equal(detail.body.messages.length, 1);
        assert.equal(detail.body.messages[0].fromName, 'Ada');
        assert.equal(detail.body.messages[0].seen, false);
    } finally {
        await t.close();
    }
});

test('a conversation names each message\'s parent: In-Reply-To, else the last References id that is here', async () => {
    const t = await setup();
    try {
        // root ← a ← b; c answers root directly (a branch); d's In-Reply-To is missing, its References end at a;
        // e answers a message that isn't in the conversation, through References that also name root
        await deliver(t.phone, 'INBOX', { id: 'root@tree', subject: 'Shift' });
        await deliver(t.phone, 'INBOX', { id: 'a@tree', subject: 'Re: Shift', inReplyTo: 'root@tree', references: '<root@tree>' });
        await deliver(t.phone, 'INBOX', { id: 'b@tree', subject: 'Re: Shift', inReplyTo: 'a@tree', references: '<root@tree> <a@tree>' });
        await deliver(t.phone, 'INBOX', { id: 'c@tree', subject: 'Re: Shift', inReplyTo: 'root@tree', references: '<root@tree>' });
        await deliver(t.phone, 'INBOX', { id: 'd@tree', subject: 'Re: Shift', references: '<root@tree> <a@tree>' });
        await deliver(t.phone, 'INBOX', { id: 'e@tree', subject: 'Re: Shift', inReplyTo: 'gone@tree', references: '<root@tree> <gone@tree>' });
        await until(async () => (await t.api(`/accounts/acct-1/threads/${encodeURIComponent('root@tree')}`)).body.messages?.length === 6);
        const detail = await t.api(`/accounts/acct-1/threads/${encodeURIComponent('root@tree')}`);
        const parents = Object.fromEntries((detail.body.messages as { msgKey: string; parentKey: string | null }[]).map(m => [m.msgKey, m.parentKey]));
        assert.deepEqual(parents, { 'root@tree': null, 'a@tree': 'root@tree', 'b@tree': 'a@tree', 'c@tree': 'root@tree', 'd@tree': 'a@tree', 'e@tree': 'root@tree' });
    } finally {
        await t.close();
    }
});

test('body: charset decoded, inline image inlined, attachments listed, cached', async () => {
    const t = await setup();
    try {
        const res = await t.api(`/accounts/acct-1/messages/${encodeURIComponent('rich@test')}/body`);
        assert.equal(res.status, 200);
        assert.equal(res.body.text.trim(), 'Café au lait, plain text.');
        assert.match(res.body.html, /<img src="data:image\/png;base64,iVBORw0KGgo=">/);
        assert.deepEqual(res.body.attachments.map((a: any) => [a.filename, a.contentType]), [['evil.html', 'text/html']]);
        assert.equal(res.body.listUnsubscribePost, 'List-Unsubscribe=One-Click');
        assert.equal(res.body.listId, 'Cafe news <news.cafe.example>');
        assert.equal(res.body.precedence, 'bulk');
        assert.equal((t.store.db.prepare('SELECT COUNT(*) n FROM body').get() as { n: number }).n, 1, 'cached');
        const again = await t.api(`/accounts/acct-1/messages/${encodeURIComponent('rich@test')}/body`);
        assert.deepEqual(again.body, res.body);
    } finally {
        await t.close();
    }
});

test('attachments are always sandboxed downloads, never rendered on our origin', async () => {
    const t = await setup();
    try {
        const body = await t.api(`/accounts/acct-1/messages/${encodeURIComponent('rich@test')}/body`);
        const part = body.body.attachments[0].part;
        const res = await t.api(`/accounts/acct-1/messages/${encodeURIComponent('rich@test')}/attachments/${part}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'application/octet-stream');
        assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename\*=UTF-8''evil\.html$/);
        assert.equal(res.headers.get('content-security-policy'), 'sandbox');
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(String(res.body).trim(), '<script>alert(1)</script>');
    } finally {
        await t.close();
    }
});

test('move via API: event stream reports the task and the new state; undo works', async () => {
    const t = await setup();
    const stream = subscribe(t.base);
    try {
        await until(() => stream.events.some(e => e.event === 'state'));
        const before = (await t.api('/accounts/acct-1/threads?location=INBOX')).body.state;
        const moved = await t.post(`/accounts/acct-1/threads/${encodeURIComponent('plain@test')}/move`, { to: 'INBOX.Archive' });
        assert.equal(moved.status, 202);
        assert.equal((await t.api('/accounts/acct-1/threads?location=INBOX')).body.count, 1, 'instant');
        // Every open view hears about it before the server has done anything (local phase).
        assert.notEqual(moved.body.state, before, 'the state changes with the move itself');
        await until(() => stream.events.some(e => e.event === 'state' && e.data.changed['acct-1']?.state === moved.body.state), 2000);

        await until(() => stream.events.some(e => e.event === 'task' && e.data.id === moved.body.taskId && e.data.status === 'done'), 5000);
        const task = await t.api(`/accounts/acct-1/tasks/${moved.body.taskId}`);
        assert.equal(task.body.status, 'done');

        const undo = await t.post(`/accounts/acct-1/tasks/${moved.body.taskId}/undo`, {});
        assert.equal(undo.status, 202);
        await until(() => stream.events.some(e => e.event === 'task' && e.data.id === undo.body.undoTaskId && e.data.status === 'done'), 5000);
        assert.equal((await t.api('/accounts/acct-1/threads?location=INBOX')).body.count, 2);
    } finally {
        await stream.close();
        await t.close();
    }
});

test('mark read via API, and input errors are clear', async () => {
    const t = await setup();
    try {
        const seen = await t.post(`/accounts/acct-1/threads/${encodeURIComponent('rich@test')}/seen`, { seen: true });
        assert.equal(seen.status, 202);
        assert.equal((await t.api('/accounts/acct-1/threads?location=INBOX')).body.unreadThreads, 1);

        assert.equal((await t.api('/accounts/nope/threads?location=INBOX')).status, 404);
        assert.equal((await t.api('/accounts/acct-1/threads')).status, 400);
        assert.equal((await t.api('/accounts/acct-1/threads/missing')).status, 404);
        assert.equal((await t.post(`/accounts/acct-1/threads/${encodeURIComponent('rich@test')}/move`, {})).status, 400);
        assert.equal((await t.api(`/accounts/acct-1/threads/${encodeURIComponent('rich@test')}/move`,
            { method: 'POST', body: '{not json', headers: { 'Content-Type': 'application/json' } })).status, 400);
        assert.equal((await t.api('/accounts/acct-1/tasks/99999')).status, 404);
        assert.equal((await t.api('/nope')).status, 404);
        assert.equal((await t.api('/accounts', { method: 'DELETE' })).status, 405);
    } finally {
        await t.close();
    }
});

test('read-only preview: every change is refused and nothing moves on the server', async () => {
    const t = await setup({ readOnly: true });
    try {
        const thread = encodeURIComponent('plain@test');
        assert.equal((await t.post(`/accounts/acct-1/threads/${thread}/move`, { to: 'INBOX.Archive' })).status, 403);
        assert.equal((await t.post(`/accounts/acct-1/threads/${thread}/seen`, { seen: true })).status, 403);
        assert.equal((t.store.db.prepare('SELECT COUNT(*) n FROM task').get() as { n: number }).n, 0, 'nothing queued');
        t.worker.requestTasks(); // even a direct request is ignored in read-only mode
        assert.equal((await t.api('/accounts/acct-1/threads?location=INBOX')).body.count, 2, 'reads still work');

        const lock = await t.phone.getMailboxLock('INBOX', { readOnly: true });
        try { assert.equal(t.phone.mailbox && t.phone.mailbox.exists, 2, 'server untouched'); } finally { lock.release(); }

        const page = await fetch(`${t.origin}/`);
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
        assert.match(await page.text(), /Read-only preview/);
        assert.equal((await fetch(`${t.origin}/viewer.js`)).status, 200);
    } finally {
        await t.close();
    }
});

test('opening a message that arrived after the reader opened INBOX works (stale-view regression)', async () => {
    const t = await setup();
    try {
        await new Promise(r => setTimeout(r, 600)); // the reader connection is now idling on INBOX
        await deliver(t.phone, 'INBOX', { id: 'brand-new@test', subject: 'Just arrived' });
        await until(async () => (await t.api('/accounts/acct-1/threads?location=INBOX')).body.count === 3);
        const res = await t.api(`/accounts/acct-1/messages/${encodeURIComponent('brand-new@test')}/body`);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.match(res.body.text, /Body of Just arrived/);
    } finally {
        await t.close();
    }
});
