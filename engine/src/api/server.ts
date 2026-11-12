// HTTP API for the React UI. JSON over plain node:http, plus a Server-Sent Events stream.
// Change notification follows JMAP (RFC 8620 §7.3): every response carries the account's
// opaque `state`; the event stream pushes the new state whenever it changes, and the UI
// re-fetches what it shows. Binds to 127.0.0.1 unless told otherwise.
// Security (OWASP): with an Auth, every route except login/status needs a session cookie
// (HttpOnly, SameSite=Strict); every state-changing request must be JSON and same-origin.
import crypto from 'node:crypto';
import http from 'node:http';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Store } from '../store/store.ts';
import type { AccountWorker, AccountStatus, ChangedEvent } from '../worker/accountWorker.ts';
import { folderList, folderView, sentView, threadDetail } from '../views/views.ts';
import { enqueueMoveThread, enqueueSetSeen, enqueueUndo, getTask, TaskError } from '../tasks/tasks.ts';
import { getBody, NotFound, openAttachment } from '../bodies/bodies.ts';
import { RateLimited, type Auth, type SessionUser } from '../app/auth.ts';
import { DoorUnreachable, NotOwner, type DoorClient } from '../app/doorClient.ts';
import type { Accounts } from '../app/accounts.ts';
import { BucketError, type Buckets } from '../app/buckets.ts';
import { countOld, markSeen, MAX_DAYS, sweepNotice, undoSweeps } from '../app/autoArchive.ts';
import { RuleError, type Rules } from '../app/rules.ts';
import { buildMessage, ComposeError, threadingFor, threadingFromHeaders, type Address, type OutgoingAttachment } from '../app/compose.ts';
import { OutboxError, type Outbox } from '../app/outbox.ts';
import { suggestContacts } from '../app/contacts.ts';
import { MAX_UPLOAD_BYTES, UploadError, type Uploads } from '../app/uploads.ts';
import type { Drafts } from '../app/drafts.ts';
import { search } from '../search/search.ts';
import { AccountError, testConnection, type AccountManager, type ServerChange } from '../app/manager.ts';
import { exportSettings, importSettings, SettingsError } from '../app/settings.ts';
import { SIGNATURE_MAX, TAB_NAME_MAX, type AccountInput } from '../app/accounts.ts';
import { discoverServers, type FoundServers } from '../app/discover.ts';

export interface ApiContext {
    store: Store;
    workers: Map<string, AccountWorker>;
    log?: (msg: string) => void;
    /** Refuse every request that would change the mailbox (moves, read state, undo). */
    readOnly?: boolean;
    /** Serve the read-only preview page (engine/viewer) at "/". */
    viewerDir?: string;
    /** The built screens (dist), served at every path that isn't the API: production. (In
     * development, Vite serves them.) */
    staticDir?: string;
    /** Shown by the preview page, e.g. "Copy of your mailbox after migration". */
    label?: string;
    /** Login and sessions. Without it the API is open (tests, local previews). */
    auth?: Auth;
    /** Bassapps sign-in (the bassapps repo), in place of `auth`: one sign-in shared by Mail and Tasks. */
    door?: DoorClient;
    /** What the sign-in service sends (X-Door-Secret) to /internal: only it may ask for a notice. */
    internalSecret?: string;
    /** Sends the person a short plain-text notice from their own account (the new sign-in email). */
    notify?: (notice: { subject: string; text: string; fromName: string }) => Promise<void>;
    /** The app's own database (settings export/import). */
    app?: import('../app/appDb.ts').AppDb;
    accounts?: Accounts;
    buckets?: Buckets;
    rules?: Rules;
    outbox?: Outbox;
    uploads?: Uploads;
    drafts?: Drafts;
    /** Adds/removes accounts while running; its events feed the event stream. */
    manager?: AccountManager;
    /** Finds an address's servers (default: app/discover.ts, over DNS); tests pass their own. */
    discover?: (email: string) => Promise<FoundServers | null>;
    /** Add the Secure flag to the session cookie (set when served over HTTPS). */
    secureCookies?: boolean;
    /**
     * The session cookie's name (default em_session). Two engines on one machine need different
     * names: a browser shares cookies across ports, so logging in to one would log out the other.
     */
    cookieName?: string;
}

const PUBLIC_PATHS = new Set(['/api/v2/health', '/api/v2/auth/status', '/api/v2/auth/login', '/api/v2/auth/setup', '/api/v2/auth/begin', '/api/v2/auth/callback']);
/**
 * The built screens' content policy (production). Mail bodies render in a sandboxed frame with
 * their own, stricter policy; a srcdoc frame also inherits this one, so it allows what a loaded
 * email may show (outside images and fonts, once "Load images" is pressed) and the frame's one
 * script, public/mail-frame.js, from here (no inline script runs anywhere).
 */
const APP_POLICY = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https: http:",
    "font-src 'self' data: https: http:", "connect-src 'self'", "frame-src 'self' about: blob:", "media-src 'none'", "object-src 'none'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
const STATIC_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};
/** Open only on first run, before any login exists: the setup wizard tries the mail server first. */
const FIRST_RUN_PATHS = new Set(['/api/v2/accounts/test']);
/** Writes that carry raw bytes instead of JSON; they must send this header instead (forms cannot). */
const RAW_WRITE_PATHS = new Set(['/api/v2/uploads']);
const RAW_WRITE_HEADER = 'electronic-mail';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
/** With the shared sign-in, the sign-in service decides when a session ends; the cookie just lasts. */
const APP_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;
/** Up next shows every conversation in a bucket on home; this only guards against a runaway answer. */
const HOME_MAX_THREADS = 5000;

class HttpError extends Error {
    readonly status: number;
    /** Why someone is signed out (401 with the shared sign-in): the screen says which. */
    readonly reason?: string;
    constructor(status: number, message: string, reason?: string) {
        super(message);
        this.status = status;
        this.reason = reason;
    }
}

/** Only the sign-in service has the secret for /internal. */
const secretMatches = (given: unknown, secret: string) => {
    const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
    const b = crypto.createHash('sha256').update(secret).digest();
    return crypto.timingSafeEqual(a, b);
};

type Params = Record<string, string>;
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, params: Params, url: URL) => Promise<void> | void;

const MAX_JSON_BODY = 64 * 1024;
/** A message or draft carries its HTML, and a reply quotes the original's (pictures and all). */
const MAX_COMPOSE_BODY = 15 * 1024 * 1024;
/** Undo send holds a message this long at most. */
const MAX_HOLD_MS = 30_000;
const HEARTBEAT_MS = 25_000;

export function createApiServer(ctx: ApiContext): http.Server {
    const sessionCookie = ctx.cookieName ?? 'em_session';
    const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
    const route = (method: string, path: string, handler: Handler) => {
        const keys: string[] = [];
        const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k: string) => { keys.push(k); return '([^/]+)'; }) + '$');
        routes.push({ method, pattern, keys, handler });
    };
    const worker = (params: Params) => {
        const w = ctx.workers.get(params.account);
        if (!w) throw new HttpError(404, `unknown account ${params.account}`);
        return w;
    };
    const state = (params: Params) => worker(params).stateToken;
    const writable = () => {
        if (ctx.readOnly) throw new HttpError(403, 'read-only preview: nothing can be changed here');
    };

    const users = new WeakMap<http.IncomingMessage, SessionUser>();
    const userOf = (req: http.IncomingMessage) => {
        const u = users.get(req);
        if (!u) throw new HttpError(401, 'not logged in');
        return u;
    };
    const cookie = (value: string, maxAge: number) =>
        `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${ctx.secureCookies ? '; Secure' : ''}`;
    // The shared sign-in: a random state, kept here while the person signs in, must come back with the code
    const stateCookie = `${sessionCookie}_state`;
    const stateCookieValue = (value: string, maxAge: number) =>
        `${stateCookie}=${value}; Path=/api/v2/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${ctx.secureCookies ? '; Secure' : ''}`;
    // A path on this site only: browsers read "//x" and "/\x" as another site
    const sameSitePath = (value: string | null) => (value && /^\/(?![/\\])/.test(value) && !value.includes('\\') && ![...value].some(c => c < ' ') ? value.slice(0, 2000) : '/');
    const askDoor = async <T>(call: (door: DoorClient) => Promise<T>): Promise<T> => {
        try {
            return await call(ctx.door!);
        } catch (err) {
            if (err instanceof DoorUnreachable) throw new HttpError(503, err.message);
            throw err;
        }
    };
    /** When the server extends a session, the browser's cookie is extended with it. */
    const renewCookie = (req: http.IncomingMessage, res: http.ServerResponse) => () => {
        const token = readCookie(req, sessionCookie);
        if (token) res.setHeader('Set-Cookie', cookie(token, SESSION_MAX_AGE));
    };
    const buckets = () => {
        if (!ctx.buckets) throw new HttpError(404, 'buckets are not available');
        return ctx.buckets;
    };

    route('GET', '/api/v2/info', (_req, res) => {
        json(res, 200, { readOnly: !!ctx.readOnly, label: ctx.label ?? null });
    });

    // A health check for the server it runs on (and the ship script): no names, no addresses
    route('GET', '/api/v2/health', (_req, res) => {
        const states = [...ctx.workers.values()].map(w => w.status().state);
        json(res, 200, { ok: true, accounts: states.length, online: states.filter(s => s === 'online').length });
    });

    /** A built file, or the app's page for any other path (the screens route themselves). */
    const serveStatic = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
        const root = path.resolve(ctx.staticDir!);
        let wanted: string;
        try { wanted = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'bad path'); }
        const file = path.resolve(root, `.${wanted}`);
        const found = (file === root || file.startsWith(root + path.sep)) && fs.existsSync(file) && fs.statSync(file).isFile();
        // A missing file (an old asset after a ship, say) is a 404, not the app's page in its place
        if (!found && path.extname(wanted)) throw new HttpError(404, 'not found');
        const target = found ? file : path.join(root, 'index.html');
        const hashed = found && file.startsWith(path.join(root, 'assets') + path.sep);
        res.writeHead(200, {
            'Content-Type': STATIC_TYPES[path.extname(target)] ?? 'application/octet-stream',
            'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
            'Content-Security-Policy': APP_POLICY,
            'Referrer-Policy': 'no-referrer',
            'X-Frame-Options': 'DENY',
        });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(target).pipe(res);
    };

    // ---- login
    route('GET', '/api/v2/auth/status', async (req, res) => {
        if (ctx.door) {
            const v = await askDoor(door => door.verify(readCookie(req, sessionCookie)));
            const family = v.ok ? await askDoor(door => door.family()).catch(() => null) : null;
            json(res, 200, {
                enabled: true, mode: 'door', configured: true, authenticated: v.ok,
                user: v.ok ? { identifier: v.user.username } : null, reason: v.ok ? null : v.reason,
                // The apps menu lists only the apps this login may use
                family: family && v.ok && { apps: family.list.filter(a => v.apps.includes(a.id)), accountUrl: family.accountUrl, current: ctx.door.app },
            });
            return;
        }
        const user = ctx.auth?.session(readCookie(req, sessionCookie), renewCookie(req, res)) ?? null;
        json(res, 200, { enabled: !!ctx.auth, configured: ctx.auth?.hasUsers() ?? true, authenticated: !ctx.auth || !!user, user: user && { identifier: user.identifier } });
    });

    route('POST', '/api/v2/auth/login', async (req, res) => {
        if (!ctx.auth) throw new HttpError(404, 'login is not enabled');
        const { identifier, passphrase } = await readJson<{ identifier?: unknown; passphrase?: unknown }>(req);
        if (typeof identifier !== 'string' || typeof passphrase !== 'string') throw new HttpError(400, 'identifier and passphrase are required');
        const result = await ctx.auth.login(identifier, passphrase, req.socket.remoteAddress ?? 'unknown', req.headers['user-agent']);
        if (!result) throw new HttpError(401, 'wrong username or passphrase');
        res.setHeader('Set-Cookie', cookie(result.token, SESSION_MAX_AGE));
        json(res, 200, { user: { identifier: result.user.identifier } });
    });

    // First run only: create the login. Refused as soon as any login exists.
    route('POST', '/api/v2/auth/setup', async (req, res) => {
        if (!ctx.auth) throw new HttpError(404, 'login is not enabled');
        if (ctx.auth.hasUsers()) throw new HttpError(409, 'a login already exists');
        const { identifier, passphrase } = await readJson<{ identifier?: unknown; passphrase?: unknown }>(req);
        if (typeof identifier !== 'string' || typeof passphrase !== 'string') throw new HttpError(400, 'identifier and passphrase are required');
        try {
            await ctx.auth.createUser(identifier, passphrase);
        } catch (err) {
            throw new HttpError(400, (err as Error).message);
        }
        const result = (await ctx.auth.login(identifier, passphrase, req.socket.remoteAddress ?? 'unknown', req.headers['user-agent']))!;
        res.setHeader('Set-Cookie', cookie(result.token, SESSION_MAX_AGE));
        json(res, 201, { user: { identifier: result.user.identifier } });
    });

    route('POST', '/api/v2/auth/logout', async (req, res) => {
        // The shared sign-in: this computer signs out of every app (the service ends its session)
        if (ctx.door) await askDoor(door => door.signOut(readCookie(req, sessionCookie)));
        ctx.auth?.logout(readCookie(req, sessionCookie));
        res.setHeader('Set-Cookie', cookie('', 0));
        json(res, 200, { ok: true });
    });

    route('POST', '/api/v2/auth/logout-all', (req, res) => {
        if (!ctx.auth) throw new HttpError(404, 'sign out everywhere is on the Account page');
        const signedOut = ctx.auth.logoutAll(userOf(req).id);
        res.setHeader('Set-Cookie', cookie('', 0));
        json(res, 200, { signedOut });
    });

    // ---- the shared sign-in: off to the sign-in service, and back with a one-time code
    route('GET', '/api/v2/auth/begin', (_req, res, _p, url) => {
        if (!ctx.door) throw new HttpError(404, 'the shared sign-in is not in use');
        const state = crypto.randomBytes(16).toString('base64url');
        res.writeHead(302, {
            Location: ctx.door.signInUrl(state, sameSitePath(url.searchParams.get('return')), url.searchParams.get('reason')),
            'Set-Cookie': stateCookieValue(state, 600),
            'Cache-Control': 'no-store',
        });
        res.end();
    });

    route('GET', '/api/v2/auth/callback', async (req, res, _p, url) => {
        if (!ctx.door) throw new HttpError(404, 'the shared sign-in is not in use');
        const state = url.searchParams.get('state');
        const expected = readCookie(req, stateCookie);
        let notOwner = false;
        const got = state && expected && state === expected
            ? await askDoor(door => door.exchange(url.searchParams.get('code') ?? '')).catch(err => {
                if (err instanceof HttpError) throw err;
                notOwner = err instanceof NotOwner;
                return null;
            })
            : null;
        if (notOwner) {
            // Signed in to Bassapps, but this Mail belongs to someone else: nothing is set
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': stateCookieValue('', 0), 'Cache-Control': 'no-store' });
            res.end(`<!doctype html><meta charset="utf-8"><title>Mail</title><p style="font-family:system-ui;margin:48px">This Mail belongs to another Bassapps login. <a href="${ctx.door.publicUrl}/account">Account</a></p>`);
            return;
        }
        if (!got) {
            // Not this browser's sign-in (or a code already used): nothing is set
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': stateCookieValue('', 0), 'Cache-Control': 'no-store' });
            res.end('<!doctype html><meta charset="utf-8"><title>Sign in</title><p style="font-family:system-ui;margin:48px">Signing in didn\'t finish. <a href="/">Try again</a></p>');
            return;
        }
        res.writeHead(302, {
            Location: sameSitePath(url.searchParams.get('return')),
            'Set-Cookie': [cookie(got.token, APP_COOKIE_MAX_AGE), stateCookieValue('', 0)],
            'Cache-Control': 'no-store',
        });
        res.end();
    });

    // ---- notices the sign-in service asks Mail to send (the new sign-in email); /internal only
    route('POST', '/internal/v1/notify', async (req, res) => {
        if (!ctx.notify) throw new HttpError(404, 'notices are not set up');
        const b = await readJson<{ subject?: unknown; text?: unknown; fromName?: unknown }>(req);
        if (typeof b.subject !== 'string' || typeof b.text !== 'string') throw new HttpError(400, 'subject and text are required');
        await ctx.notify({ subject: b.subject.slice(0, 200), text: b.text.slice(0, 5000), fromName: typeof b.fromName === 'string' ? b.fromName.slice(0, 60) : 'Bassapps' });
        json(res, 200, { ok: true });
    });

    // ---- accounts
    route('GET', '/api/v2/accounts', (_req, res) => {
        const listed = ctx.accounts?.list() ?? [];
        const summaries = new Map(listed.map(a => [a.id, a]));
        // In the order the owner set (Settings → Accounts), not the order the workers started in
        const place = new Map(listed.map((a, i) => [a.id, i]));
        const workers = [...ctx.workers.values()].sort((a, b) => (place.get(a.account.id) ?? Infinity) - (place.get(b.account.id) ?? Infinity));
        json(res, 200, {
            accounts: workers.map(w => ({
                id: w.account.id, email: w.account.email,
                displayName: summaries.get(w.account.id)?.displayName ?? null,
                tabName: summaries.get(w.account.id)?.tabName ?? null,
                signature: summaries.get(w.account.id)?.signature ?? null,
                inboxView: summaries.get(w.account.id)?.inboxView ?? 'expand',
                hasSmtp: summaries.get(w.account.id)?.hasSmtp ?? false,
                ...w.status(),
            })),
        });
    });

    route('POST', '/api/v2/accounts/test', async (req, res) => {
        writable();
        const input = accountInput(await readJson(req), false);
        json(res, 200, { check: await testConnection(input) });
    });

    route('POST', '/api/v2/accounts', async (req, res) => {
        writable();
        if (!ctx.manager) throw new HttpError(404, 'accounts cannot be added here');
        const account = await ctx.manager.add(accountInput(await readJson(req), true));
        json(res, 201, { account });
    });

    // An address's mail servers, found without logging in (app/discover.ts); null when not found.
    route('POST', '/api/v2/accounts/discover', async (req, res) => {
        const { email } = await readJson<{ email?: unknown }>(req);
        if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new HttpError(400, 'a valid email address is required');
        json(res, 200, { servers: await (ctx.discover ?? discoverServers)(email) });
    });

    // The accounts' order on the rail (Settings → Accounts, by dragging)
    route('PUT', '/api/v2/account-order', async (req, res) => {
        writable();
        if (!ctx.manager) throw new HttpError(404, 'accounts cannot be changed here');
        const { ids } = await readJson<{ ids?: unknown }>(req);
        if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new HttpError(400, 'ids must be a list of account ids');
        ctx.manager.setOrder(ids as string[]);
        json(res, 200, { ok: true });
    });

    route('DELETE', '/api/v2/accounts/:account', async (_req, res, p) => {
        worker(p);
        writable();
        if (!ctx.manager) throw new HttpError(404, 'accounts cannot be removed here');
        await ctx.manager.remove(p.account);
        json(res, 200, { ok: true });
    });

    route('GET', '/api/v2/settings/export', (_req, res) => {
        if (!ctx.accounts || !ctx.rules) throw new HttpError(404, 'settings are not available');
        if (!ctx.app) throw new HttpError(404, 'settings are not available');
        const file = exportSettings(ctx.app, ctx.accounts, ctx.rules);
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="electronic-mail-settings-${file.exportedAt.slice(0, 10)}.json"`,
            'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(file, null, 2));
    });

    route('POST', '/api/v2/settings/import', async (req, res) => {
        writable();
        if (!ctx.accounts || !ctx.rules) throw new HttpError(404, 'settings are not available');
        if (!ctx.app) throw new HttpError(404, 'settings are not available');
        const summary = importSettings(ctx.app, ctx.accounts, ctx.rules, await readJson(req));
        for (const w of ctx.workers.values()) w.touch();
        json(res, 200, { summary });
    });

    // Where the account connects (never its passwords), for the settings screen.
    route('GET', '/api/v2/accounts/:account/settings', (_req, res, p) => {
        worker(p);
        if (!ctx.accounts) throw new HttpError(404, 'account settings are not available');
        json(res, 200, { settings: { ...ctx.accounts.get(p.account), ...ctx.accounts.connectionInfo(p.account) } });
    });

    route('PATCH', '/api/v2/accounts/:account', async (req, res, p) => {
        worker(p);
        if (!ctx.accounts) throw new HttpError(404, 'account settings are not available');
        const body = await readJson<{ displayName?: unknown; inboxView?: unknown; tabName?: unknown; signature?: unknown; imap?: unknown; smtp?: unknown }>(req);
        if (body.inboxView !== undefined && body.inboxView !== 'expand' && body.inboxView !== 'thread') throw new HttpError(400, 'inboxView must be "expand" or "thread"');
        if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== 'string') throw new HttpError(400, 'displayName must be text');
        if (body.tabName !== undefined && body.tabName !== null && typeof body.tabName !== 'string') throw new HttpError(400, 'tabName must be text');
        if (typeof body.tabName === 'string' && [...body.tabName.trim()].length > TAB_NAME_MAX) throw new HttpError(400, `the tab name can be at most ${TAB_NAME_MAX} characters`);
        if (body.signature !== undefined && body.signature !== null && typeof body.signature !== 'string') throw new HttpError(400, 'signature must be text');
        if (typeof body.signature === 'string' && body.signature.length > SIGNATURE_MAX) throw new HttpError(400, `the signature can be at most ${SIGNATURE_MAX} characters`);
        if (body.imap !== undefined || body.smtp !== undefined) {
            writable();
            if (!ctx.manager) throw new HttpError(404, 'connections cannot be changed here');
            // Like adding an account: each server given is tried before anything is saved, and a
            // new incoming password starts the account again with it (settings-audit.md, section 3)
            if (body.imap === null) throw new HttpError(400, 'Mail needs an incoming server');
            await ctx.manager.changeConnection(p.account, {
                imap: body.imap === undefined ? undefined : serverChange(body.imap, 'Incoming mail (IMAP)'),
                smtp: body.smtp === undefined ? undefined : body.smtp === null ? null : serverChange(body.smtp, 'Outgoing mail (SMTP)'),
            });
        }
        const updated = ctx.accounts.update(p.account, {
            displayName: body.displayName as string | null | undefined,
            inboxView: body.inboxView as 'expand' | 'thread' | undefined,
            tabName: body.tabName as string | null | undefined,
            signature: body.signature as string | null | undefined,
        });
        ctx.workers.get(p.account)?.touch(); // the worker as it is now (a new password starts a new one)
        json(res, 200, { account: updated });
    });

    // Recipient suggestions while typing an address: across all accounts, never your own addresses.
    route('GET', '/api/v2/contacts', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const mine = (ctx.accounts?.list() ?? []).map(a => a.email);
        json(res, 200, { contacts: suggestContacts(ctx.store, url.searchParams.get('q') ?? '', mine) });
    });

    // ---- compose and send (docs/architecture.md, rule 9)
    const outbox = () => {
        if (!ctx.outbox || !ctx.accounts) throw new HttpError(404, 'sending is not available');
        return ctx.outbox;
    };
    const uploads = () => {
        if (!ctx.uploads) throw new HttpError(404, 'attachments are not available');
        return ctx.uploads;
    };

    route('POST', '/api/v2/uploads', async (req, res) => {
        writable();
        const declared = Number(req.headers['content-length'] ?? 0);
        if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, `attachments are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
        const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'attachment'));
        const info = await uploads().save(req, filename, String(req.headers['content-type'] ?? 'application/octet-stream'));
        json(res, 201, { upload: info });
    });

    route('POST', '/api/v2/accounts/:account/outbox', async (req, res, p) => {
        const w = worker(p);
        writable();
        const account = ctx.accounts?.get(p.account);
        if (!account) throw new HttpError(404, 'unknown account');
        const body = await readJson<{
            to?: unknown; cc?: unknown; bcc?: unknown; subject?: unknown; html?: unknown; text?: unknown;
            replyTo?: unknown; inReplyTo?: unknown; references?: unknown; forwardOf?: unknown; forwardAttachments?: unknown; attachments?: unknown; draftKey?: unknown;
            holdMs?: unknown;
        }>(req, MAX_COMPOSE_BODY);
        const to = addresses(body.to, 'to'), cc = addresses(body.cc, 'cc'), bcc = addresses(body.bcc, 'bcc');
        if (typeof body.subject !== 'string') throw new HttpError(400, 'subject is required (it may be empty)');
        const html = optionalText(body.html, 'html'), text = optionalText(body.text, 'text');
        const uploadIds = stringList(body.attachments, 'attachments');
        const attachments: OutgoingAttachment[] = uploadIds.map(id => uploads().load(id));

        let threading: { inReplyTo?: string; references?: string[] } = {};
        if (body.replyTo !== undefined) {
            if (typeof body.replyTo !== 'string') throw new HttpError(400, 'replyTo must be a message key');
            const t = threadingFor(ctx.store, p.account, body.replyTo);
            threading = { inReplyTo: t.inReplyTo, references: t.references };
        } else if (body.inReplyTo !== undefined) {
            // A continued draft: its own headers, as saved.
            threading = threadingFromHeaders(body.inReplyTo, body.references) ?? {};
        }
        if (body.forwardOf !== undefined) {
            if (typeof body.forwardOf !== 'string') throw new HttpError(400, 'forwardOf must be a message key');
            if (body.forwardAttachments !== false) attachments.push(...await forwardedAttachments(w, ctx.store, p.account, body.forwardOf));
        }
        if (attachments.reduce((n, a) => n + a.content.length, 0) > MAX_UPLOAD_BYTES) {
            throw new HttpError(413, `attachments together are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
        }
        const built = await buildMessage({
            from: { name: account.displayName, address: account.email },
            to, cc, bcc, subject: body.subject, html, text, attachments, ...threading,
        });
        const item = outbox().enqueue(p.account, built, {
            subject: body.subject, recipients: [...to, ...cc, ...bcc].map(a => a.address),
            draftKey: typeof body.draftKey === 'string' ? body.draftKey : null, uploads: uploadIds,
            // Held a few seconds for Undo send (at most 30)
            holdMs: typeof body.holdMs === 'number' ? Math.max(0, Math.min(MAX_HOLD_MS, body.holdMs)) : 0,
        });
        json(res, 202, { item });
    });

    // Undo send: only while it's still queued; once it's gone, 409 "already sent".
    route('POST', '/api/v2/accounts/:account/outbox/:item/cancel', (_req, res, p) => {
        worker(p);
        writable();
        outbox().cancel(p.account, p.item); // OutboxError: 409
        json(res, 200, { ok: true });
    });

    // Forwarding: the original's attachments become ordinary uploads, so the composer shows them as
    // files that can be removed, they're saved with the draft, and they belong to no account.
    route('POST', '/api/v2/accounts/:account/messages/:message/forward-files', async (_req, res, p) => {
        const w = worker(p);
        writable();
        const files = await forwardedAttachments(w, ctx.store, p.account, p.message);
        json(res, 200, { uploads: files.map(f => uploads().saveBuffer(f.content, f.filename, f.contentType)) });
    });

    route('GET', '/api/v2/accounts/:account/outbox', (_req, res, p) => {
        worker(p);
        json(res, 200, { items: outbox().list(p.account) });
    });

    route('POST', '/api/v2/accounts/:account/outbox/:item/retry', (_req, res, p) => {
        worker(p);
        writable();
        json(res, 202, { item: outbox().retry(p.account, p.item) });
    });

    route('DELETE', '/api/v2/accounts/:account/outbox/:item', (_req, res, p) => {
        worker(p);
        writable();
        outbox().discard(p.account, p.item);
        json(res, 200, { ok: true });
    });

    // ---- drafts (kept in the server's Drafts folder)
    const drafts = () => {
        if (!ctx.drafts || !ctx.accounts) throw new HttpError(404, 'drafts are not available');
        return ctx.drafts;
    };

    route('GET', '/api/v2/accounts/:account/drafts', (_req, res, p) => {
        worker(p);
        json(res, 200, { state: state(p), drafts: drafts().list(p.account) });
    });

    // Up next on home (Explore 1): every conversation in the buckets shown on home, and every
    // draft, in one answer, so home doesn't wait for the bucket list before asking for them.
    route('GET', '/api/v2/accounts/:account/home', (_req, res, p) => {
        worker(p);
        const onHome = buckets().list(p.account).filter(b => b.showOnHome);
        json(res, 200, {
            state: state(p),
            buckets: onHome.map(b => ({ name: b.name, path: b.path, threads: folderView(ctx.store, p.account, b.path, HOME_MAX_THREADS, 0).threads })),
            drafts: ctx.drafts ? ctx.drafts.list(p.account) : [],
        });
    });

    route('GET', '/api/v2/accounts/:account/drafts/:draft', async (_req, res, p) => {
        json(res, 200, { draft: await drafts().open(worker(p), p.account, p.draft) });
    });

    // A draft's fields as the composer sends them (saving it, or moving it to another account).
    type DraftBody = { to?: unknown; cc?: unknown; bcc?: unknown; subject?: unknown; html?: unknown; text?: unknown;
        replyTo?: unknown; inReplyTo?: unknown; references?: unknown; attachments?: unknown; replaces?: unknown; originalAccount?: unknown; toAccount?: unknown; forwardOf?: unknown };
    const draftInput = (body: DraftBody) => ({
        to: addresses(body.to, 'to'), cc: addresses(body.cc, 'cc'), bcc: addresses(body.bcc, 'bcc'),
        subject: typeof body.subject === 'string' ? body.subject : '',
        html: optionalText(body.html, 'html'), text: optionalText(body.text, 'text'),
        replyTo: typeof body.replyTo === 'string' ? body.replyTo : null,
        inReplyTo: typeof body.inReplyTo === 'string' ? body.inReplyTo : null,
        references: Array.isArray(body.references) ? body.references.filter((r): r is string => typeof r === 'string') : [],
        attachments: stringList(body.attachments, 'attachments'),
        replaces: typeof body.replaces === 'string' ? body.replaces : null,
        originalAccount: typeof body.originalAccount === 'string' ? body.originalAccount : null,
        forwardOf: typeof body.forwardOf === 'string' ? body.forwardOf : null,
    });

    route('PUT', '/api/v2/accounts/:account/drafts/:draft', async (req, res, p) => {
        const w = worker(p);
        writable();
        const account = ctx.accounts?.get(p.account);
        if (!account) throw new HttpError(404, 'unknown account');
        const body = await readJson<DraftBody>(req, MAX_COMPOSE_BODY);
        const saved = await drafts().save(w, { name: account.displayName, address: account.email }, p.account, p.draft, draftInput(body));
        json(res, 200, saved);
    });

    // Changing From: the draft (by its key) moves to the other account's Drafts folder.
    route('POST', '/api/v2/accounts/:account/drafts/:draft/move', async (req, res, p) => {
        const w = worker(p);
        writable();
        const body = await readJson<DraftBody>(req, MAX_COMPOSE_BODY);
        if (typeof body.toAccount !== 'string') throw new HttpError(400, 'toAccount is required');
        const target = ctx.workers.get(body.toAccount);
        const account = ctx.accounts?.get(body.toAccount);
        if (!target || !account) throw new HttpError(404, `unknown account ${body.toAccount}`);
        const moved = await drafts().move({ worker: w, accountId: p.account },
            { worker: target, accountId: body.toAccount, address: { name: account.displayName, address: account.email } }, p.draft, draftInput(body));
        json(res, 200, moved);
    });

    route('DELETE', '/api/v2/accounts/:account/drafts/:draft', async (_req, res, p) => {
        const w = worker(p);
        writable();
        await drafts().discard(w, p.account, p.draft);
        json(res, 200, { ok: true });
    });

    // ---- rules
    const rules = () => {
        if (!ctx.rules) throw new HttpError(404, 'rules are not available');
        return ctx.rules;
    };
    route('GET', '/api/v2/accounts/:account/rules', (_req, res, p) => {
        worker(p);
        json(res, 200, { rules: rules().list(p.account) });
    });

    route('POST', '/api/v2/accounts/:account/rules', async (req, res, p) => {
        worker(p);
        writable();
        const { senderPattern, bucket, createdAt } = await readJson<{ senderPattern?: unknown; bucket?: unknown; createdAt?: unknown }>(req);
        if (typeof senderPattern !== 'string' || typeof bucket !== 'string') throw new HttpError(400, 'senderPattern and bucket are required');
        if (ctx.buckets && !ctx.buckets.list(p.account).some(b => b.name === bucket)) throw new HttpError(400, `no bucket called "${bucket}"`);
        // createdAt: Undo puts a deleted rule back where it was in the list
        json(res, 201, { rule: rules().add(p.account, senderPattern, bucket, typeof createdAt === 'string' ? createdAt : undefined) });
    });

    route('PATCH', '/api/v2/accounts/:account/rules/:rule', async (req, res, p) => {
        worker(p);
        writable();
        const { senderPattern, bucket } = await readJson<{ senderPattern?: unknown; bucket?: unknown }>(req);
        if (typeof senderPattern !== 'string' || typeof bucket !== 'string') throw new HttpError(400, 'senderPattern and bucket are required');
        if (ctx.buckets && !ctx.buckets.list(p.account).some(b => b.name === bucket)) throw new HttpError(400, `no bucket called "${bucket}"`);
        const rule = rules().update(p.account, p.rule, senderPattern, bucket);
        if (!rule) throw new HttpError(404, 'rule not found');
        json(res, 200, { rule });
    });

    route('DELETE', '/api/v2/accounts/:account/rules/:rule', (_req, res, p) => {
        worker(p);
        writable();
        if (!rules().remove(p.account, p.rule)) throw new HttpError(404, 'rule not found');
        json(res, 200, { ok: true });
    });

    // ---- buckets
    route('GET', '/api/v2/accounts/:account/buckets', (_req, res, p) => {
        json(res, 200, { state: state(p), buckets: buckets().list(p.account) });
    });

    route('POST', '/api/v2/accounts/:account/buckets', async (req, res, p) => {
        const w = worker(p);
        writable();
        const body = await readJson<BucketBody>(req);
        if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'name is required');
        const bucket = await buckets().create(w, p.account, body.name, appearanceOf(body));
        if (bucket.autoArchiveDays) w.requestSweep();
        json(res, 201, { bucket, state: w.stateToken });
    });

    route('PATCH', '/api/v2/accounts/:account/buckets/:bucket', async (req, res, p) => {
        const w = worker(p);
        writable();
        const body = await readJson<BucketBody>(req);
        let name = p.bucket;
        if (body.name !== undefined) {
            if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'name must be text');
            name = (await buckets().rename(w, p.account, p.bucket, body.name)).name;
        }
        const look = appearanceOf(body);
        const bucket = Object.keys(look).length ? buckets().setAppearance(w, p.account, name, look) : buckets().list(p.account).find(b => b.name === name);
        // "Saving confirms it": a new or shorter age archives what's due now, not on the hour.
        if (look.autoArchiveDays) w.requestSweep();
        json(res, 200, { bucket, state: w.stateToken });
    });

    // ---- auto-archive (feature batch 1): what a setting would archive now (shown before saving),
    // the notice after sweeps (shown once), and Undo for whole batches
    route('GET', '/api/v2/accounts/:account/buckets/:bucket/old-items', (_req, res, p, url) => {
        const days = Number(url.searchParams.get('days'));
        if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new HttpError(400, `days must be a whole number from 1 to ${MAX_DAYS}`);
        const bucket = buckets().list(p.account).find(b => b.name === p.bucket);
        if (!bucket) throw new HttpError(404, `no bucket called "${p.bucket}"`);
        json(res, 200, { count: countOld(ctx.store, p.account, bucket.path, days) });
    });

    route('GET', '/api/v2/accounts/:account/auto-archived', (_req, res, p) => {
        worker(p);
        json(res, 200, { notice: sweepNotice(ctx.store, p.account) });
    });

    route('POST', '/api/v2/accounts/:account/auto-archived/seen', async (req, res, p) => {
        worker(p);
        writable();
        markSeen(ctx.store, p.account, sweepIds(await readJson<{ ids?: unknown }>(req)));
        json(res, 200, { ok: true });
    });

    route('POST', '/api/v2/accounts/:account/auto-archived/undo', async (req, res, p) => {
        const w = worker(p);
        writable();
        const undone = undoSweeps(ctx.store, p.account, sweepIds(await readJson<{ ids?: unknown }>(req)));
        w.touch();
        if (undone) w.requestTasks();
        json(res, 202, { undone, state: w.stateToken });
    });

    // For checks (the walkthrough): run the daily sweep now.
    route('POST', '/api/v2/accounts/:account/auto-archive/run', (_req, res, p) => {
        const w = worker(p);
        writable();
        w.requestSweep();
        json(res, 202, { ok: true });
    });

    route('PUT', '/api/v2/accounts/:account/bucket-order', async (req, res, p) => {
        const w = worker(p);
        writable();
        const { names } = await readJson<{ names?: unknown }>(req);
        if (!Array.isArray(names) || !names.every(n => typeof n === 'string')) throw new HttpError(400, 'names must be a list of bucket names');
        json(res, 200, { buckets: buckets().reorder(w, p.account, names as string[]), state: w.stateToken });
    });

    route('DELETE', '/api/v2/accounts/:account/buckets/:bucket', async (_req, res, p) => {
        const w = worker(p);
        writable();
        const result = await buckets().remove(w, p.account, p.bucket);
        json(res, 200, { ...result, state: w.stateToken });
    });

    route('GET', '/api/v2/accounts/:account/folders', (_req, res, p) => {
        json(res, 200, { state: state(p), status: worker(p).status(), folders: folderList(ctx.store, p.account) });
    });

    route('GET', '/api/v2/accounts/:account/threads', (_req, res, p, url) => {
        const limit = clampInt(url.searchParams.get('limit'), 50, 1, 500);
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);
        const location = url.searchParams.get('location');
        const view = url.searchParams.get('view');
        const s = state(p);
        if (view === 'sent') return json(res, 200, { state: s, ...sentView(ctx.store, p.account, limit, offset) });
        if (!location) throw new HttpError(400, 'location or view=sent is required');
        // withSentOnly=1: also conversations that only hold mail you sent (the Archive shows them, as before)
        const withSentOnly = url.searchParams.get('withSentOnly') === '1';
        json(res, 200, { state: s, location, ...folderView(ctx.store, p.account, location, limit, offset, { withSentOnly }) });
    });

    route('GET', '/api/v2/accounts/:account/search', (_req, res, p, url) => {
        const q = url.searchParams.get('q') ?? '';
        if (q.length > 200) throw new HttpError(400, 'search text is too long');
        json(res, 200, { state: state(p), q, ...search(ctx.store, p.account, q, {
            location: url.searchParams.get('location'),
            limit: clampInt(url.searchParams.get('limit'), 50, 1, 200),
            offset: clampInt(url.searchParams.get('offset'), 0, 0, 100_000),
        }) });
    });

    route('GET', '/api/v2/accounts/:account/threads/:thread', (_req, res, p) => {
        const s = state(p);
        // A message's key finds its conversation too (a moved reply draft looks up the one it answers).
        const byMessage = ctx.store.db.prepare('SELECT thread_id FROM message WHERE account = ? AND msg_key = ?').get(p.account, p.thread) as { thread_id: string | null } | undefined;
        const detail = threadDetail(ctx.store, p.account, p.thread) ?? (byMessage?.thread_id ? threadDetail(ctx.store, p.account, byMessage.thread_id) : null);
        if (!detail) throw new HttpError(404, 'thread not found');
        json(res, 200, { state: s, ...detail });
    });

    route('POST', '/api/v2/accounts/:account/threads/:thread/move', async (req, res, p) => {
        const w = worker(p);
        writable();
        const { to } = await readJson<{ to?: unknown }>(req);
        if (typeof to !== 'string' || !to) throw new HttpError(400, '"to" (a folder path) is required');
        const taskId = enqueueMoveThread(ctx.store, p.account, p.thread, to);
        w.touch(); // the local phase already shows the move: tell every open view now
        w.requestTasks();
        json(res, 202, { taskId, state: w.stateToken });
    });

    route('POST', '/api/v2/accounts/:account/threads/:thread/seen', async (req, res, p) => {
        const w = worker(p);
        writable();
        const { seen } = await readJson<{ seen?: unknown }>(req);
        if (typeof seen !== 'boolean') throw new HttpError(400, '"seen" (true or false) is required');
        const taskId = enqueueSetSeen(ctx.store, p.account, p.thread, seen);
        w.touch();
        w.requestTasks();
        json(res, 202, { taskId, state: w.stateToken });
    });

    route('POST', '/api/v2/accounts/:account/tasks/:task/undo', (_req, res, p) => {
        const w = worker(p);
        writable();
        const undoTaskId = enqueueUndo(ctx.store, p.account, taskIdOf(ctx, p));
        w.touch();
        if (undoTaskId !== null) w.requestTasks();
        json(res, 202, { undoTaskId, state: w.stateToken });
    });

    route('GET', '/api/v2/accounts/:account/tasks/:task', (_req, res, p) => {
        const task = getTask(ctx.store, taskIdOf(ctx, p))!;
        json(res, 200, { id: task.id, kind: task.kind, status: task.status, error: task.error, attempts: task.attempts });
    });

    route('POST', '/api/v2/accounts/:account/sync', (_req, res, p) => {
        worker(p).requestCheck();
        json(res, 202, { state: state(p) });
    });

    route('GET', '/api/v2/accounts/:account/messages/:message/body', async (_req, res, p) => {
        const w = worker(p);
        const body = await w.withReader(client => getBody(client, ctx.store, p.account, p.message));
        json(res, 200, body);
    });

    route('GET', '/api/v2/accounts/:account/messages/:message/attachments/:part', async (req, res, p) => {
        const w = worker(p);
        if (!/^\d+(\.\d+)*$/.test(p.part)) throw new HttpError(400, 'invalid part');
        await w.withReader(async client => {
            const file = await openAttachment(client, ctx.store, p.account, p.message, p.part);
            const name = file.filename ?? `attachment-${p.part}`;
            res.writeHead(200, {
                // Never render attachments on the app's own origin: an HTML attachment could run
                // script there. Always download, never sniff, and sandbox it if a browser tries.
                'Content-Type': file.contentType === 'text/html' ? 'application/octet-stream' : file.contentType,
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
                'Content-Security-Policy': 'sandbox',
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'private, no-store',
            });
            req.once('close', () => file.content.destroy()); // client gave up: release the mailbox
            await pipeline(file.content, res);
        });
    });

    if (ctx.viewerDir) {
        const files: Record<string, string> = { '/': 'index.html', '/viewer.js': 'viewer.js' };
        for (const [urlPath, file] of Object.entries(files)) {
            route('GET', urlPath, (_req, res) => {
                const body = fs.readFileSync(path.join(ctx.viewerDir!, file));
                res.writeHead(200, {
                    'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store',
                    // The page itself may only run its own script; email HTML lives in sandboxed iframes.
                    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src 'self' about:; base-uri 'none'; form-action 'none'",
                });
                res.end(body);
            });
        }
    }

    route('GET', '/api/v2/events', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no', // let reverse proxies stream instead of buffering
        });
        const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        // Each account's token, its connection, and the rest of its status (when a password was
        // rejected, when Mail tries again), so a page that connects late knows as much as the others
        const snapshot = () => Object.fromEntries([...ctx.workers.values()].map(w => [w.account.id, { state: w.stateToken, status: w.status().state, detail: w.status() }]));
        send('state', { changed: snapshot() });

        const onChanged = (e: ChangedEvent) => {
            send('state', { changed: { [e.account]: { state: e.stateToken, status: ctx.workers.get(e.account)?.status().state } } });
            for (const t of e.tasks) send('task', { account: e.account, ...t });
        };
        const onStatus = (s: AccountStatus) => send('status', s);
        const onOutbox = (e: { accountId: string; id: string; status: string; error: string | null }) => send('outbox', e);
        const onAccounts = (e: unknown) => send('accounts', e);
        // One source of events: the manager (it also covers accounts added later), else each worker.
        const sources: EventEmitter[] = ctx.manager ? [ctx.manager] : [...ctx.workers.values()];
        for (const src of sources) { src.on('changed', onChanged); src.on('status', onStatus); }
        ctx.manager?.on('accounts', onAccounts);
        ctx.outbox?.on('change', onOutbox);
        // With the shared sign-in, the session can end elsewhere (Sign out everywhere, Account): look
        // again with each heartbeat, and when it's over say why and close, so nothing more arrives here.
        const token = readCookie(req, sessionCookie);
        const heartbeat = setInterval(async () => {
            const v = ctx.door ? await askDoor(door => door.verify(token)).catch(() => null) : null;
            if (v && !v.ok) {
                send('signed-out', { reason: v.reason });
                res.end();
            } else res.write(': ping\n\n');
        }, HEARTBEAT_MS);
        req.once('close', () => {
            clearInterval(heartbeat);
            for (const src of sources) { src.off('changed', onChanged); src.off('status', onStatus); }
            ctx.manager?.off('accounts', onAccounts);
            ctx.outbox?.off('change', onOutbox);
        });
    });

    return http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            const candidates = routes.filter(r => r.pattern.test(url.pathname));
            if (!candidates.length) {
                const screens = ctx.staticDir && (req.method === 'GET' || req.method === 'HEAD') && !/^\/(api|internal)\//.test(url.pathname);
                if (screens) return serveStatic(req, res, url);
                throw new HttpError(404, 'not found');
            }
            const match = candidates.find(r => r.method === req.method);
            if (!match) throw new HttpError(405, 'method not allowed');
            const internal = url.pathname.startsWith('/internal/');
            if (internal && !(ctx.internalSecret && secretMatches(req.headers['x-door-secret'], ctx.internalSecret))) throw new HttpError(403, 'forbidden');
            // State-changing requests: JSON only and same origin, so no other site can forge one.
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET')) {
                if (RAW_WRITE_PATHS.has(url.pathname)) {
                    if (req.headers['x-requested-with'] !== RAW_WRITE_HEADER) throw new HttpError(403, `uploads must send X-Requested-With: ${RAW_WRITE_HEADER}`);
                } else if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'requests that change something must send JSON');
                const origin = req.headers.origin;
                if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'cross-site request refused');
            }
            if (ctx.door && !PUBLIC_PATHS.has(url.pathname) && !internal) {
                const v = await askDoor(door => door.verify(readCookie(req, sessionCookie)));
                if (!v.ok) throw new HttpError(401, 'not signed in', v.reason ?? undefined);
                users.set(req, { id: v.user.id, identifier: v.user.username });
            } else if (ctx.auth && !PUBLIC_PATHS.has(url.pathname) && !(FIRST_RUN_PATHS.has(url.pathname) && !ctx.auth.hasUsers())) {
                const user = ctx.auth.session(readCookie(req, sessionCookie), renewCookie(req, res));
                if (!user) throw new HttpError(401, 'not logged in');
                users.set(req, user);
            }
            const values = url.pathname.match(match.pattern)!.slice(1);
            const params: Params = {};
            match.keys.forEach((k, i) => { params[k] = decodeURIComponent(values[i]); });
            await match.handler(req, res, params, url);
        } catch (err) {
            if (err instanceof RateLimited) res.setHeader('Retry-After', String(Math.ceil(err.retryAfterSeconds)));
            const status = err instanceof HttpError ? err.status
                : err instanceof RateLimited ? 429
                : err instanceof NotFound ? 404
                : err instanceof TaskError || err instanceof BucketError ? 409
                : err instanceof RuleError || err instanceof ComposeError || err instanceof UploadError ? 400
                : err instanceof OutboxError ? 409
                : err instanceof AccountError || err instanceof SettingsError ? 400
                : /offline/.test((err as Error)?.message ?? '') ? 503
                : 500;
            if (status === 500) ctx.log?.(`API ${req.method} ${url.pathname}: ${(err as Error)?.stack ?? err}`);
            // A reason says why, for the screens: who signed out (401), or which server refused (AccountError)
            const reason = err instanceof HttpError || err instanceof AccountError ? err.reason : undefined;
            if (!res.headersSent) json(res, status, { error: status === 500 ? 'internal error' : (err as Error).message, ...(reason ? { reason } : {}) });
            else res.destroy();
        }
    });
}

function taskIdOf(ctx: ApiContext, p: Params): number {
    const id = Number(p.task);
    const task = Number.isInteger(id) ? getTask(ctx.store, id) : undefined;
    if (!task || task.account !== p.account) throw new HttpError(404, 'task not found');
    return id;
}

/** A server's connection details from a request. `savedPass` is used when no password is sent. */
function serverInput(s: unknown, label: string, savedPass?: string): { host: string; port: number; secure: boolean; user: string; pass: string } {
    const v = (s ?? {}) as Record<string, unknown>;
    const port = Number(v.port);
    const pass = typeof v.pass === 'string' && v.pass ? v.pass : savedPass;
    if (typeof v.host !== 'string' || !v.host.trim()) throw new HttpError(400, `${label}: the server name is required`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, `${label}: the port must be a number from 1 to 65535`);
    if (typeof v.user !== 'string' || !v.user || !pass) throw new HttpError(400, `${label}: username and password are required`);
    return { host: v.host.trim(), port, secure: v.secure !== false, user: v.user, pass };
}

/** A server as changed in Settings: like serverInput, but no password keeps the saved one. */
function serverChange(s: unknown, label: string): ServerChange {
    const v = (s ?? {}) as Record<string, unknown>;
    const port = Number(v.port);
    if (typeof v.host !== 'string' || !v.host.trim()) throw new HttpError(400, `${label}: the server name is required`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, `${label}: the port must be a number from 1 to 65535`);
    if (typeof v.user !== 'string' || !v.user.trim()) throw new HttpError(400, `${label}: the username is required`);
    if (v.pass !== undefined && typeof v.pass !== 'string') throw new HttpError(400, `${label}: the password must be text`);
    return { host: v.host.trim(), port, secure: v.secure !== false, user: v.user.trim(), ...(v.pass ? { pass: v.pass as string } : {}) };
}

function accountInput(value: unknown, requireEmail: boolean): AccountInput {
    const b = (value ?? {}) as Record<string, unknown>;
    const server = (s: unknown, label: string) => serverInput(s, label);
    if (requireEmail && (typeof b.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim()))) throw new HttpError(400, 'a valid email address is required');
    return {
        email: typeof b.email === 'string' ? b.email.trim() : '',
        displayName: typeof b.displayName === 'string' ? b.displayName : null,
        inboxView: b.inboxView === 'thread' ? 'thread' : 'expand',
        imap: server(b.imap, 'Incoming mail (IMAP)'),
        smtp: b.smtp ? server(b.smtp, 'Outgoing mail (SMTP)') : null,
    };
}

function addresses(value: unknown, field: string): Address[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new HttpError(400, `${field} must be a list of addresses`);
    return value.map(v => {
        if (typeof v === 'string') return { address: v.trim() };
        const a = v as { name?: unknown; address?: unknown };
        if (typeof a?.address !== 'string') throw new HttpError(400, `${field} must be a list of addresses`);
        return { name: typeof a.name === 'string' ? a.name : null, address: a.address.trim() };
    });
}

function optionalText(value: unknown, field: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
    return value;
}

function stringList(value: unknown, field: string): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) throw new HttpError(400, `${field} must be a list`);
    return value as string[];
}

/** A forwarded message keeps its attachments (read part by part from the server). */
async function forwardedAttachments(w: AccountWorker, store: Store, account: string, msgKey: string): Promise<OutgoingAttachment[]> {
    const body = await w.withReader(client => getBody(client, store, account, msgKey));
    const out: OutgoingAttachment[] = [];
    for (const a of body.attachments) {
        const content = await w.withReader(async client => {
            const file = await openAttachment(client, store, account, msgKey, a.part);
            const chunks: Buffer[] = [];
            for await (const c of file.content) chunks.push(c as Buffer);
            return Buffer.concat(chunks);
        });
        out.push({ filename: a.filename ?? `attachment-${a.part}`, contentType: a.contentType, content });
    }
    return out;
}

function readCookie(req: http.IncomingMessage, name: string): string | undefined {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return undefined;
}

interface BucketBody {
    name?: unknown;
    color?: unknown;
    emoji?: unknown;
    showBadge?: unknown;
    showOnHome?: unknown;
    autoArchiveDays?: unknown;
}

function appearanceOf(body: BucketBody) {
    const look: { color?: string; emoji?: string | null; showBadge?: boolean; showOnHome?: boolean; autoArchiveDays?: number | null } = {};
    if (body.color !== undefined) {
        if (typeof body.color !== 'string') throw new HttpError(400, 'color must be text');
        look.color = body.color;
    }
    if (body.emoji !== undefined) {
        if (body.emoji !== null && typeof body.emoji !== 'string') throw new HttpError(400, 'emoji must be text');
        look.emoji = (body.emoji as string | null) || null;
    }
    if (body.showBadge !== undefined) {
        if (typeof body.showBadge !== 'boolean') throw new HttpError(400, 'showBadge must be true or false');
        look.showBadge = body.showBadge;
    }
    if (body.showOnHome !== undefined) {
        if (typeof body.showOnHome !== 'boolean') throw new HttpError(400, 'showOnHome must be true or false');
        look.showOnHome = body.showOnHome;
    }
    if (body.autoArchiveDays !== undefined) {
        if (body.autoArchiveDays !== null && typeof body.autoArchiveDays !== 'number') throw new HttpError(400, 'autoArchiveDays must be a number of days, or null for off');
        look.autoArchiveDays = body.autoArchiveDays as number | null;
    }
    return look;
}

function sweepIds(body: { ids?: unknown }): number[] {
    if (!Array.isArray(body.ids) || !body.ids.every(id => Number.isInteger(id))) throw new HttpError(400, 'ids must be a list of sweep ids');
    return body.ids as number[];
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
}

async function readJson<T>(req: http.IncomingMessage, limit = MAX_JSON_BODY): Promise<T> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > limit) throw new HttpError(413, 'request body too large');
        chunks.push(chunk as Buffer);
    }
    try {
        return (chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) as T;
    } catch {
        throw new HttpError(400, 'invalid JSON');
    }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
    const n = raw === null ? fallback : Number.parseInt(raw, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
