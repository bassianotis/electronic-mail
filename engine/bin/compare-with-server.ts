// Does what the app shows match the mail server? An independent check.
//
// Reads every folder of every account straight from the server (read-only: EXAMINE and
// BODY.PEEK, so not even a read flag changes), groups the conversations itself from the
// headers, and compares with what the app has and shows:
//   1. every message on the server is in the app, in the same folder; nothing missing or extra;
//   2. conversations: messages that reply to each other are together, nothing else is;
//   3. each conversation is listed in the folder of its newest received message;
//   4. every count (conversations, unread) equals a recount from the server.
// It shares no logic with the engine. Only the conventions are the same: message ids are
// <local@domain> tokens (RFC 5322), a message without one is known by a hash of its header
// block, and a conversation's place is its newest received message (Inbox before buckets before
// Archive when that message is in several).
//
//   node bin/compare-with-server.ts <data-dir> [report.json]
// It reads <data-dir>/app.sqlite + secret.key (where to connect) and cache.sqlite (what the app
// has); it writes nothing there.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ImapFlow } from 'imapflow';
import { decrypt, loadOrCreateKey } from '../src/app/secrets.ts';

const ID = /<([^<>\s]+@[^<>\s]+)>/g;
const ids = (raw: string | Buffer | null | undefined) => (raw ? [...String(raw).matchAll(ID)].map(m => m[1]) : []);
const LOCATION_ROLES = new Set(['inbox', 'bucket', 'archive', 'other']);
const PRIORITY = ['inbox', 'bucket', 'archive', 'other'];

const [dataDirArg, reportArg] = process.argv.slice(2);
if (!dataDirArg) {
    console.error('usage: node bin/compare-with-server.ts <data-dir> [report.json]');
    process.exit(2);
}
const dataDir = path.resolve(dataDirArg);
for (const f of ['app.sqlite', 'secret.key', 'cache.sqlite']) {
    if (!fs.existsSync(path.join(dataDir, f))) throw new Error(`${f} not found in ${dataDir}`);
}

interface ServerMessage {
    folder: string;
    uid: number;
    identity: string;
    refs: string[];
    date: string;
    seen: boolean;
    subject: string;
}

/** Everything in every folder, read without changing anything. */
async function readServer(cfg: { host: string; port: number; secure: boolean; user: string; pass: string }) {
    const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
    client.on('error', () => {});
    await client.connect();
    const messages: ServerMessage[] = [];
    const folders: string[] = [];
    try {
        for (const box of await client.list()) {
            if (box.flags.has('\\Noselect') || box.flags.has('\\NonExistent')) continue;
            folders.push(box.path);
            const lock = await client.getMailboxLock(box.path, { readOnly: true }); // EXAMINE
            try {
                const mailbox = client.mailbox;
                if (!mailbox || !mailbox.exists) continue;
                const noId: number[] = [];
                const here = new Map<number, ServerMessage>();
                for await (const m of client.fetch('1:*', { uid: true, envelope: true, internalDate: true, flags: true, headers: ['references'] })) {
                    const messageId = ids(m.envelope?.messageId)[0] ?? null;
                    // Some real mail has a Date header that can't be read (it then arrives as text): use the arrival time.
                    const written = m.envelope?.date ? new Date(m.envelope.date as unknown as string) : null;
                    const date = written && !isNaN(written.getTime()) ? written : m.internalDate;
                    const msg: ServerMessage = {
                        folder: box.path, uid: m.uid,
                        identity: messageId ?? '',
                        refs: [...ids(m.envelope?.inReplyTo), ...ids(m.headers)],
                        date: date ? new Date(date).toISOString() : '',
                        seen: m.flags?.has('\\Seen') ?? false,
                        subject: m.envelope?.subject ?? '',
                    };
                    if (!messageId) noId.push(m.uid);
                    here.set(m.uid, msg);
                }
                if (noId.length) {
                    for await (const m of client.fetch(noId.join(','), { uid: true, headers: true }, { uid: true })) {
                        here.get(m.uid)!.identity = `hash:${crypto.createHash('sha1').update(m.headers ?? Buffer.alloc(0)).digest('hex')}`;
                    }
                }
                messages.push(...here.values());
            } finally {
                lock.release();
            }
        }
    } finally {
        await client.logout().catch(() => client.close());
    }
    return { folders, messages };
}

/** Union-find over message ids: messages that reply to each other, even through a missing message. */
function groupConversations(messages: ServerMessage[]): Map<string, string> {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
        let root = x;
        while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
        let node = x;
        while (node !== root) { const next = parent.get(node)!; parent.set(node, root); node = next; }
        if (!parent.has(root)) parent.set(root, root);
        return root;
    };
    const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (const m of messages) {
        find(m.identity);
        for (const r of m.refs) union(m.identity, r);
    }
    return new Map(messages.map(m => [m.identity, find(m.identity)]));
}

interface Row { folder: string; role: string; serverMsgs: number; appMsgs: number; appConvs: number; recountConvs: number; appUnread: number; recountUnread: number }

async function checkAccount(account: { id: string; email: string; host: string; port: number; secure: boolean; user: string; pass: string }, cache: DatabaseSync) {
    const started = Date.now();
    const server = await readServer(account);
    const readMs = Date.now() - started;

    // What the app has: its copy of where each message is, and the conversations it lists.
    const roles = new Map((cache.prepare('SELECT path, role FROM folder WHERE account = ?').all(account.id) as { path: string; role: string }[]).map(r => [r.path, r.role]));
    const appPlacements = cache.prepare(`SELECT p.folder, p.uid, p.msg_key AS key, m.thread_id AS thread FROM placement p
        JOIN message m ON m.account = p.account AND m.msg_key = p.msg_key WHERE p.account = ?`).all(account.id) as { folder: string; uid: number; key: string; thread: string }[];
    const appThreads = cache.prepare('SELECT thread_id AS id, location, unread FROM thread WHERE account = ?').all(account.id) as { id: string; location: string | null; unread: number }[];
    const pendingTasks = (cache.prepare(`SELECT COUNT(*) AS n FROM task WHERE account = ? AND status = 'pending'`).get(account.id) as { n: number }).n;

    // 1. Same messages in the same folders
    const appAt = new Map(appPlacements.map(p => [`${p.folder}\u0000${p.uid}`, p]));
    const serverAt = new Map(server.messages.map(m => [`${m.folder}\u0000${m.uid}`, m]));
    const missing = server.messages.filter(m => !appAt.has(`${m.folder}\u0000${m.uid}`));
    const extra = appPlacements.filter(p => !serverAt.has(`${p.folder}\u0000${p.uid}`));
    const mismatched = server.messages.filter(m => {
        const p = appAt.get(`${m.folder}\u0000${m.uid}`);
        return p && !m.identity.startsWith('hash:') && p.key !== m.identity;
    });
    const unknownFolders = server.folders.filter(f => !roles.has(f));

    // 2. Conversations, recounted from the headers
    const groupOf = groupConversations(server.messages);
    const threadOfPlacement = (m: ServerMessage) => appAt.get(`${m.folder}\u0000${m.uid}`)?.thread;
    const appThreadsOfGroup = new Map<string, Set<string>>();
    const groupsOfAppThread = new Map<string, Set<string>>();
    for (const m of server.messages) {
        const g = groupOf.get(m.identity)!;
        const t = threadOfPlacement(m);
        if (!t) continue;
        if (!appThreadsOfGroup.has(g)) appThreadsOfGroup.set(g, new Set());
        appThreadsOfGroup.get(g)!.add(t);
        if (!groupsOfAppThread.has(t)) groupsOfAppThread.set(t, new Set());
        groupsOfAppThread.get(t)!.add(g);
    }
    const splitByApp = [...appThreadsOfGroup].filter(([, ts]) => ts.size > 1);
    const joinedByApp = [...groupsOfAppThread].filter(([, gs]) => gs.size > 1);

    // 3 + 4. Where each conversation lives, and the counts
    const byGroup = new Map<string, ServerMessage[]>();
    for (const m of server.messages) {
        const g = groupOf.get(m.identity)!;
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(m);
    }
    const recount = new Map<string, { convs: number; unread: number }>();
    const wrongPlace: { subject: string; server: string; app: string | null }[] = [];
    const splitAcrossFolders: { subject: string; folders: string[] }[] = [];
    for (const [g, members] of byGroup) {
        const received = members.filter(m => LOCATION_ROLES.has(roles.get(m.folder) ?? 'other'));
        if (!received.length) continue;
        // newest received message (date, then identity, like the app); among its copies, the
        // Inbox before a bucket before the Archive
        const newest = [...received].sort((a, b) => (b.date.localeCompare(a.date)) || (b.identity < a.identity ? -1 : b.identity > a.identity ? 1 : 0))[0];
        const place = received.filter(m => m.identity === newest.identity)
            .sort((a, b) => PRIORITY.indexOf(roles.get(a.folder) ?? 'other') - PRIORITY.indexOf(roles.get(b.folder) ?? 'other') || a.folder.localeCompare(b.folder))[0].folder;
        const unread = received.some(m => !m.seen);
        const r = recount.get(place) ?? { convs: 0, unread: 0 };
        r.convs++;
        if (unread) r.unread++;
        recount.set(place, r);
        const appThreadIds = [...(appThreadsOfGroup.get(g) ?? [])];
        if (appThreadIds.length === 1) {
            const t = appThreads.find(x => x.id === appThreadIds[0]);
            if (t && t.location !== place) wrongPlace.push({ subject: newest.subject, server: place, app: t.location });
        }
        const folders = [...new Set(received.map(m => m.folder))];
        if (folders.length > 1) splitAcrossFolders.push({ subject: newest.subject, folders });
    }
    const appCounts = new Map<string, { convs: number; unread: number }>();
    for (const t of appThreads) {
        if (!t.location) continue;
        const c = appCounts.get(t.location) ?? { convs: 0, unread: 0 };
        c.convs++;
        if (t.unread > 0) c.unread++;
        appCounts.set(t.location, c);
    }
    const rows: Row[] = server.folders.map(folder => ({
        folder,
        role: roles.get(folder) ?? '?',
        serverMsgs: server.messages.filter(m => m.folder === folder).length,
        appMsgs: appPlacements.filter(p => p.folder === folder).length,
        appConvs: appCounts.get(folder)?.convs ?? 0,
        recountConvs: recount.get(folder)?.convs ?? 0,
        appUnread: appCounts.get(folder)?.unread ?? 0,
        recountUnread: recount.get(folder)?.unread ?? 0,
    }));
    const countsDiffer = rows.filter(r => r.appConvs !== r.recountConvs || r.appUnread !== r.recountUnread);
    const conversations = [...byGroup.values()].filter(ms => ms.some(m => LOCATION_ROLES.has(roles.get(m.folder) ?? 'other'))).length;
    return {
        account: account.email, readMs, pendingTasks,
        messagesOnServer: server.messages.length, conversations, rows,
        missing: missing.map(m => ({ folder: m.folder, uid: m.uid, subject: m.subject })),
        extra: extra.map(p => ({ folder: p.folder, uid: p.uid, key: p.key })),
        mismatched: mismatched.map(m => ({ folder: m.folder, uid: m.uid, server: m.identity, app: appAt.get(`${m.folder}\u0000${m.uid}`)?.key })),
        unknownFolders,
        splitByApp: splitByApp.map(([g, ts]) => ({ group: g, appThreads: [...ts] })),
        joinedByApp: joinedByApp.map(([t, gs]) => ({ thread: t, groups: [...gs] })),
        wrongPlace, countsDiffer, splitAcrossFolders,
    };
}

// Where to connect, read without opening the app database for writing.
const key = loadOrCreateKey(path.join(dataDir, 'secret.key')); // exists (checked above): only read
const appDb = new DatabaseSync(path.join(dataDir, 'app.sqlite'), { readOnly: true });
const accounts = (appDb.prepare('SELECT id, email, imap_host, imap_port, imap_secure, imap_user, imap_pass FROM accounts ORDER BY sort_order, email').all() as
    { id: string; email: string; imap_host: string; imap_port: number; imap_secure: number; imap_user: string; imap_pass: string }[])
    .map(a => ({ id: a.id, email: a.email, host: a.imap_host, port: a.imap_port, secure: !!a.imap_secure, user: a.imap_user, pass: decrypt(key, a.imap_pass) }));
appDb.close();
const cache = new DatabaseSync(path.join(dataDir, 'cache.sqlite'), { readOnly: true });

const results = [];
for (const account of accounts) {
    const r = await checkAccount(account, cache);
    results.push(r);
    const ok = (b: boolean) => (b ? '✓' : '✗');
    console.log(`\n${r.account}  (${account.host}:${account.port}, read-only; ${r.messagesOnServer} messages read in ${(r.readMs / 1000).toFixed(1)} s)`);
    console.log('  folder                                   role     server  app   conversations app/recount   unread app/recount');
    for (const row of r.rows) {
        const shows = LOCATION_ROLES.has(row.role);
        console.log(`  ${row.folder.padEnd(40)} ${row.role.padEnd(8)} ${String(row.serverMsgs).padStart(6)} ${String(row.appMsgs).padStart(5)}   ${shows ? `${row.appConvs}/${row.recountConvs}`.padStart(13) : '            -'}   ${shows ? `${row.appUnread}/${row.recountUnread}`.padStart(16) : '               -'}`);
    }
    console.log(`  ${ok(!r.missing.length && !r.extra.length && !r.mismatched.length)} messages: ${r.missing.length} on the server but not in the app, ${r.extra.length} in the app but not on the server, ${r.mismatched.length} mixed up`);
    console.log(`  ${ok(!r.splitByApp.length && !r.joinedByApp.length)} conversations (${r.conversations}): ${r.splitByApp.length} split apart by the app, ${r.joinedByApp.length} wrongly joined`);
    console.log(`  ${ok(!r.wrongPlace.length)} places: ${r.wrongPlace.length} listed somewhere other than their newest received message`);
    console.log(`  ${ok(!r.countsDiffer.length)} counts: ${r.countsDiffer.length} folders where the app's numbers differ from the recount`);
    if (r.unknownFolders.length) console.log(`  ✗ folders the app doesn't know: ${r.unknownFolders.join(', ')}`);
    if (r.pendingTasks) console.log(`  (${r.pendingTasks} moves still on their way to the server; a difference they cause is temporary)`);
    console.log(`  note: ${r.splitAcrossFolders.length} conversations have received mail in more than one folder (e.g. a new reply arrived in the Inbox while earlier mail stayed in a bucket)`);
}
cache.close();
if (reportArg) {
    fs.writeFileSync(reportArg, JSON.stringify({ at: new Date().toISOString(), results }, null, 2), { mode: 0o600 });
    console.log(`\nfull report: ${reportArg}`);
}
