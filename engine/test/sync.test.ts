// Sync + threading + views scenarios (engine/test/SCENARIOS.md). Needs `npm run harness:up`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    world, deliver, phoneMove, serverUids, assertCacheMatchesServer, threadOf, assertIncrementalMatchesFull,
} from './engineHelpers.ts';
import { folderCounts, folderView, sentView } from '../src/views/views.ts';

const placements = (w: Awaited<ReturnType<typeof world>>) =>
    (w.store.db.prepare('SELECT COUNT(*) AS n FROM placement').get() as { n: number }).n;
const messages = (w: Awaited<ReturnType<typeof world>>) =>
    (w.store.db.prepare('SELECT COUNT(*) AS n FROM message').get() as { n: number }).n;

test('baseline-initial-sync: cache equals server, checkpoints saved', async () => {
    const w = await world();
    try {
        for (let i = 0; i < 3; i++) await deliver(w.phone, 'INBOX');
        await deliver(w.phone, 'INBOX.Archive');
        await deliver(w.phone, 'INBOX.Sent', { flags: ['\\Seen'] });
        const results = await w.sync();
        assert.ok(results.every(r => r.mode === 'full'));
        await assertCacheMatchesServer(w);
        assert.equal(placements(w), 5);
        const inbox = w.store.getFolder(w.account, 'INBOX')!;
        assert.ok(inbox.uid_validity && inbox.highest_modseq, 'checkpoint stored');
    } finally {
        await w.close();
    }
});

test('incremental + unchanged: only changes are fetched; nothing changed costs nothing', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX');
        await deliver(w.phone, 'INBOX');
        await w.sync();

        await deliver(w.phone, 'INBOX'); // new mail
        const lock = await w.phone.getMailboxLock('INBOX');
        try { await w.phone.messageFlagsAdd('1', ['\\Seen'], { uid: true }); } finally { lock.release(); }

        const second = (await w.sync()).find(r => r.path === 'INBOX')!;
        assert.equal(second.mode, 'incremental');
        assert.equal(second.fetched, 2, 'one new message + one flag change');
        await assertCacheMatchesServer(w);

        const third = (await w.sync()).find(r => r.path === 'INBOX')!;
        assert.equal(third.mode, 'unchanged');
        assert.equal(third.fetched, 0);
    } finally {
        await w.close();
    }
});

test('remote-move-to-archive: a move made on the phone shows up, thread follows', async () => {
    const w = await world();
    try {
        const id = (await deliver(w.phone, 'INBOX'))!;
        await deliver(w.phone, 'INBOX');
        await w.sync();
        assert.equal(threadOf(w, id).location, 'INBOX');

        await phoneMove(w.phone, 'INBOX', [1], 'INBOX.Archive');
        const r = (await w.sync()).find(r => r.path === 'INBOX')!;
        assert.equal(r.vanished, 1, 'learned via QRESYNC VANISHED');
        await assertCacheMatchesServer(w);
        assert.equal(threadOf(w, id).location, 'INBOX.Archive');
    } finally {
        await w.close();
    }
});

test('qresync-wide-vanished-range: a bulk move of 50 is fully reflected', async () => {
    const w = await world();
    try {
        for (let i = 0; i < 60; i++) await deliver(w.phone, 'INBOX');
        await w.sync();
        const uids = (await serverUids(w.phone, 'INBOX')).slice(0, 50);
        await phoneMove(w.phone, 'INBOX', uids, 'INBOX.Archive');
        await w.sync();
        await assertCacheMatchesServer(w);
        assert.equal(folderView(w.store, w.account, 'INBOX').count, 10);
        assert.equal(folderView(w.store, w.account, 'INBOX.Archive').count, 50);
    } finally {
        await w.close();
    }
});

test('uidvalidity-change: a recreated folder is resynced from scratch', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX.Buckets.Reads');
        await w.sync();
        const before = w.store.getFolder(w.account, 'INBOX.Buckets.Reads')!.uid_validity;

        await w.phone.mailboxDelete('INBOX.Buckets.Reads');
        await new Promise(r => setTimeout(r, 1100)); // Dovecot derives UIDVALIDITY from the clock
        await w.phone.mailboxCreate('INBOX.Buckets.Reads');
        await deliver(w.phone, 'INBOX.Buckets.Reads');
        await deliver(w.phone, 'INBOX.Buckets.Reads');

        const r = (await w.sync()).find(r => r.path === 'INBOX.Buckets.Reads')!;
        assert.notEqual(w.store.getFolder(w.account, 'INBOX.Buckets.Reads')!.uid_validity, before);
        assert.equal(r.mode, 'reset');
        await assertCacheMatchesServer(w);
    } finally {
        await w.close();
    }
});

test('folder-deleted: placements of a removed folder disappear', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX.Junk');
        await w.sync();
        await w.phone.mailboxDelete('INBOX.Junk');
        await w.sync();
        assert.equal(w.store.getFolder(w.account, 'INBOX.Junk'), undefined);
        assert.equal(placements(w), 0);
        assert.equal(messages(w), 0, 'orphaned header facts pruned');
    } finally {
        await w.close();
    }
});

test('missing-message-id: never duplicated across resyncs (old app: 12,455 copies)', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: null, subject: 'No id A' });
        await deliver(w.phone, 'INBOX', { id: null, subject: 'No id B' });
        await w.sync();
        await w.sync();
        assert.equal(messages(w), 2);
        assert.equal(placements(w), 2);
        const keys = (w.store.db.prepare('SELECT msg_key FROM message').all() as { msg_key: string }[]).map(r => r.msg_key);
        assert.ok(keys.every(k => k.startsWith('synthetic:')));
        assert.equal(folderView(w.store, w.account, 'INBOX').count, 2, 'two separate cards');
    } finally {
        await w.close();
    }
});

test('unparseable-date-header: falls back to arrival time instead of failing', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { rawDate: 'not a date at all' });
        await w.sync();
        const row = w.store.db.prepare('SELECT date FROM message').get() as { date: string | null };
        assert.ok(row.date && !Number.isNaN(Date.parse(row.date)));
    } finally {
        await w.close();
    }
});

test('self-addressed-inbox-and-sent: one message, two placements, lives in Inbox', async () => {
    const w = await world();
    try {
        const id = 'self@test';
        await deliver(w.phone, 'INBOX.Sent', { id, flags: ['\\Seen'] });
        await deliver(w.phone, 'INBOX', { id });
        await w.sync();
        assert.equal(messages(w), 1);
        assert.equal(placements(w), 2);
        const t = threadOf(w, id);
        assert.equal(t.location, 'INBOX');
        assert.equal(t.has_sent, 1);
        assert.equal(t.message_count, 1);
    } finally {
        await w.close();
    }
});

test('out-of-order-arrival-joins-thread: reply synced before its parent still joins', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'reply@test', inReplyTo: 'parent@test', references: '<parent@test>', subject: 'Re: Plans' });
        await w.sync();
        assert.equal(threadOf(w, 'reply@test').message_count, 1);

        await deliver(w.phone, 'INBOX.Archive', { id: 'parent@test', subject: 'Plans', date: new Date(Date.UTC(2025, 0, 1)) });
        await w.sync();
        const t = threadOf(w, 'reply@test');
        assert.equal(t.thread_id, threadOf(w, 'parent@test').thread_id);
        assert.equal(t.message_count, 2);
        assert.equal(t.location, 'INBOX', 'lives where the newest received message is');
    } finally {
        await w.close();
    }
});

test('same-subject-same-sender-stays-separate: notifications are not one giant stack', async () => {
    const w = await world();
    try {
        for (let i = 0; i < 5; i++) await deliver(w.phone, 'INBOX', { subject: 'Your daily digest', from: 'news@example.com' });
        await w.sync();
        assert.equal(folderView(w.store, w.account, 'INBOX').count, 5);
    } finally {
        await w.close();
    }
});

test('address-in-in-reply-to-ignored: an address dressed as an id does not fuse threads', async () => {
    const w = await world();
    try {
        // Both claim to reply to "<me@test.local>", which is their own To: address.
        await deliver(w.phone, 'INBOX', { inReplyTo: 'me@test.local', subject: 'One' });
        await deliver(w.phone, 'INBOX', { inReplyTo: 'me@test.local', subject: 'Two' });
        await w.sync();
        assert.equal(folderView(w.store, w.account, 'INBOX').count, 2);
    } finally {
        await w.close();
    }
});

test('new-reply-on-filed-thread-returns-to-inbox (D1)', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX.Buckets.Reads', { id: 'first@test', subject: 'Essay' });
        await w.sync();
        assert.equal(threadOf(w, 'first@test').location, 'INBOX.Buckets.Reads');

        await deliver(w.phone, 'INBOX', { id: 'second@test', inReplyTo: 'first@test', references: '<first@test>', subject: 'Re: Essay' });
        await w.sync();
        const t = threadOf(w, 'first@test');
        assert.equal(t.location, 'INBOX');
        assert.equal(t.message_count, 2);
        assert.equal(folderView(w.store, w.account, 'INBOX.Buckets.Reads').count, 0);
    } finally {
        await w.close();
    }
});

test('archive with sent-only: a conversation holding only mail you sent is listed, marked as sent', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX.Sent', { id: 'started@test', subject: 'I started this', flags: ['\\Seen'] });
        await deliver(w.phone, 'INBOX.Archive', { id: 'filed@test', subject: 'Filed' });
        await deliver(w.phone, 'INBOX', { id: 'waiting@test', subject: 'Still in the Inbox' });
        await deliver(w.phone, 'INBOX.Sent', { id: 'answered@test', inReplyTo: 'waiting@test', references: '<waiting@test>', subject: 'Re: Still in the Inbox', flags: ['\\Seen'] });
        await w.sync();
        const plain = folderView(w.store, w.account, 'INBOX.Archive');
        assert.deepEqual(plain.threads.map(t => t.subject), ['Filed']);
        const withSent = folderView(w.store, w.account, 'INBOX.Archive', 50, 0, { withSentOnly: true });
        assert.equal(withSent.count, 2, 'count and list agree');
        const started = withSent.threads.find(t => t.subject === 'I started this')!;
        assert.equal(started.location, null);
        assert.equal(started.hasSent, true);
        assert.equal(withSent.threads.find(t => t.subject === 'Filed')!.hasSent, false);
        assert.ok(!withSent.threads.some(t => t.subject === 'Still in the Inbox'), 'a conversation you answered stays where its mail is');
    } finally {
        await w.close();
    }
});

test('answering-keeps-the-card-in-place: a reply you send neither moves the card nor becomes its preview', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'older@test', subject: 'Older question' });
        await deliver(w.phone, 'INBOX', { id: 'newer@test', subject: 'Newer question' });
        await deliver(w.phone, 'INBOX.Sent', { id: 'answer@test', inReplyTo: 'older@test', references: '<older@test>', subject: 'Re: Older question', flags: ['\\Seen'] });
        await w.sync();
        const inbox = folderView(w.store, w.account, 'INBOX');
        assert.deepEqual(inbox.threads.map(t => t.subject), ['Newer question', 'Older question'], 'sorted by what others sent');
        const older = inbox.threads.find(t => t.subject === 'Older question')!;
        assert.equal(older.messageCount, 2);
        assert.equal(older.latestMsgKey, 'older@test', 'the card shows their message, not my answer');
        assertIncrementalMatchesFull(w);
    } finally {
        await w.close();
    }
});

test('sent view lists threads you replied in', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'q@test', subject: 'Question' });
        await deliver(w.phone, 'INBOX.Sent', { id: 'a@test', inReplyTo: 'q@test', references: '<q@test>', subject: 'Re: Question', flags: ['\\Seen'] });
        await deliver(w.phone, 'INBOX', { subject: 'Unrelated' });
        await w.sync();
        const sent = sentView(w.store, w.account);
        assert.equal(sent.count, 1);
        assert.equal(sent.threads[0].messageCount, 2);
    } finally {
        await w.close();
    }
});

test('counts-equal-list-length-after-random-ops: Rules 2 and 4 hold after every step', async () => {
    const w = await world();
    const folders = ['INBOX', 'INBOX.Archive', 'INBOX.Buckets.Reads', 'INBOX.Trash'];
    let rand = 42;
    const next = (n: number) => { rand = (rand * 1103515245 + 12345) % 2 ** 31; return rand % n; };
    try {
        const ids: string[] = [];
        for (let i = 0; i < 20; i++) {
            const parent = ids.length && next(3) === 0 ? ids[next(ids.length)] : undefined;
            ids.push((await deliver(w.phone, folders[next(3)], parent ? { inReplyTo: parent, references: `<${parent}>` } : {}))!);
        }
        await w.sync();
        for (let step = 0; step < 15; step++) {
            const from = folders[next(folders.length)];
            const uids = await serverUids(w.phone, from);
            if (uids.length) {
                const action = next(3);
                if (action === 0) await phoneMove(w.phone, from, [uids[next(uids.length)]], folders[next(folders.length)]);
                else if (action === 1) {
                    const lock = await w.phone.getMailboxLock(from);
                    try { await w.phone.messageFlagsAdd(String(uids[next(uids.length)]), ['\\Seen'], { uid: true }); } finally { lock.release(); }
                } else {
                    const parent = ids[next(ids.length)];
                    ids.push((await deliver(w.phone, from, next(2) ? { inReplyTo: parent, references: `<${parent}>` } : {}))!);
                }
            }
            await w.sync();
            await assertCacheMatchesServer(w);
            let total = 0;
            for (const c of folderCounts(w.store, w.account)) {
                const all = folderView(w.store, w.account, c.location, 10_000);
                assert.equal(all.threads.length, c.count, `count == list length for ${c.location}`);
                assert.equal(all.count, c.count);
                total += c.count;
            }
            const located = (w.store.db.prepare('SELECT COUNT(*) AS n FROM thread WHERE location IS NOT NULL').get() as { n: number }).n;
            assert.equal(total, located, 'every located thread appears in exactly one view');
            assertIncrementalMatchesFull(w);
        }
    } finally {
        await w.close();
    }
});

test('bridging-message-merges-threads: a reply referencing two conversations joins them', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'a1@test', subject: 'Budget', date: new Date(Date.UTC(2025, 0, 1)) });
        await deliver(w.phone, 'INBOX.Archive', { id: 'b1@test', subject: 'Forecast', date: new Date(Date.UTC(2025, 0, 2)) });
        await w.sync();
        assert.notEqual(threadOf(w, 'a1@test').thread_id, threadOf(w, 'b1@test').thread_id);

        await deliver(w.phone, 'INBOX', { id: 'c1@test', inReplyTo: 'b1@test', references: '<a1@test> <b1@test>', subject: 'Re: both' });
        await w.sync();
        const t = threadOf(w, 'c1@test');
        assert.equal(t.thread_id, 'a1@test', 'thread id is the earliest message');
        assert.equal(threadOf(w, 'b1@test').thread_id, 'a1@test');
        assert.equal(t.message_count, 3);
        assert.equal(folderView(w.store, w.account, 'INBOX.Archive').count, 0, 'merged thread lives in one place');
        assertIncrementalMatchesFull(w);
    } finally {
        await w.close();
    }
});

test('incremental-out-of-order: child first, then parent, then grandparent', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'third@test', references: '<first@test> <second@test>', inReplyTo: 'second@test', date: new Date(Date.UTC(2025, 2, 3)) });
        await w.sync();
        await deliver(w.phone, 'INBOX.Archive', { id: 'second@test', references: '<first@test>', inReplyTo: 'first@test', date: new Date(Date.UTC(2025, 2, 2)) });
        await w.sync();
        await deliver(w.phone, 'INBOX.Archive', { id: 'first@test', date: new Date(Date.UTC(2025, 2, 1)) });
        await w.sync();
        assert.equal(threadOf(w, 'third@test').thread_id, 'first@test');
        assert.equal(threadOf(w, 'third@test').message_count, 3);
        assertIncrementalMatchesFull(w);
    } finally {
        await w.close();
    }
});

test('interrupted-first-sync: leftovers from a partial sync are reconciled by the next full listing', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX');
        await deliver(w.phone, 'INBOX');
        await w.sync();
        // Simulate: a first sync wrote some batches, then died before saving its checkpoint,
        // and one of the messages it had written was deleted on the server meanwhile.
        w.store.db.prepare(`UPDATE folder SET uid_validity = NULL, highest_modseq = NULL WHERE path = 'INBOX'`).run();
        w.store.db.prepare(`INSERT INTO placement (account, folder, uid, msg_key, flags, seen) VALUES (?, 'INBOX', 999, 'ghost@test', '[]', 0)`).run(w.account);
        const r = (await w.sync()).find(r => r.path === 'INBOX')!;
        assert.equal(r.mode, 'full');
        await assertCacheMatchesServer(w);
        assert.equal(folderView(w.store, w.account, 'INBOX').count, 2);
    } finally {
        await w.close();
    }
});
