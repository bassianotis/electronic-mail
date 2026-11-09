// Auto-archive per bucket (feature batch 1): the age rule and the cap, a reply restarting the
// clock, the notice, and undoing a whole batch, against the Docker Dovecot harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { world, deliver, fresh, threadOf, type World } from './engineHelpers.ts';
import { enqueueMoveThread, getTask, runPendingTasks } from '../src/tasks/tasks.ts';
import { countOld, lastSweep, markSeen, sweep, sweepNotice, undoSweeps } from '../src/app/autoArchive.ts';
import { AppDb } from '../src/app/appDb.ts';
import { Accounts } from '../src/app/accounts.ts';
import { Buckets } from '../src/app/buckets.ts';
import { Rules } from '../src/app/rules.ts';
import { Store } from '../src/store/store.ts';
import { loadOrCreateKey } from '../src/app/secrets.ts';
import { exportSettings, importSettings } from '../src/app/settings.ts';

const READS = 'INBOX.Buckets.Reads';
const TASKS = 'INBOX.Buckets.Tasks';
const ARCHIVE = 'INBOX.Archive';
const DAY = 24 * 60 * 60_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const rules = [{ name: 'Reads', path: READS, days: 30 }, { name: 'Tasks', path: TASKS, days: 30 }];

/** Message-IDs in a folder on the server (a fresh SELECT, never a stale view). */
async function inFolder(w: World, folder: string): Promise<string[]> {
    await fresh(w.phone);
    const lock = await w.phone.getMailboxLock(folder, { readOnly: true });
    try {
        const out: string[] = [];
        if (w.phone.mailbox && w.phone.mailbox.exists) for await (const m of w.phone.fetch('1:*', { envelope: true })) out.push((m.envelope?.messageId ?? '?').replace(/[<>]/g, ''));
        return out.sort();
    } finally {
        lock.release();
    }
}

const queuedFor = (w: World, taskIds: number[]) => taskIds.map(id => {
    const p = JSON.parse(getTask(w.store, id)!.payload) as { msgKeys: string[]; to: string; origin?: string };
    return { keys: p.msgKeys, to: p.to, origin: p.origin };
});

test('auto-archive: only items past the age, oldest first across buckets, capped per sweep', async () => {
    const w = await world();
    try {
        await w.phone.mailboxCreate(TASKS);
        await deliver(w.phone, READS, { id: 'r40@test', date: daysAgo(40) });
        await deliver(w.phone, READS, { id: 'r35@test', date: daysAgo(35) });
        await deliver(w.phone, READS, { id: 'r31@test', date: daysAgo(31) });
        await deliver(w.phone, READS, { id: 'r2@test', date: daysAgo(2) });
        await deliver(w.phone, TASKS, { id: 't50@test', date: daysAgo(50) });
        await w.sync();
        assert.equal(countOld(w.store, w.account, READS, 30), 3, 'what the setting would archive now');
        assert.equal(countOld(w.store, w.account, READS, 1), 4);

        const first = sweep(w.store, w.account, rules, new Date(), 2)!;
        assert.equal(first.moved, 2, 'capped');
        const batch = JSON.parse((w.store.db.prepare('SELECT moves FROM sweep WHERE id = ?').get(first.id) as { moves: string }).moves) as { taskId: number; bucket: string }[];
        assert.deepEqual(batch.map(m => m.bucket), ['Tasks', 'Reads'], 'oldest first, whichever bucket');
        assert.deepEqual(queuedFor(w, batch.map(m => m.taskId)), [
            { keys: ['t50@test'], to: ARCHIVE, origin: 'autoArchive' },
            { keys: ['r40@test'], to: ARCHIVE, origin: 'autoArchive' },
        ], 'ordinary moves to Archive, tagged like rule moves');
        assert.equal(threadOf(w, 'r40@test').location, ARCHIVE, 'gone from the bucket at once (local phase)');

        assert.equal(sweep(w.store, w.account, rules, new Date(), 2)!.moved, 2, 'the next sweep takes the rest');
        assert.equal(sweep(w.store, w.account, rules, new Date(), 2), null, 'then nothing is due');
        assert.equal(lastSweep(w.store, w.account)?.moved, 0, 'a sweep that moved nothing is still noted, for a restart');
        sweep(w.store, w.account, rules, new Date(), 2);
        assert.equal((w.store.db.prepare(`SELECT COUNT(*) AS n FROM sweep WHERE moves = '[]'`).get() as { n: number }).n, 1, 'one such note');
        assert.equal(sweepNotice(w.store, w.account)?.count, 4, 'notes add nothing to the notice');

        await runPendingTasks(w.engine, w.store, w.account);
        assert.deepEqual(await inFolder(w, READS), ['r2@test']);
        assert.deepEqual(await inFolder(w, TASKS), []);
        assert.deepEqual(await inFolder(w, ARCHIVE), ['r31@test', 'r35@test', 'r40@test', 't50@test']);
    } finally {
        await w.close();
    }
});

test('auto-archive: a reply restarts the clock, even once filed back into the bucket', async () => {
    const w = await world();
    try {
        await deliver(w.phone, READS, { id: 'trip@test', subject: 'Trip', date: daysAgo(60) });
        await w.sync();
        assert.equal(countOld(w.store, w.account, READS, 30), 1);

        await deliver(w.phone, 'INBOX', { id: 'trip-reply@test', subject: 'Re: Trip', inReplyTo: 'trip@test', references: '<trip@test>', date: daysAgo(1) });
        await w.sync();
        assert.equal(threadOf(w, 'trip@test').location, 'INBOX', 'the reply brings it back to the Inbox');
        assert.equal(sweep(w.store, w.account, rules), null, 'nothing old left in the bucket');

        enqueueMoveThread(w.store, w.account, threadOf(w, 'trip@test').thread_id, READS);
        await runPendingTasks(w.engine, w.store, w.account);
        assert.equal(threadOf(w, 'trip@test').location, READS, 'filed back into the bucket');
        assert.equal(countOld(w.store, w.account, READS, 30), 0, 'its age is the reply\'s, a day');
        assert.equal(sweep(w.store, w.account, rules), null);
        assert.equal(sweep(w.store, w.account, [{ name: 'Reads', path: READS, days: 1 }], new Date(Date.now() + DAY))?.moved, 1,
            'and it goes once the reply is old enough');
    } finally {
        await w.close();
    }
});

test('auto-archive: the notice shows once, combines buckets; Undo takes the whole batch back and restarts its clock', async () => {
    const w = await world();
    try {
        await w.phone.mailboxCreate(TASKS);
        for (const n of [40, 41, 42]) await deliver(w.phone, READS, { id: `r${n}@test`, date: daysAgo(n) });
        for (const n of [50, 51]) await deliver(w.phone, TASKS, { id: `t${n}@test`, date: daysAgo(n) });
        await w.sync();
        assert.equal(sweepNotice(w.store, w.account), null, 'nothing swept yet');

        sweep(w.store, w.account, [rules[0]]);
        sweep(w.store, w.account, [rules[1]]);
        await runPendingTasks(w.engine, w.store, w.account);
        const notice = sweepNotice(w.store, w.account)!;
        assert.deepEqual({ ...notice, buckets: [...notice.buckets].sort(), ids: notice.ids.length },
            { count: 5, buckets: ['Reads', 'Tasks'], undoable: true, ids: 2 }, 'two sweeps, one notice');

        assert.equal(undoSweeps(w.store, w.account, notice.ids), 5);
        assert.equal(sweepNotice(w.store, w.account), null, 'undone: nothing left to say');
        assert.equal(threadOf(w, 'r40@test').location, READS, 'back at once (local phase)');
        await runPendingTasks(w.engine, w.store, w.account);
        assert.deepEqual(await inFolder(w, READS), ['r40@test', 'r41@test', 'r42@test']);
        assert.deepEqual(await inFolder(w, TASKS), ['t50@test', 't51@test']);
        assert.deepEqual(await inFolder(w, ARCHIVE), []);
        assert.equal(undoSweeps(w.store, w.account, notice.ids), 0, 'a second Undo does nothing');

        assert.equal(sweep(w.store, w.account, rules), null, 'what Undo brought back stays: its clock starts again');
        assert.equal(countOld(w.store, w.account, READS, 30), 0, 'and isn\'t counted as due');
        await deliver(w.phone, READS, { id: 'r43@test', date: daysAgo(43) });
        await w.sync();
        assert.equal(sweep(w.store, w.account, rules)?.moved, 1, 'other old items still go');
        const later = sweepNotice(w.store, w.account)!;
        assert.deepEqual([later.count, later.buckets], [1, ['Reads']]);
        markSeen(w.store, w.account, later.ids);
        assert.equal(sweepNotice(w.store, w.account), null, 'shown once');
        assert.equal(sweep(w.store, w.account, rules, new Date(Date.now() + 31 * DAY))?.moved, 5, 'another 30 days on, they go');
    } finally {
        await w.close();
    }
});

test('auto-archive: batches older than 7 days are shown without Undo, and can\'t be undone', () => {
    const store = new Store(':memory:');
    try {
        store.db.prepare(`INSERT INTO folder (account, path, role) VALUES ('a', 'INBOX.Archive', 'archive')`).run();
        store.db.prepare(`INSERT INTO task (account, kind, payload, status, created_at, updated_at) VALUES ('a', 'moveThread', ?, 'done', ?, ?)`)
            .run(JSON.stringify({ threadId: 't', msgKeys: ['k'], to: 'INBOX.Archive', from: 'INBOX.Buckets.Reads', origin: 'autoArchive' }), daysAgo(8).toISOString(), daysAgo(8).toISOString());
        store.db.prepare(`INSERT INTO sweep (account, created_at, moves) VALUES ('a', ?, '[{"taskId":1,"bucket":"Reads"}]')`).run(daysAgo(8).toISOString());
        const notice = sweepNotice(store, 'a')!;
        assert.deepEqual([notice.count, notice.undoable], [1, false]);
        assert.equal(undoSweeps(store, 'a', notice.ids), 0);
    } finally {
        store.close();
    }
});

test('auto-archive setting: 1 to 365 days or off; settings export and import carry it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-archive-'));
    const layer = () => {
        const app = new AppDb(path.join(fs.mkdtempSync(path.join(dir, 'x-')), 'app.sqlite'));
        const accounts = new Accounts(app, loadOrCreateKey(path.join(dir, 'secret.key')));
        return { app, accounts, rules: new Rules(app) };
    };
    const a = layer();
    const acct = a.accounts.create({ email: 'me@example.com', imap: { host: 'h', port: 993, secure: true, user: 'u', pass: 'p' } });
    const store = new Store(':memory:');
    store.db.prepare(`INSERT INTO folder (account, path, role) VALUES (?, 'INBOX.Buckets.Reads', 'bucket')`).run(acct.id);
    const buckets = new Buckets(a.app, store);
    const worker = { touch() {} } as never;
    assert.equal(buckets.list(acct.id)[0].autoArchiveDays, null, 'off by default');
    assert.equal(buckets.setAppearance(worker, acct.id, 'Reads', { autoArchiveDays: 30 }).autoArchiveDays, 30);
    assert.deepEqual(buckets.autoArchiveRules(acct.id), [{ name: 'Reads', path: 'INBOX.Buckets.Reads', days: 30 }]);
    assert.equal(buckets.setAppearance(worker, acct.id, 'Reads', { color: '#112233' }).autoArchiveDays, 30, 'other changes keep it');
    for (const bad of [0, 366, 2.5]) assert.throws(() => buckets.setAppearance(worker, acct.id, 'Reads', { autoArchiveDays: bad }), /1 to 365/);

    const file = exportSettings(a.app, a.accounts, a.rules);
    assert.equal(file.accounts[0].buckets[0].autoArchiveDays, 30, 'the export carries it');
    const b = layer();
    b.accounts.create({ email: 'me@example.com', imap: { host: 'h', port: 993, secure: true, user: 'u', pass: 'p' } });
    importSettings(b.app, b.accounts, b.rules, JSON.parse(JSON.stringify(file)));
    const days = () => (b.app.db.prepare('SELECT auto_archive_days AS d FROM bucket_meta').get() as { d: number | null }).d;
    assert.equal(days(), 30, 'and the import restores it');
    const older = JSON.parse(JSON.stringify(file));
    delete older.accounts[0].buckets[0].autoArchiveDays;
    importSettings(b.app, b.accounts, b.rules, older);
    assert.equal(days(), null, 'a file from before it existed imports as off');
    assert.equal(buckets.setAppearance(worker, acct.id, 'Reads', { autoArchiveDays: null }).autoArchiveDays, null, 'null turns it off');
    store.close();
    a.app.close();
    b.app.close();
});
