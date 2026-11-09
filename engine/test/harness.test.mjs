// Phase 0 harness tests: prove the test server behaves like production, and that the IMAP
// primitives the plan relies on (docs/architecture.md, "Borrowed, not invented") work through imapflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, freshUser, rawMessage } from './helpers.mjs';

test('test server matches the shape of a typical shared host', async () => {
    const client = await connect(freshUser());
    try {
        for (const cap of ['CONDSTORE', 'QRESYNC', 'MOVE', 'UIDPLUS', 'IDLE']) {
            assert.ok(client.capabilities.has(cap), `missing ${cap}`);
        }
        const ns = client.namespace;
        assert.equal(ns.prefix, 'INBOX.');
        assert.equal(ns.delimiter, '.');
    } finally {
        await client.logout();
    }
});

test('MOVE keeps keywords and reports new UIDs (migration is reversible)', async () => {
    const client = await connect(freshUser());
    try {
        await client.mailboxCreate('INBOX.Buckets.Reads');
        await client.append('INBOX', rawMessage({ messageId: '<m1@x>' }), ['$bucket_123']);

        const lock = await client.getMailboxLock('INBOX');
        let moved;
        try {
            moved = await client.messageMove('1:*', 'INBOX.Buckets.Reads', { uid: true });
        } finally {
            lock.release();
        }
        assert.ok(moved.uidMap?.size === 1, 'server returned COPYUID mapping');
        const newUid = [...moved.uidMap.values()][0];

        const lock2 = await client.getMailboxLock('INBOX.Buckets.Reads');
        try {
            const msg = await client.fetchOne(String(newUid), { flags: true }, { uid: true });
            assert.ok(msg.flags.has('$bucket_123'), 'keyword survived the move');
        } finally {
            lock2.release();
        }
    } finally {
        await client.logout();
    }
});

test('QRESYNC reports messages another client removed while we were away', async () => {
    const user = freshUser();
    const setup = await connect(user);
    await setup.mailboxCreate('INBOX.Archive');
    for (const id of ['<a@x>', '<b@x>', '<c@x>']) await setup.append('INBOX', rawMessage({ messageId: id }));
    await setup.logout();

    // Our engine syncs and stores a checkpoint.
    const engine = await connect(user, { qresync: true });
    const first = await engine.mailboxOpen('INBOX');
    const checkpoint = { uidValidity: first.uidValidity, highestModseq: first.highestModseq };
    await engine.logout();

    // Meanwhile, the phone archives message 2.
    const phone = await connect(user);
    const lock = await phone.getMailboxLock('INBOX');
    try {
        await phone.messageMove('2', 'INBOX.Archive', { uid: true });
    } finally {
        lock.release();
    }
    await phone.logout();

    // Engine reconnects with its checkpoint and must learn exactly which UID vanished.
    const engine2 = await connect(user, { qresync: true });
    const vanished = [];
    engine2.on('expunge', e => vanished.push(e));
    const reopened = await engine2.mailboxOpen('INBOX', {
        uidValidity: checkpoint.uidValidity,
        changedSince: checkpoint.highestModseq,
    });
    await engine2.logout();

    assert.equal(reopened.uidValidity, checkpoint.uidValidity, 'UIDVALIDITY unchanged, cache still valid');
    assert.deepEqual(vanished.map(e => e.uid), [2]);
    assert.ok(vanished.every(e => e.vanished), 'reported via VANISHED, not a sequence-number EXPUNGE');
});
