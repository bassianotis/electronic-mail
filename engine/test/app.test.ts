// App layer: encryption at rest, migrations, login/sessions, accounts, import from the old app.
// No mail server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { decrypt, encrypt, loadOrCreateKey } from '../src/app/secrets.ts';
import { AppDb } from '../src/app/appDb.ts';
import { Auth, RateLimited } from '../src/app/auth.ts';
import { Accounts } from '../src/app/accounts.ts';
import { importFromOldApp } from '../src/app/importOld.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));

function setup(now?: () => number) {
    const dir = tmp();
    const key = loadOrCreateKey(path.join(dir, 'secret.key'));
    const app = new AppDb(path.join(dir, 'app.sqlite'));
    return { dir, key, app, auth: new Auth(app, { now }), accounts: new Accounts(app, key) };
}

/** Every byte of the database files, to prove a secret never lands there in plain text. */
function dbBytes(dir: string): string {
    return fs.readdirSync(dir).filter(f => f.startsWith('app.sqlite')).map(f => fs.readFileSync(path.join(dir, f)).toString('latin1')).join('');
}

test('secrets: round trip; tampering and the wrong key are rejected; key file is private', () => {
    const dir = tmp();
    const key = loadOrCreateKey(path.join(dir, 'secret.key'));
    assert.equal(fs.statSync(path.join(dir, 'secret.key')).mode & 0o777, 0o600);
    assert.deepEqual(loadOrCreateKey(path.join(dir, 'secret.key')), key, 'same key on reload');
    const blob = encrypt(key, 'hunter2-ü');
    assert.notEqual(encrypt(key, 'hunter2-ü'), blob, 'random IV every time');
    assert.equal(decrypt(key, blob), 'hunter2-ü');
    const raw = Buffer.from(blob.slice(3), 'base64');
    raw[raw.length - 1] ^= 1;
    assert.throws(() => decrypt(key, `v1:${raw.toString('base64')}`), 'tampering detected');
    assert.throws(() => decrypt(Buffer.alloc(32, 7), blob), 'wrong key rejected');
});

test('app database: migrations apply once and reopen cleanly', () => {
    const { dir, app } = setup();
    assert.equal((app.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 6);
    app.close();
    const again = new AppDb(path.join(dir, 'app.sqlite'));
    assert.equal((again.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 6);
});

test('login: right/wrong passphrase, unknown user, rate limit, logout, sign out everywhere', async () => {
    const { auth } = setup();
    assert.equal(auth.hasUsers(), false);
    await auth.createUser('owner', 'correct horse battery');
    assert.equal(auth.hasUsers(), true);

    assert.equal(await auth.login('owner', 'wrong passphrase', 'ip1'), null);
    assert.equal(await auth.login('nobody', 'correct horse battery', 'ip1'), null);
    const ok = await auth.login('OWNER', 'correct horse battery', 'ip1'); // identifier is case-insensitive
    assert.ok(ok);
    assert.equal(auth.session(ok.token)?.identifier, 'owner');
    assert.equal(auth.session('forged-token'), null);

    const second = await auth.login('owner', 'correct horse battery', 'ip2');
    auth.logout(ok.token);
    assert.equal(auth.session(ok.token), null);
    assert.ok(auth.session(second!.token));
    assert.equal(auth.logoutAll(second!.user.id), 1);
    assert.equal(auth.session(second!.token), null);

    for (let i = 0; i < 20; i++) await auth.login('owner', 'nope', 'attacker');
    await assert.rejects(auth.login('owner', 'correct horse battery', 'attacker'), RateLimited);
    assert.ok(await auth.login('owner', 'correct horse battery', 'someone-else'), 'other clients unaffected');
});

test('sessions expire after 30 idle days and slide forward while used', async () => {
    let now = Date.parse('2026-10-13T12:00:00Z');
    const { auth } = setup(() => now);
    await auth.createUser('owner', 'correct horse battery');
    const s = (await auth.login('owner', 'correct horse battery', 'ip'))!;
    now += 20 * 86_400_000;
    assert.ok(auth.session(s.token), 'used on day 20: extended');
    now += 25 * 86_400_000;
    assert.ok(auth.session(s.token), 'day 45 is 25 days after last use');
    now += 31 * 86_400_000;
    assert.equal(auth.session(s.token), null, '31 idle days: expired');
});

test('a session that is extended says so, so the browser cookie is extended too', async () => {
    let now = Date.parse('2026-10-13T12:00:00Z');
    const { auth } = setup(() => now);
    await auth.createUser('owner', 'correct horse battery');
    const s = (await auth.login('owner', 'correct horse battery', 'ip'))!;
    let renewed = 0;
    now += 10 * 60_000;
    assert.ok(auth.session(s.token, () => renewed++));
    assert.equal(renewed, 0, 'used 10 minutes after login: nothing to extend yet');
    now += 2 * 3_600_000;
    assert.ok(auth.session(s.token, () => renewed++));
    assert.equal(renewed, 1, 'used two hours later: extended once');
    assert.ok(auth.session(s.token, () => renewed++));
    assert.equal(renewed, 1, 'not again within the hour');
    now += 31 * 86_400_000;
    assert.equal(auth.session(s.token, () => renewed++), null);
    assert.equal(renewed, 1, 'an expired session is not extended');
});

test('accounts: passwords are encrypted at rest and never returned to the UI', () => {
    const { dir, accounts } = setup();
    accounts.create({
        email: 'me@example.com', displayName: 'Me',
        imap: { host: 'mail.example.com', port: 993, secure: true, user: 'me@example.com', pass: 'imap-Secret-123' },
        smtp: { host: 'mail.example.com', port: 465, secure: true, user: 'me@example.com', pass: 'smtp-Secret-456' },
    });
    const listed = accounts.list();
    assert.equal(listed.length, 1);
    assert.ok(!JSON.stringify(listed).includes('Secret'), 'no password in what the UI sees');
    assert.equal(accounts.imapConfigs()[0].pass, 'imap-Secret-123');
    assert.equal(accounts.smtpConfig(listed[0].id)?.pass, 'smtp-Secret-456');
    const bytes = dbBytes(dir);
    assert.ok(!bytes.includes('imap-Secret-123') && !bytes.includes('smtp-Secret-456'), 'no plaintext password in the database files');
});

test('import from the old app: login keeps working, ids kept, buckets and rules mapped, idempotent', async () => {
    const oldPath = path.join(tmp(), 'old.sqlite');
    const old = new DatabaseSync(oldPath);
    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, created_at TEXT NOT NULL);
        CREATE TABLE email_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email_address TEXT NOT NULL, imap_host TEXT NOT NULL,
            imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL, imap_user TEXT NOT NULL, imap_password TEXT NOT NULL,
            smtp_host TEXT, smtp_port INTEGER, smtp_secure INTEGER, smtp_user TEXT, smtp_password TEXT, sync_settings TEXT,
            created_at TEXT NOT NULL, default_inbox_view TEXT DEFAULT 'expand');
        CREATE TABLE buckets (id TEXT PRIMARY KEY, label TEXT NOT NULL, color TEXT NOT NULL, count INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0, email_account_id TEXT, emoji TEXT, show_badge INTEGER DEFAULT 0);
        CREATE TABLE email_rules (id TEXT PRIMARY KEY, sender_pattern TEXT NOT NULL, bucket_id TEXT NOT NULL, created_at TEXT NOT NULL, email_account_id TEXT);`);
    old.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('u1', 'me@example.com', bcrypt.hashSync('old passphrase!', 4), '2025-01-01');
    old.prepare(`INSERT INTO email_accounts VALUES ('acct-A', 'u1', 'a@example.com', 'mail.example.com', 993, 1, 'a@example.com', 'pw-A-plain',
        'mail.example.com', 465, 1, 'a@example.com', 'pw-A-smtp', '{"displayName":"Ada","startDate":"2026-02-01T05:00:00.000Z"}', '2025-01-01', 'thread')`).run();
    old.prepare(`INSERT INTO buckets VALUES ('$bucket_1', 'Reads', '#8b5cf6', 23, 3, 'acct-A', '📖', 0),
        ('bucket_2', 'Re.Tech', '#f59e0b', 7, 4, 'acct-A', NULL, 1),
        ('$forwarded', 'Forwarded', '#000', 11990, 1, NULL, NULL, 0)`).run();
    old.prepare(`INSERT INTO email_rules VALUES ('r1', 'news@example.com', 'bucket_2', '2025-02-02', 'acct-A')`).run();
    old.close();

    const { dir, app, auth, accounts } = setup();
    const summary = importFromOldApp(app, accounts, auth, oldPath);
    assert.deepEqual(summary, { skipped: false, users: 1, accounts: 1, buckets: 2, rules: 1 });
    assert.ok(await auth.login('me@example.com', 'old passphrase!', 'ip'), 'the old login still works');
    assert.deepEqual(accounts.list().map(a => [a.id, a.email, a.displayName, a.inboxView]), [['acct-A', 'a@example.com', 'Ada', 'thread']]);
    assert.deepEqual(app.db.prepare('SELECT name, color, emoji, sort_order, show_badge FROM bucket_meta ORDER BY sort_order').all().map(r => ({ ...r })), [
        { name: 'Reads', color: '#8b5cf6', emoji: '📖', sort_order: 3, show_badge: 0 },
        { name: 'Re-Tech', color: '#f59e0b', emoji: null, sort_order: 4, show_badge: 1 }, // "." is the folder delimiter
    ]);
    assert.deepEqual(app.db.prepare('SELECT sender_pattern, bucket FROM rules').all().map(r => ({ ...r })), [{ sender_pattern: 'news@example.com', bucket: 'Re-Tech' }]);
    assert.ok(!dbBytes(dir).includes('pw-A-plain'), 'imported passwords are encrypted');
    assert.equal(importFromOldApp(app, accounts, auth, oldPath).skipped, true, 'second run does nothing');
});

test('recovery: setting a passphrase on the machine replaces the old one and signs out every session', async () => {
    const { auth } = setup();
    await auth.createUser('owner', 'forgotten passphrase');
    const session = (await auth.login('owner', 'forgotten passphrase', 'ip'))!;
    assert.equal(await auth.setPassphrase('owner', 'brand new passphrase'), 'updated');
    assert.equal(auth.session(session.token), null, 'old sessions signed out');
    assert.equal(await auth.login('owner', 'forgotten passphrase', 'ip'), null);
    assert.ok(await auth.login('owner', 'brand new passphrase', 'ip'));
    await assert.rejects(auth.setPassphrase('owner', 'short'), /at least 8/);
    assert.equal(await auth.setPassphrase('second-user', 'another passphrase'), 'created');
});
