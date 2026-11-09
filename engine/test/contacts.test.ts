// Recipient suggestions (Explore 2, section 8): a live query on the cached addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store/store.ts';
import { suggestContacts } from '../src/app/contacts.ts';

function cache() {
    const store = new Store(':memory:');
    let uid = 0;
    const add = (account: string, folder: string, from: [string | null, string], others: string[], date: string) => {
        const key = `m${++uid}@test`;
        store.insertMessage(account, {
            msgKey: key, messageId: key, inReplyTo: null, refs: [], addresses: [from[1], ...others],
            subject: 'Hi', fromName: from[0], fromAddr: from[1], date, size: 1,
        });
        store.upsertPlacement(account, folder, { uid, msgKey: key, flags: [], modseq: null });
    };
    for (const a of ['a1', 'a2']) {
        store.upsertFolderRole(a, 'INBOX', 'inbox');
        store.upsertFolderRole(a, 'INBOX.Sent', 'sent');
    }
    return { store, add };
}

test('suggestions: people you wrote to first, then how often, then how recently; names from mail they sent; never yourself', () => {
    const { store, add } = cache();
    // Dana wrote to me twice; Dan once but I wrote to Dan (Sent); dad@ once, recently; both accounts count.
    add('a1', 'INBOX', ['Dana Whitfield', 'dana@example.org'], ['me@test'], '2026-10-01T10:00:00Z');
    add('a2', 'INBOX', ['Dana Whitfield', 'dana@example.org'], ['work@test'], '2026-10-02T10:00:00Z');
    add('a1', 'INBOX', ['Daniel Okafor', 'dan.okafor@example.net'], ['me@test'], '2026-09-01T10:00:00Z');
    add('a1', 'INBOX.Sent', [null, 'me@test'], ['dan.okafor@example.net'], '2026-09-02T10:00:00Z');
    add('a2', 'INBOX', [null, 'dad@example.com'], ['work@test'], '2026-10-20T10:00:00Z');
    add('a1', 'INBOX', ['Ali Davis', 'ali@example.com'], ['me@test'], '2026-08-01T10:00:00Z');

    const found = suggestContacts(store, 'Da', ['me@test', 'work@test']);
    assert.deepEqual(found.find(c => c.address === 'dana@example.org'), { name: 'Dana Whitfield', address: 'dana@example.org' }, 'names come from mail they sent');
    assert.deepEqual(found.find(c => c.address === 'dad@example.com'), { name: null, address: 'dad@example.com' }, 'no name known');
    const ranked = suggestContacts(store, 'da', ['me@test', 'work@test']).map(c => c.address);
    assert.equal(ranked[0], 'dan.okafor@example.net', 'someone you wrote to comes first');
    assert.equal(ranked[1], 'dana@example.org', 'then the most frequent');
    assert.deepEqual(new Set(ranked), new Set(['dan.okafor@example.net', 'dana@example.org', 'ali@example.com', 'dad@example.com']));
    assert.deepEqual(suggestContacts(store, 'me', ['me@test', 'work@test']), [], 'never your own addresses');
    assert.deepEqual(suggestContacts(store, '%', []), [], 'typed text is matched literally');
    assert.deepEqual(suggestContacts(store, '  ', []), []);
    store.close();
});
