// Mail's side of the Bassapps sign-in (AUTH_MODE=door): signing in through the service and back,
// the owner guard (MAIL_USERS), why a session ended, and the notices the service asks Mail to send.
// The service itself lives (and is tested) in the bassapps repo; here a small stand-in speaks its
// contract (docs/joining.md there, v1). No mail server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DoorClient } from '../src/app/doorClient.ts';
import { Store } from '../src/store/store.ts';
import { createApiServer } from '../src/api/server.ts';

/** The sign-in service as Mail sees it: codes, tokens, and why one ended. */
function standIn(secret: string) {
    const codes = new Map<string, string>(); // code -> username
    const tokens = new Map<string, { username: string; ended?: string }>();
    const server = http.createServer(async (req, res) => {
        const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.headers['x-door-secret'] !== secret) return send(403, { error: 'forbidden' });
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const b = raw ? JSON.parse(raw) : {};
        const user = (username: string) => ({ id: `id-${username}`, username });
        if (req.url === '/internal/v1/apps') return send(200, { apps: [{ id: 'mail', name: 'Mail', url: 'https://mail.test' }, { id: 'tasks', name: 'Tasks', url: 'https://tasks.test' }], accountUrl: 'https://account.test/account' });
        if (req.url === '/internal/v1/exchange') {
            const username = codes.get(b.code);
            codes.delete(b.code);
            if (!username || b.app !== 'mail') return send(400, { error: 'that code is not valid' });
            const token = crypto.randomBytes(16).toString('hex');
            tokens.set(token, { username });
            return send(200, { token, user: user(username) });
        }
        if (req.url === '/internal/v1/verify') {
            const t = tokens.get(b.token);
            if (!t) return send(200, { ok: false, reason: 'unknown' });
            if (t.ended) return send(200, { ok: false, reason: t.ended });
            return send(200, { ok: true, user: user(t.username), sessionId: 's', apps: ['mail'] });
        }
        if (req.url === '/internal/v1/sign-out') {
            const t = tokens.get(b.token);
            if (t) t.ended = 'signed-out';
            return send(200, { ok: true });
        }
        send(404, { error: 'not found' });
    });
    const code = (username: string) => {
        const c = crypto.randomBytes(8).toString('hex');
        codes.set(c, username);
        return c;
    };
    return { server, code, tokens };
}

async function setup() {
    const secret = crypto.randomBytes(16).toString('hex');
    const door = standIn(secret);
    await new Promise<void>(r => door.server.listen(0, '127.0.0.1', r));
    const doorOrigin = `http://127.0.0.1:${(door.server.address() as AddressInfo).port}`;
    const client = new DoorClient({ internalUrl: doorOrigin, publicUrl: 'https://account.test', secret, app: 'mail', owners: ['owner'] });
    const notices: unknown[] = [];
    const mail = createApiServer({ store: new Store(':memory:'), workers: new Map(), door: client, internalSecret: secret, notify: async n => { notices.push(n); } });
    await new Promise<void>(r => mail.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${(mail.address() as AddressInfo).port}`;
    return { secret, door, origin, notices, close: () => { door.server.close(); mail.close(); } };
}

const cookiesOf = (res: Response) => res.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => !c.endsWith('='));

test('Mail with the shared sign-in: there and back, its own cookie, and only its owner', async () => {
    const f = await setup();
    try {
        // Not signed in: Mail says so, and every API call is refused
        const status0 = await (await fetch(`${f.origin}/api/v2/auth/status`)).json();
        assert.deepEqual([status0.mode, status0.authenticated], ['door', false]);
        assert.equal((await fetch(`${f.origin}/api/v2/accounts`)).status, 401);

        // Begin: a state cookie, and off to the sign-in page with the app, the state and the way back
        const begin = await fetch(`${f.origin}/api/v2/auth/begin?return=${encodeURIComponent('/?thread=abc')}&reason=everywhere`, { redirect: 'manual' });
        assert.equal(begin.status, 302);
        const signIn = new URL(begin.headers.get('location')!);
        assert.equal(`${signIn.origin}${signIn.pathname}`, 'https://account.test/sign-in');
        assert.deepEqual([signIn.searchParams.get('app'), signIn.searchParams.get('return'), signIn.searchParams.get('reason')], ['mail', '/?thread=abc', 'everywhere']);
        const state = signIn.searchParams.get('state')!;
        const stateCookie = cookiesOf(begin)[0];

        // Back from signing in: the state must match; the code becomes Mail's own cookie
        const callback = (code: string, st: string, ret = '/?thread=abc') =>
            fetch(`${f.origin}/api/v2/auth/callback?code=${code}&state=${st}&return=${encodeURIComponent(ret)}`, { redirect: 'manual', headers: { Cookie: stateCookie } });
        assert.equal((await callback(f.door.code('owner'), 'other')).status, 400, 'another browser\'s code is refused');
        const back = await callback(f.door.code('owner'), state);
        assert.equal(back.status, 302);
        assert.equal(back.headers.get('location'), '/?thread=abc', 'back to the exact view');
        const mailCookie = cookiesOf(back).find(c => c.startsWith('em_session='))!;
        assert.ok(mailCookie);
        // Never off to another site: "//x" and "/\x" read as one
        for (const elsewhere of ['//evil.example', '/\\evil.example', 'https://evil.example']) {
            const begun = new URL((await fetch(`${f.origin}/api/v2/auth/begin?return=${encodeURIComponent(elsewhere)}`, { redirect: 'manual' })).headers.get('location')!);
            assert.equal(begun.searchParams.get('return'), '/', `begin: ${elsewhere}`);
            assert.equal((await callback(f.door.code('owner'), state, elsewhere)).headers.get('location'), '/', `callback: ${elsewhere}`);
        }

        // Signed in: the API answers; the apps menu lists only the apps this login may use
        assert.equal((await fetch(`${f.origin}/api/v2/accounts`, { headers: { Cookie: mailCookie } })).status, 200);
        const status1 = await (await fetch(`${f.origin}/api/v2/auth/status`, { headers: { Cookie: mailCookie } })).json();
        assert.deepEqual([status1.authenticated, status1.user.identifier], [true, 'owner']);
        assert.deepEqual(status1.family.apps.map((a: { id: string }) => a.id), ['mail'], 'Tasks is listed by the service, but not for this login');

        // Ended elsewhere: the next call is refused, and says why (a token Mail hasn't seen yet,
        // since a good answer is kept for 30 seconds)
        const later = cookiesOf(await callback(f.door.code('owner'), state)).find(c => c.startsWith('em_session='))!;
        f.door.tokens.get(later.slice('em_session='.length))!.ended = 'everywhere';
        const refused = await fetch(`${f.origin}/api/v2/accounts`, { headers: { Cookie: later } });
        assert.deepEqual([refused.status, (await refused.json()).reason], [401, 'everywhere']);

        // Someone else's Bassapps login: no way into this Mail
        const guest = await callback(f.door.code('guest'), state);
        assert.equal(guest.status, 403);
        assert.equal(cookiesOf(guest).some(c => c.startsWith('em_session=')), false, 'no cookie for them');
        f.door.tokens.set('guest-token', { username: 'guest' });
        const guestCall = await fetch(`${f.origin}/api/v2/accounts`, { headers: { Cookie: 'em_session=guest-token' } });
        assert.deepEqual([guestCall.status, (await guestCall.json()).reason], [401, 'no-access'], 'a token for another login is refused too');

        // Notices from the service (the new sign-in email): only with the secret
        assert.equal((await fetch(`${f.origin}/internal/v1/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"subject":"x","text":"y"}' })).status, 403);
        const sent = await fetch(`${f.origin}/internal/v1/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Door-Secret': f.secret }, body: '{"subject":"New sign-in to Bassapps","text":"A computer..."}' });
        assert.equal(sent.status, 200);
        assert.equal(f.notices.length, 1);

        // Signing out ends this computer's session at the service
        assert.equal((await fetch(`${f.origin}/api/v2/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: mailCookie }, body: '{}' })).status, 200);
        assert.equal(f.door.tokens.get(mailCookie.slice('em_session='.length))!.ended, 'signed-out');

        // The sign-in service down: "can't reach", never signed in
        f.door.server.close();
        f.door.tokens.set('unseen', { username: 'owner' });
        assert.equal((await fetch(`${f.origin}/api/v2/accounts`, { headers: { Cookie: 'em_session=unseen' } })).status, 503);
    } finally {
        f.close();
    }
});
