// Search (Phase 2 slice 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, deliver } from './engineHelpers.ts';
import { ftsQuery, search } from '../src/search/search.ts';

test('ftsQuery: every word required, last word a prefix, user syntax never interpreted', () => {
    assert.equal(ftsQuery('  invoice  octo '), '"invoice" "octo"*');
    assert.equal(ftsQuery('a"b*c (NEAR) -xy'), '"abc" "NEAR" "xy"*');
    assert.equal(ftsQuery('   '), null);
    assert.equal(ftsQuery('invoice a'), '"invoice" "a"', 'a lone letter is not a prefix');
});

test('search: accents, prefixes, sender name and address, one card per thread, no Junk, folder filter, previews', async () => {
    const w = await world();
    try {
        await deliver(w.phone, 'INBOX', { id: 'cafe@test', subject: 'Café menu for Friday', from: 'Ada Lovelace <ada@example.com>' });
        await deliver(w.phone, 'INBOX', { id: 'inv1@test', subject: 'Invoice October', from: 'billing@shop.example' });
        await deliver(w.phone, 'INBOX', { id: 'inv1-reply@test', subject: 'Re: Invoice October', inReplyTo: 'inv1@test', references: '<inv1@test>', from: 'billing@shop.example' });
        await deliver(w.phone, 'INBOX.Archive', { id: 'inv0@test', subject: 'Invoice September', from: 'billing@shop.example' });
        await deliver(w.phone, 'INBOX.Junk', { id: 'spam@test', subject: 'Invoice overdue!!!', from: 'scam@bad.example' });
        await deliver(w.phone, 'INBOX', { id: 'other@test', subject: 'Weekend plans', from: 'bob@example.com' });
        await w.sync();

        const ids = (q: string, location?: string) => search(w.store, w.account, q, { location }).threads.map(t => t.threadId).sort();
        assert.deepEqual(ids('cafe'), ['cafe@test'], 'accents folded');
        assert.deepEqual(ids('lovelace'), ['cafe@test'], 'sender name');
        assert.deepEqual(ids('ada@example'), ['cafe@test'], 'sender address');
        assert.deepEqual(ids('invo'), ['inv0@test', 'inv1@test'], 'prefix; the two-message thread appears once; Junk excluded');
        assert.deepEqual(ids('invoice', 'INBOX.Archive'), ['inv0@test'], 'one folder');
        assert.deepEqual(ids('invoice october'), ['inv1@test'], 'all words required');
        const page = search(w.store, w.account, 'invoice');
        assert.equal(page.count, page.threads.length);

        assert.deepEqual(ids('fondue'), []);
        w.store.db.prepare(`UPDATE message SET preview = 'Fondue night at the café' WHERE msg_key = 'other@test'`).run();
        assert.deepEqual(ids('fondue'), ['other@test'], 'previews are searchable as soon as they arrive');

        for (const nasty of ['"', '*', 'NEAR(a b)', 'a OR b', '^start', 'col:val', '))((']) {
            assert.doesNotThrow(() => search(w.store, w.account, nasty), `query ${nasty}`);
        }
    } finally {
        await w.close();
    }
});
