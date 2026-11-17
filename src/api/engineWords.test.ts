// node --test (npm test): the engine's refusals in plain words (design system v2, phase 3, item 1).
// Each case is the engine's own wording (inventory 2, §4; `{…}` filled in with made-up values).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asSentence, failedLine, plainWords, tryAgain } from './engineWords.ts';

// [inventory 2 row, the engine's words, the screens' words]
const CASES: [string, string, string][] = [
    ['1', 'not logged in', "you're signed out"],
    ['2', 'search text is too long', "that's too long to search for. Try fewer words"],
    ['3', 'not signed in', "you're signed out"],
    ['4', 'Incoming mail (IMAP): the username is required', 'enter the username for the receiving server'],
    ['4', 'Outgoing mail (SMTP): the username is required', 'enter the username for the sending server'],
    ['5', 'a bucket called "Reads" already exists', 'there\'s already a bucket called “Reads”'],
    ['6', 'that draft is no longer here', "it's no longer in Drafts. It may have been sent or deleted on another device"],
    ['7', 'pat@example.test is already set up', 'that account is already in Mail'],
    ['8', 'Incoming mail (IMAP): the server rejected the username or password', "the server didn't accept the username or password"],
    ['8', 'Incoming mail (IMAP): the server name was not found (check the host name)', "there's no server by that name. Check the spelling"],
    ['8', 'Incoming mail (IMAP): could not reach the server (check the host, port and network)', "couldn't reach the server. Check its name and the port"],
    ['8', "Incoming mail (IMAP): the secure connection failed: the server's certificate is not valid", "the server's security certificate isn't valid, so Mail didn't connect"],
    ['8', 'Incoming mail (IMAP): the secure connection failed (try the other security setting or port)', 'the secure connection failed. Try the other security setting or port'],
    ['8', 'Incoming mail (IMAP): Mailbox is full', 'Mailbox is full'], // the server's own words, as it said them
    ['9', 'Outgoing mail (SMTP): the server refused the connection (check the port)', 'the server refused the connection. Check the port'],
    ['10', 'Outgoing mail (SMTP): the connection failed', 'the connection failed'],
    ['11', 'already sent', 'it was already sent'],
    ['12', 'Use a full address (news@example.com) or a domain starting with @ (@example.com)', 'Use a full address (news@example.com) or a domain starting with @ (@example.com)'],
    ['13', "There's already a rule for news@example.com", "There's already a rule for news@example.com"],
    ['14', 'this is not an Electronic Mail settings file', "that isn't a Mail settings file"],
    ['15', 'unknown account made-up-1', 'that account is no longer in Mail'],
    ['16', "the sign-in service isn't answering (fetch failed)", "the sign-in service isn't answering. Try again in a moment"],
    ['17', 'attachments are limited to 25 MB', "attachments can't be more than 25 MB in all"],
    ['18', 'unknown account', 'that account is no longer in Mail'],
    ['19', 'attachments together are limited to 25 MB', "attachments can't be more than 25 MB in all"],
    ['20', 'unknown account made-up-2', 'that account is no longer in Mail'],
    ['21', 'no bucket called "Reads"', 'there\'s no bucket called “Reads” any more'],
    ['22', 'rule not found', 'that rule is no longer there'],
    ['24', 'thread not found', 'that thread is no longer in your mailbox'],
    ['25', 'task not found', "there's nothing left to undo"],
    ['26', "this account has no Archive folder to move the bucket's mail into", 'this account has no Archive folder to take its mail'],
    ['27', 'the server refused to move "Reads" to Archive; nothing was deleted', "the mail server wouldn't move its mail to the Archive, so nothing was deleted"],
    ['28', '"Reads" is not empty; nothing was deleted', 'it still has mail in it, so nothing was deleted. Try again'],
    ['30', 'the message you are replying to is no longer here', "the message you're replying to is no longer in your mailbox"],
    ['31', 'the message you are replying to has no Message-ID, so a reply cannot be threaded', "the message you're replying to can't be answered in its thread. Write a new message instead"],
    ['33', 'the server refused to save the draft', "the mail server wouldn't save the draft"],
    ['34', 'this account has no Drafts folder', 'this account has no Drafts folder on its mail server'],
    ['35', 'Outgoing mail (SMTP): a password is required', 'enter a password for the sending server'],
    ['36', 'only failed or uncertain messages can be sent again', "it's already being sent, or was sent"],
    ['37', 'only failed or uncertain messages can be discarded', "it's already being sent, or was sent"],
    ['38', 'that attachment is no longer available; please attach it again', 'an attachment is no longer available. Attach it again'],
    ['39', 'message acct:INBOX:12 is no longer on the server', 'that message is no longer on the mail server'],
    ['40', 'attachment 2 of acct:INBOX:12 not found', 'that attachment is no longer on the mail server'],
    ['41', 'message acct:INBOX:12 not found', 'that message is no longer on the mail server'],
    ['42', 'unknown thread made-up-thread', 'that thread is no longer in your mailbox'],
    ['43', 'unknown folder INBOX.Buckets.Gone', 'that folder is no longer on the mail server'],
    ['44', 'task 12 is not a move', "there's nothing left to undo"],
    ['45', 'task 12 is running; nothing to undo', "it's moving right now. Try again in a moment"],
    ['45', 'task 12 is failed; nothing to undo', "there's nothing left to undo"],
    ['46', 'folder INBOX.Buckets.Gone no longer exists on the server', 'that folder is no longer on the mail server'],
    ['47', 'task 12 not found', "there's nothing left to undo"],
    ['48', 'server refused to change read state in INBOX', "the mail server wouldn't mark it read or unread"],
    ['49', 'server refused to move messages from INBOX to INBOX.Archive', "the mail server wouldn't move it"],
    ['offline', 'pat@example.test is offline', "pat@example.test isn't connected to its mail server right now"],
];

test('the realistic and rare refusals each have plain words (inventory 2, §4)', () => {
    for (const [row, engine, screen] of CASES) assert.equal(plainWords(engine), screen, `row ${row}: ${engine}`);
    // Rows 23 and 29 are row 21's words with another status; 32 is 16's
    const rows = new Set(CASES.map(c => c[0]));
    for (let n = 1; n <= 49; n++) assert.ok(rows.has(String(n)) || [23, 29, 32].includes(n), `row ${n} has a case`);
});

test('no "please", no technology names, no exclamation marks in the plain words (W2, W4)', () => {
    for (const [, engine] of CASES) assert.doesNotMatch(plainWords(engine) ?? '', /please|IMAP|SMTP|Message-ID|!/i, engine);
});

test('everything else has nothing to say beyond what failed', () => {
    for (const engine of ['internal error', 'requests that change something must send JSON', 'cross-site request refused', 'read-only', '']) {
        assert.equal(plainWords(engine), null, engine);
    }
    assert.equal(plainWords('Command failed', 'the mail server refused it'), 'the mail server refused it', 'a fallback of its own');
});

test('a failure names its action: with a reason after a colon, without one "Try again." (owner, Checkpoint C)', () => {
    assert.equal(failedLine('create the bucket', 'pat@example.test isn\'t connected to its mail server right now'), "Couldn't create the bucket: pat@example.test isn't connected to its mail server right now");
    assert.equal(failedLine('create the bucket', plainWords('internal error')), "Couldn't create the bucket. Try again.");
    assert.equal(tryAgain('load the Inbox'), "Couldn't load the Inbox. Try again.");
});

test('a clause stands alone as a sentence', () => {
    assert.equal(asSentence('that thread is no longer in your mailbox'), 'That thread is no longer in your mailbox.');
    assert.equal(asSentence("the server isn't answering"), "The server isn't answering.");
    assert.equal(asSentence('it still has mail in it, so nothing was deleted. Try again.'), 'It still has mail in it, so nothing was deleted. Try again.');
});
