// Login and sessions (docs/architecture.md, rule 10; following OWASP's authentication guidance).
// - The passphrase is checked with bcrypt (the old app's hashes import unchanged).
// - Sessions are random 256-bit tokens; only their SHA-256 is stored, so a copied database
//   cannot be used to log in. They slide forward while used and can all be revoked.
// - A wrong username takes as long as a wrong passphrase (no user enumeration by timing).
// - Login attempts are rate-limited per client (20 per 15 minutes, as in the old app).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { AppDb } from './appDb.ts';

export interface SessionUser {
    id: string;
    identifier: string;
}

export class RateLimited extends Error {
    readonly retryAfterSeconds: number;
    constructor(retryAfterSeconds: number) {
        super(`too many login attempts; try again in ${Math.ceil(retryAfterSeconds / 60)} minutes`);
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;
// OWASP's minimum and the old app's setting: the imported hash uses it, and a check stays fast
// on the Pi's CPU with pure-JS bcrypt (cost 12 measured ~0.25 s per check on a Mac).
const BCRYPT_ROUNDS = 10;
// Compared against when the user does not exist, so both paths cost one same-cost bcrypt check.
let dummyHash: string | null = null;
const dummy = () => (dummyHash ??= bcrypt.hashSync('not-a-real-passphrase', BCRYPT_ROUNDS));

export class Auth {
    private readonly app: AppDb;
    private readonly now: () => number;
    private readonly attempts = new Map<string, { count: number; since: number }>();

    constructor(app: AppDb, options: { now?: () => number } = {}) {
        this.app = app;
        this.now = options.now ?? Date.now;
    }

    hasUsers(): boolean {
        return !!this.app.db.prepare('SELECT 1 FROM users LIMIT 1').get();
    }

    async createUser(identifier: string, passphrase: string): Promise<string> {
        if (!identifier.trim() || passphrase.length < 8) throw new Error('a username and a passphrase of at least 8 characters are required');
        return this.importUser(crypto.randomUUID(), identifier.trim(), await bcrypt.hash(passphrase, BCRYPT_ROUNDS));
    }

    /** Keeps an existing bcrypt hash (used when importing the old app's login). */
    importUser(id: string, identifier: string, passwordHash: string): string {
        this.app.db.prepare('INSERT INTO users (id, identifier, password_hash, created_at) VALUES (?, ?, ?, ?)')
            .run(id, identifier, passwordHash, new Date(this.now()).toISOString());
        return id;
    }

    async login(identifier: string, passphrase: string, client: string, userAgent?: string): Promise<{ token: string; user: SessionUser } | null> {
        this.checkRate(client);
        const user = this.app.db.prepare('SELECT id, identifier, password_hash FROM users WHERE identifier = ?')
            .get(identifier.trim()) as { id: string; identifier: string; password_hash: string } | undefined;
        const ok = await bcrypt.compare(passphrase, user?.password_hash ?? dummy());
        if (!user || !ok) return null;
        this.attempts.delete(client);

        const token = crypto.randomBytes(32).toString('base64url');
        const now = this.now();
        this.app.db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent)
            VALUES (?, ?, ?, ?, ?, ?)`).run(hash(token), user.id, iso(now), iso(now + SESSION_MS), iso(now), userAgent?.slice(0, 200) ?? null);
        return { token, user: { id: user.id, identifier: user.identifier } };
    }

    /**
     * The user a session token belongs to, or null. Extends the session while it is in use (at most
     * once an hour), calling `onRenewed` when it does, so the caller can renew the browser's cookie
     * too: otherwise the cookie would still lapse 30 days after logging in.
     */
    session(token: string | undefined, onRenewed?: () => void): SessionUser | null {
        if (!token) return null;
        const row = this.app.db.prepare(`SELECT s.token_hash, s.expires_at, s.last_seen_at, u.id, u.identifier
            FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(hash(token)) as
            { token_hash: string; expires_at: string; last_seen_at: string; id: string; identifier: string } | undefined;
        if (!row) return null;
        const now = this.now();
        if (Date.parse(row.expires_at) <= now) {
            this.app.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
            return null;
        }
        if (now - Date.parse(row.last_seen_at) > TOUCH_EVERY_MS) {
            this.app.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
                .run(iso(now), iso(now + SESSION_MS), row.token_hash);
            onRenewed?.();
        }
        return { id: row.id, identifier: row.identifier };
    }

    /**
     * Sets (or first creates) a login's passphrase and signs out every session. Only reachable
     * from the machine itself (bin/set-passphrase.ts): the recovery path if it is forgotten.
     */
    async setPassphrase(identifier: string, passphrase: string): Promise<'updated' | 'created'> {
        if (passphrase.length < 8) throw new Error('the passphrase must be at least 8 characters');
        const user = this.app.db.prepare('SELECT id FROM users WHERE identifier = ?').get(identifier.trim()) as { id: string } | undefined;
        if (!user) {
            await this.createUser(identifier, passphrase);
            return 'created';
        }
        this.app.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(passphrase, BCRYPT_ROUNDS), user.id);
        this.logoutAll(user.id);
        return 'updated';
    }

    logout(token: string | undefined): void {
        if (token) this.app.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
    }

    /** "Sign out everywhere". */
    logoutAll(userId: string): number {
        return Number(this.app.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes);
    }

    private checkRate(client: string): void {
        const now = this.now();
        const a = this.attempts.get(client);
        if (!a || now - a.since > WINDOW_MS) {
            this.attempts.set(client, { count: 1, since: now });
            return;
        }
        if (a.count >= MAX_ATTEMPTS) throw new RateLimited((a.since + WINDOW_MS - now) / 1000);
        a.count++;
    }
}

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const iso = (ms: number) => new Date(ms).toISOString();
