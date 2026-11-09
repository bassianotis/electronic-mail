// Runs the engine: the app layer, one live worker per account, and the HTTP API.
//   node bin/server.ts
// Environment:
//   DATA_DIR        where app.sqlite (durable), secret.key and cache.sqlite live (default engine/data).
//                   Back up app.sqlite together with secret.key; cache.sqlite is disposable.
//   OLD_APP_DB      the first Electronic Mail's database (server/database.sqlite), imported on a first start
//   HOST, PORT      where the API listens (default 127.0.0.1:3100 — not reachable from other machines)
//   AUTH=off        no login (local development only)
//   AUTH_MODE=door  the shared Bassapps sign-in (the bassapps repo) instead of the engine's own login:
//     DOOR_INTERNAL_URL  where the sign-in service listens (default http://127.0.0.1:3102)
//     DOOR_PUBLIC_URL    its address as browsers see it (default http://localhost:5175)
//     DOOR_SECRET_FILE   its internal.key (the secret both share)
//     APP_ID             this app's id in its DOOR_APPS (default mail)
//     MAIL_USERS         the Bassapps logins this Mail belongs to, comma-separated (required): any
//                        other login is refused, whatever the sign-in service allows
//     NOTIFY_ACCOUNT     the account notices go to and come from (default: the first)
//   STATIC_DIR      the built screens (dist): served by the engine itself, in production
//   SECURE_COOKIES=1  mark the session cookie Secure (when served over HTTPS)
//   SESSION_COOKIE  the session cookie's name (default em_session); a second engine on the same
//                   machine needs its own, as browsers share cookies across ports
//   READ_ONLY=1     refuse every change; syncing only ever reads
//   VIEWER=1        serve the read-only preview page at / (implies READ_ONLY)
//   ACCOUNTS_FILE   JSON list of accounts to use instead of the app database (previews of copies)
//   PREVIEW_LABEL   text the preview page shows about what it is looking at
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { Store } from '../src/store/store.ts';
import { AccountWorker } from '../src/worker/accountWorker.ts';
import { createApiServer } from '../src/api/server.ts';
import { AppDb } from '../src/app/appDb.ts';
import { Auth } from '../src/app/auth.ts';
import { Accounts } from '../src/app/accounts.ts';
import { Buckets } from '../src/app/buckets.ts';
import { Rules } from '../src/app/rules.ts';
import { Outbox, saveCopyWith } from '../src/app/outbox.ts';
import { Uploads } from '../src/app/uploads.ts';
import { Drafts } from '../src/app/drafts.ts';
import { AccountManager } from '../src/app/manager.ts';
import { loadOrCreateKey } from '../src/app/secrets.ts';
import { importFromOldApp } from '../src/app/importOld.ts';
import { DoorClient } from '../src/app/doorClient.ts';
import { NoticeIds } from '../src/app/notices.ts';
import type { AccountConfig } from '../src/types.ts';

const dataDir = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, '../data');
const oldAppDb = process.env.OLD_APP_DB;
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3100);
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const viewer = process.env.VIEWER === '1';
const doorMode = process.env.AUTH_MODE === 'door';
const owners = (process.env.MAIL_USERS ?? '').split(',').map(u => u.trim()).filter(Boolean);
if (doorMode && !owners.length) {
    console.error('AUTH_MODE=door needs MAIL_USERS: the Bassapps login(s) this Mail belongs to');
    process.exit(1);
}
const readOnly = viewer || process.env.READ_ONLY === '1';
const previewAccounts = process.env.ACCOUNTS_FILE;

fs.mkdirSync(dataDir, { recursive: true });
const store = new Store(process.env.ENGINE_DB ?? path.join(dataDir, 'cache.sqlite'));

let app: AppDb | undefined;
let accounts: Accounts | undefined;
let auth: Auth | undefined;
let notices: NoticeIds | undefined;
let configs: AccountConfig[];
if (previewAccounts) {
    configs = JSON.parse(fs.readFileSync(previewAccounts, 'utf8'));
} else {
    app = new AppDb(path.join(dataDir, 'app.sqlite'));
    const secretKey = loadOrCreateKey(path.join(dataDir, 'secret.key'));
    accounts = new Accounts(app, secretKey);
    notices = new NoticeIds(secretKey);
    auth = process.env.AUTH === 'off' || doorMode ? undefined : new Auth(app);
    if (!accounts.list().length && oldAppDb && fs.existsSync(oldAppDb)) {
        const imported = importFromOldApp(app, accounts, auth ?? new Auth(app), oldAppDb);
        if (!imported.skipped) log(`imported from the old app: ${imported.users} login(s), ${imported.accounts} account(s), ${imported.buckets} bucket look(s), ${imported.rules} rule(s)`);
    }
    configs = accounts.imapConfigs();
    if (!auth && !doorMode) log('WARNING: AUTH=off — anyone who can reach this port can read your mail');
}

const rules = app ? new Rules(app) : undefined;
const buckets = app ? new Buckets(app, store) : undefined;
let outbox: Outbox | undefined;
const manager = new AccountManager({
    store, accounts, rules, buckets, readOnly, log,
    workerOptions: notices && { isOwnNotice: id => notices!.isOwn(id) },
    onForget: id => outbox?.forgetAccount(id),
});
manager.on('status', s => log(`[${configs.find(c => c.id === s.account)?.email ?? s.account}] ${s.state}${s.error ? `: ${s.error}` : ''}`));
manager.start(configs);
const workers = manager.workers;

const uploads = app ? new Uploads(path.join(dataDir, 'uploads')) : undefined;
uploads?.cleanup();
const drafts = uploads ? new Drafts(store, uploads) : undefined;
outbox = app && accounts ? new Outbox({
    app, accounts, uploads, log,
    dir: path.join(dataDir, 'outbox'),
    saveCopy: saveCopyWith(store, workers),
    // A message written as a draft: remove the draft only once the sent copy is safely saved.
    afterSaved: async item => {
        const w = workers.get(item.accountId);
        if (item.draftKey && w && drafts) await drafts.removeAllVersions(w, item.accountId, item.draftKey);
    },
}) : undefined;
if (!readOnly) outbox?.start();

// The shared sign-in: Mail checks its cookie with the sign-in service, which shares a secret with it
const doorSecret = doorMode ? fs.readFileSync(process.env.DOOR_SECRET_FILE ?? path.join(dataDir, 'door-internal.key'), 'utf8').trim() : undefined;
const door = doorMode ? new DoorClient({
    internalUrl: process.env.DOOR_INTERNAL_URL ?? 'http://127.0.0.1:3102',
    publicUrl: process.env.DOOR_PUBLIC_URL ?? 'http://localhost:5175',
    secret: doorSecret!,
    app: process.env.APP_ID ?? 'mail',
    owners,
}) : undefined;

/** A short plain-text notice to the person, from and to their own account (the new sign-in email).
 * Its Message-ID marks it as the app's own, so no sender rule files it: it lands in the Inbox. */
const notify = accounts ? async ({ subject, text, fromName }: { subject: string; text: string; fromName: string }) => {
    const list = accounts!.list();
    const account = list.find(a => a.email.toLowerCase() === process.env.NOTIFY_ACCOUNT?.toLowerCase()) ?? list[0];
    const smtp = account && accounts!.smtpConfig(account.id);
    if (!account || !smtp) throw new Error('no account with sending set up');
    await nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: { user: smtp.user, pass: smtp.pass } })
        .sendMail({ from: { name: fromName, address: account.email }, to: account.email, subject, text, messageId: notices!.make(account.email) });
    log(`notice sent to ${account.email}: ${subject}`);
} : undefined;

const server = createApiServer({
    store, workers, log, readOnly, auth, accounts, door, internalSecret: doorSecret, notify,
    buckets, rules, outbox, uploads, drafts, manager, app,
    secureCookies: process.env.SECURE_COOKIES === '1',
    cookieName: process.env.SESSION_COOKIE,
    viewerDir: viewer ? path.resolve(import.meta.dirname, '../viewer') : undefined,
    staticDir: process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : undefined,
    label: process.env.PREVIEW_LABEL,
});
server.listen(port, host, () => log(`engine ${readOnly ? '(READ-ONLY) ' : ''}on http://${host}:${port} for ${workers.size} account(s)${auth ? ', login required' : door ? `, Bassapps sign-in at ${door.publicUrl}` : ''}`));

let stopping = false;
async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    log(`${signal}: shutting down`);
    server.close();
    server.closeAllConnections();
    await outbox?.stop();
    await manager.stopAll();
    store.close();
    app?.close();
    process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
