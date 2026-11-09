// Thread moves, undo, failure handling (engine/test/SCENARIOS.md "User actions").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ImapFlow } from 'imapflow';
import { world, deliver, assertCacheMatchesServer, threadOf, fresh, type World } from './engineHelpers.ts';
import { enqueueMoveThread, enqueueSetSeen, enqueueUndo, getTask, runPendingTasks } from '../src/tasks/tasks.ts';
import { folderView } from '../src/views/views.ts';
import { Store } from '../src/store/store.ts';

const FOLDERS = ['INBOX', 'INBOX.Archive', 'INBOX.Buckets.Reads', 'INBOX.Sent', 'INBOX.Trash'];

/** Where a message physically is on the server right now, with its flags. */
async function onServer(client: ImapFlow, messageId: string): Promise<Record<string, string[]>> {
    const found: Record<string, string[]> = {};
    for (const folder of FOLDERS) {
        await fresh(client);
        let lock;
        try {
            lock = await client.getMailboxLock(folder, { readOnly: true });
        } catch (err) {
            if ((err as { mailboxMissing?: boolean }).mailboxMissing) continue;
            throw err;
        }
        try {
            const uids = (await client.search({ header: { 'message-id': messageId } }, { uid: true })) || [];
            for (const uid of uids) {
                const m = await client.fetchOne(String(uid), { flags: true }, { uid: true });
                found[folder] = m ? [...(m.flags ?? [])].filter(f => f !== '\\Recent').sort() : [];
            }
        } finally {
            lock.release();
        }
    }
    return found;
}

/** A conversation spread over three folders: old parent archived, new reply in the inbox, our answer in Sent. */
async function conversation(w: World) {
    await deliver(w.phone, 'INBOX.Archive', { id: 'parent@test', subject: 'Trip', date: new Date(Date.UTC(2025, 5, 1)) });
    await deliver(w.phone, 'INBOX.Sent', { id: 'mine@test', inReplyTo: 'parent@test', references: '<parent@test>', subject: 'Re: Trip', flags: ['\\Seen'], date: new Date(Date.UTC(2025, 5, 2)) });
    await deliver(w.phone, 'INBOX', { id: 'reply@test', inReplyTo: 'mine@test', references: '<parent@test> <mine@test>', subject: 'Re: Trip', date: new Date(Date.UTC(2025, 5, 3)) });
    await w.sync();
    return threadOf(w, 'reply@test').thread_id;
}

test('client-task-move: whole thread moves; view changes before the server does', async () => {
    const w = await world();
    try {
        const threadId = await conversation(w);
        assert.equal(folderView(w.store, w.account, 'INBOX').count, 1);

        const taskId = enqueueMoveThread(w.store, w.account, threadId, 'INBOX.Buckets.Reads');
        assert.equal(folderView(w.store, w.account, 'INBOX').count, 0, 'local phase: instant');
        assert.equal(folderView(w.store, w.account, 'INBOX.Buckets.Reads').count, 1);
        assert.deepEqual(Object.keys(await onServer(w.phone, 'reply@test')), ['INBOX'], 'server untouched until remote phase');

        await w.sync(); // a background sync before the remote phase must not snap the card back
        assert.equal(folderView(w.store, w.account, 'INBOX.Buckets.Reads').count, 1);

        const [outcome] = await runPendingTasks(w.engine, w.store, w.account);
        assert.equal(outcome.status, 'done');
        assert.deepEqual(Object.keys(await onServer(w.phone, 'parent@test')), ['INBOX.Buckets.Reads']);
        assert.deepEqual(Object.keys(await onServer(w.phone, 'reply@test')), ['INBOX.Buckets.Reads']);
        assert.deepEqual(Object.keys(await onServer(w.phone, 'mine@test')), ['INBOX.Sent'], 'sent copy stays in Sent');
        await assertCacheMatchesServer(w);
        assert.equal(getTask(w.store, taskId)!.status, 'done');
        assert.equal(threadOf(w, 'reply@test').location, 'INBOX.Buckets.Reads');
    } finally {
        await w.close();
    }
});

test('undo-move-restores-placements: every message goes back exactly where it was', async () => {
    const w = await world();
    try {
        const threadId = await conversation(w);
        const taskId = enqueueMoveThread(w.store, w.account, threadId, 'INBOX.Buckets.Reads');
        await runPendingTasks(w.engine, w.store, w.account);

        enqueueUndo(w.store, w.account, taskId);
        assert.equal(folderView(w.store, w.account, 'INBOX').count, 1, 'undo shows instantly');
        await runPendingTasks(w.engine, w.store, w.account);

        assert.deepEqual(Object.keys(await onServer(w.phone, 'parent@test')), ['INBOX.Archive']);
        assert.deepEqual(Object.keys(await onServer(w.phone, 'reply@test')), ['INBOX']);
        await assertCacheMatchesServer(w);
        assert.equal(threadOf(w, 'reply@test').location, 'INBOX');
    } finally {
        await w.close();
    }
});

test('undo-before-remote-phase: cancelling never touches the server', async () => {
    const w = await world();
    try {
        const threadId = await conversation(w);
        const taskId = enqueueMoveThread(w.store, w.account, threadId, 'INBOX.Archive');
        assert.equal(enqueueUndo(w.store, w.account, taskId), null);
        assert.equal(folderView(w.store, w.account, 'INBOX').count, 1);
        await runPendingTasks(w.engine, w.store, w.account);
        assert.equal(getTask(w.store, taskId)!.status, 'cancelled');
        assert.deepEqual(Object.keys(await onServer(w.phone, 'reply@test')), ['INBOX']);
    } finally {
        await w.close();
    }
});

test('foreign-keywords-untouched: other clients\' markers survive move and undo', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'flagged@test', flags: ['$Forwarded', 'NonJunk', '$MailFlagBit0', '\\Seen'] });
        await w.sync();
        const before = (await onServer(w.phone, 'flagged@test')).INBOX;
        const taskId = enqueueMoveThread(w.store, w.account, threadOf(w, 'flagged@test').thread_id, 'INBOX.Archive');
        await runPendingTasks(w.engine, w.store, w.account);
        assert.deepEqual((await onServer(w.phone, 'flagged@test'))['INBOX.Archive'], before);
        enqueueUndo(w.store, w.account, taskId);
        await runPendingTasks(w.engine, w.store, w.account);
        assert.deepEqual((await onServer(w.phone, 'flagged@test')).INBOX, before);
    } finally {
        await w.close();
    }
});

test('thread-move-ends-whole: a failure halfway rolls back what already moved', async () => {
    const w = await world();
    try {
        const threadId = await conversation(w);
        // Fault injection: the second folder's MOVE fails as if the server said NO.
        const real = w.engine.messageMove.bind(w.engine);
        let calls = 0;
        w.engine.messageMove = (async (...args: Parameters<ImapFlow['messageMove']>) => {
            if (++calls === 2) throw new Error('simulated: server refused');
            return real(...args);
        }) as ImapFlow['messageMove'];

        const taskId = enqueueMoveThread(w.store, w.account, threadId, 'INBOX.Buckets.Reads');
        const [outcome] = await runPendingTasks(w.engine, w.store, w.account);
        assert.equal(outcome.status, 'failed');
        assert.match(getTask(w.store, taskId)!.error!, /simulated/);

        assert.deepEqual(Object.keys(await onServer(w.phone, 'parent@test')), ['INBOX.Archive'], 'rolled back');
        assert.deepEqual(Object.keys(await onServer(w.phone, 'reply@test')), ['INBOX'], 'never moved');
        await assertCacheMatchesServer(w);
        assert.equal(threadOf(w, 'reply@test').location, 'INBOX', 'card snaps back');
    } finally {
        await w.close();
    }
});

test('move-rejected-by-server + task-failure-never-wedges-queue', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'one@test' });
        await deliver(w.phone, 'INBOX', { id: 'two@test' });
        await w.sync();
        // The bucket folder is deleted on the phone after we last synced.
        await w.phone.mailboxDelete('INBOX.Buckets.Reads');
        const bad = enqueueMoveThread(w.store, w.account, threadOf(w, 'one@test').thread_id, 'INBOX.Buckets.Reads');
        const good = enqueueMoveThread(w.store, w.account, threadOf(w, 'two@test').thread_id, 'INBOX.Archive');

        const outcomes = await runPendingTasks(w.engine, w.store, w.account);
        assert.equal(outcomes.find(o => o.id === bad)!.status, 'failed');
        assert.equal(outcomes.find(o => o.id === good)!.status, 'done', 'queue keeps going');
        assert.deepEqual(Object.keys(await onServer(w.phone, 'one@test')), ['INBOX']);
        assert.deepEqual(Object.keys(await onServer(w.phone, 'two@test')), ['INBOX.Archive']);
        assert.equal(threadOf(w, 'one@test').location, 'INBOX');
        assert.match(getTask(w.store, bad)!.error!, /no longer exists/);
    } finally {
        await w.close();
    }
});

test('remote-move-while-task-in-flight: moves what is still there, no error', async () => {
    const w = await world();
    try {
        const threadId = await conversation(w);
        enqueueMoveThread(w.store, w.account, threadId, 'INBOX.Buckets.Reads');
        // Before our remote phase runs, the phone trashes the archived parent.
        const lock = await w.phone.getMailboxLock('INBOX.Archive');
        try { await w.phone.messageMove('1:*', 'INBOX.Trash', { uid: true }); } finally { lock.release(); }

        const [outcome] = await runPendingTasks(w.engine, w.store, w.account);
        assert.equal(outcome.status, 'done');
        assert.deepEqual(Object.keys(await onServer(w.phone, 'parent@test')), ['INBOX.Trash'], 'trash wins; not dragged out');
        assert.deepEqual(Object.keys(await onServer(w.phone, 'reply@test')), ['INBOX.Buckets.Reads']);
        await w.sync(); // the task only resyncs folders it touched; the phone's Trash arrives via background sync
        await assertCacheMatchesServer(w);
    } finally {
        await w.close();
    }
});

test('transient failure is retried, then completes', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'net@test' });
        await w.sync();
        const real = w.engine.messageMove.bind(w.engine);
        let calls = 0;
        w.engine.messageMove = (async (...args: Parameters<ImapFlow['messageMove']>) => {
            if (++calls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
            return real(...args);
        }) as ImapFlow['messageMove'];

        const id = enqueueMoveThread(w.store, w.account, threadOf(w, 'net@test').thread_id, 'INBOX.Archive');
        const [first] = await runPendingTasks(w.engine, w.store, w.account);
        assert.equal(first.status, 'pending');
        assert.equal(threadOf(w, 'net@test').location, 'INBOX.Archive', 'still shown where the user put it');
        const [second] = await runPendingTasks(w.engine, w.store, w.account);
        assert.equal(second.status, 'done');
        assert.equal(getTask(w.store, id)!.attempts, 1);
        assert.deepEqual(Object.keys(await onServer(w.phone, 'net@test')), ['INBOX.Archive']);
    } finally {
        await w.close();
    }
});

test('restart-resumes-pending-task: a queued move survives an engine restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-'));
    const file = path.join(dir, 'cache.sqlite');
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'later@test' });
        const first = new Store(file);
        const { syncAccount } = await import('../src/sync/folderSync.ts');
        const { rebuildThreads } = await import('../src/threads/threads.ts');
        await syncAccount(w.engine, first, w.account);
        rebuildThreads(first, w.account);
        const threadId = (first.db.prepare("SELECT thread_id FROM message WHERE msg_key = 'later@test'").get() as { thread_id: string }).thread_id;
        enqueueMoveThread(first, w.account, threadId, 'INBOX.Archive');
        first.close(); // "crash" before the remote phase

        const second = new Store(file);
        const [outcome] = await runPendingTasks(w.engine, second, w.account);
        second.close();
        assert.equal(outcome.status, 'done');
        assert.deepEqual(Object.keys(await onServer(w.phone, 'later@test')), ['INBOX.Archive']);
    } finally {
        await w.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('mark-read-fans-out-to-all-placements; mark unread touches only the newest message', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX.Archive', { id: 'old@test', date: new Date(Date.UTC(2025, 1, 1)) });
        await deliver(w.phone, 'INBOX', { id: 'new@test', inReplyTo: 'old@test', references: '<old@test>', date: new Date(Date.UTC(2025, 1, 2)) });
        await deliver(w.phone, 'INBOX.Buckets.Reads', { id: 'new@test' }); // a second copy of the same message
        await w.sync();
        const threadId = threadOf(w, 'new@test').thread_id;
        assert.equal(folderView(w.store, w.account, 'INBOX').unreadThreads, 1);

        enqueueSetSeen(w.store, w.account, threadId, true);
        assert.equal(folderView(w.store, w.account, 'INBOX').unreadThreads, 0, 'local phase: instant');
        await w.sync(); // a resync before the remote phase must not bring the unread badge back
        assert.equal(folderView(w.store, w.account, 'INBOX').unreadThreads, 0);

        await runPendingTasks(w.engine, w.store, w.account);
        const newCopies = await onServer(w.phone, 'new@test');
        assert.deepEqual(Object.keys(newCopies).sort(), ['INBOX', 'INBOX.Buckets.Reads']);
        assert.ok(Object.values(newCopies).every(f => f.includes('\\Seen')), 'every copy marked read');
        assert.ok((await onServer(w.phone, 'old@test'))['INBOX.Archive'].includes('\\Seen'));
        await assertCacheMatchesServer(w);

        enqueueSetSeen(w.store, w.account, threadId, false);
        await runPendingTasks(w.engine, w.store, w.account);
        assert.ok(!(await onServer(w.phone, 'new@test')).INBOX.includes('\\Seen'), 'newest marked unread');
        assert.ok((await onServer(w.phone, 'old@test'))['INBOX.Archive'].includes('\\Seen'), 'older stays read');
        assert.equal(folderView(w.store, w.account, 'INBOX').unreadThreads, 1);
        await assertCacheMatchesServer(w);
    } finally {
        await w.close();
    }
});
