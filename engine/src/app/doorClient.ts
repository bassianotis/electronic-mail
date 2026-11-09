// Mail's side of the Bassapps sign-in (the bassapps repo; its docs/joining.md is the contract, v1):
// Mail's cookie holds a token the sign-in service issued for Mail, and each request asks the
// service whether that token is still good (a good answer is kept for 30 seconds; an ended one
// never). When it isn't, the service says why, and Mail passes the reason on, so the screen can
// say "Your session ended" or "You were signed out from another computer".
// Mail also keeps to its owners: a Bassapps login not in MAIL_USERS is refused here ('no-access'),
// whatever the sign-in service allows, so a second login can never see the owner's mail.

export type SignedOutReason = 'expired' | 'signed-out' | 'removed' | 'everywhere' | 'passphrase' | 'no-access' | 'unknown';

export interface DoorUser {
    id: string;
    username: string;
}

export class DoorUnreachable extends Error {}

/** Signed in to Bassapps, but as a login this Mail doesn't belong to. */
export class NotOwner extends Error {}

const GOOD_FOR_MS = 30_000;

export class DoorClient {
    readonly publicUrl: string;
    readonly app: string;
    private readonly internalUrl: string;
    private readonly secret: string;
    private readonly owners: Set<string>;
    private readonly cache = new Map<string, { until: number; user: DoorUser; apps: string[] }>();
    private apps: { list: { id: string; name: string; url: string }[]; accountUrl: string } | null = null;

    constructor(options: { internalUrl: string; publicUrl: string; secret: string; app: string; owners: string[] }) {
        this.internalUrl = options.internalUrl.replace(/\/$/, '');
        this.publicUrl = options.publicUrl.replace(/\/$/, '');
        this.secret = options.secret;
        this.app = options.app;
        this.owners = new Set(options.owners.map(o => o.trim().toLowerCase()).filter(Boolean));
    }

    private isOwner(user: DoorUser): boolean {
        return this.owners.has(user.username.toLowerCase());
    }

    private async call<T>(path: string, body?: unknown): Promise<T> {
        let res: Response;
        try {
            res = await fetch(this.internalUrl + path, {
                method: body === undefined ? 'GET' : 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Door-Secret': this.secret },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(5000),
            });
        } catch (err) {
            throw new DoorUnreachable(`the sign-in service isn't answering (${(err as Error).message})`);
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `sign-in service: ${res.status}`);
        return data as T;
    }

    /** Whose token it is (and the apps that login may use), or why it no longer works here. */
    async verify(token: string | undefined): Promise<{ ok: true; user: DoorUser; apps: string[] } | { ok: false; reason: SignedOutReason | null }> {
        if (!token) return { ok: false, reason: null };
        const cached = this.cache.get(token);
        if (cached && cached.until > Date.now()) return { ok: true, user: cached.user, apps: cached.apps };
        const v = await this.call<{ ok: true; user: DoorUser; apps: string[] } | { ok: false; reason: SignedOutReason }>('/internal/v1/verify', { token });
        if (!v.ok) {
            this.cache.delete(token);
            return v;
        }
        if (!this.isOwner(v.user)) return { ok: false, reason: 'no-access' };
        this.cache.set(token, { until: Date.now() + GOOD_FOR_MS, user: v.user, apps: v.apps });
        return { ok: true, user: v.user, apps: v.apps };
    }

    /** Swaps the one-time code from signing in for Mail's own token; NotOwner for anyone else's login. */
    async exchange(code: string): Promise<{ token: string; user: DoorUser }> {
        const got = await this.call<{ token: string; user: DoorUser }>('/internal/v1/exchange', { code, app: this.app });
        if (!this.isOwner(got.user)) throw new NotOwner(`"${got.user.username}" isn't one of this Mail's owners`);
        return got;
    }

    async signOut(token: string | undefined): Promise<void> {
        if (!token) return;
        this.cache.delete(token);
        await this.call('/internal/v1/sign-out', { token });
    }

    /** The family's apps (for the apps menu) and Account's address; asked once. */
    async family(): Promise<{ list: { id: string; name: string; url: string }[]; accountUrl: string }> {
        if (!this.apps) {
            const got = await this.call<{ apps: { id: string; name: string; url: string }[]; accountUrl: string }>('/internal/v1/apps');
            this.apps = { list: got.apps, accountUrl: got.accountUrl };
        }
        return this.apps;
    }

    /** Where to send someone to sign in, coming back to `returnPath` (with `state`, checked on return). */
    signInUrl(state: string, returnPath: string, reason?: string | null): string {
        const url = new URL('/sign-in', this.publicUrl);
        url.searchParams.set('app', this.app);
        url.searchParams.set('state', state);
        url.searchParams.set('return', returnPath);
        if (reason) url.searchParams.set('reason', reason);
        return url.toString();
    }
}
