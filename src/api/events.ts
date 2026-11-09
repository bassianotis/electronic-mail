/**
 * Live updates, JMAP-style (RFC 8620 §7.3): the engine pushes each account's new state token
 * over one Server-Sent Events stream, and whatever is on screen re-fetches when the token for its
 * account changes. Nothing is patched by hand on the client, so a number on screen can only ever
 * be one the engine computed. EventSource reconnects by itself after a network drop; the engine
 * then sends every token again, so a view that missed something while offline refreshes. When the
 * engine refuses the stream instead (the session ended), it asks whether we are still logged in;
 * with the shared sign-in, the engine also says so on the open stream ('signed-out') and closes it.
 */
import { useSyncExternalStore } from 'react';
import { api, urls, AUTH_REQUIRED_EVENT, SESSION_RESTORED_EVENT } from './client';
import { reachability } from './reachability';
import type { ConnectionState, OutboxItem, TaskEvent } from './types';

type Listener = () => void;

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 30_000;

export interface OutboxEvent {
    accountId: string;
    id: OutboxItem['id'];
    status: OutboxItem['status'];
    error: string | null;
}

class EngineEvents {
    private source: EventSource | null = null;
    private readonly tokens = new Map<string, string>();
    private readonly connection = new Map<string, ConnectionState>();
    private readonly listeners = new Set<Listener>();
    private readonly taskListeners = new Set<(e: TaskEvent) => void>();
    private readonly outboxListeners = new Set<(e: OutboxEvent) => void>();
    private readonly accountListeners = new Set<Listener>();
    private snapshot = { tokens: this.tokens, version: 0 };
    private wanted = false;
    private retryMs = RETRY_MIN_MS;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    /** Counts logins after the session ended; screens re-fetch when it changes. */
    sessionEpoch = 0;

    connect(): void {
        this.wanted = true;
        if (this.source) return;
        const source = new EventSource(urls.events, { withCredentials: true });
        source.onopen = () => {
            this.retryMs = RETRY_MIN_MS;
            reachability.succeeded();
        };
        source.onerror = () => {
            // A network drop leaves the stream reconnecting by itself (and the server counts as
            // unreachable until it's back). An HTTP error closes it for good: either the session
            // ended (then log in again) or the engine is having trouble.
            if (source.readyState === EventSource.CONNECTING) reachability.failed();
            if (source.readyState !== EventSource.CLOSED || this.source !== source) return;
            this.source = null;
            api.get<{ authenticated: boolean; reason?: string | null }>('/auth/status')
                .then(s => s.authenticated ? this.reconnectLater() : window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { reason: s.reason ?? null } })))
                .catch(() => this.reconnectLater());
        };
        source.addEventListener('state', e => {
            const data = JSON.parse((e as MessageEvent).data) as { changed: Record<string, { state: string; status?: ConnectionState }> };
            for (const [account, v] of Object.entries(data.changed)) {
                this.tokens.set(account, v.state);
                if (v.status) this.connection.set(account, v.status);
            }
            this.changed();
        });
        source.addEventListener('status', e => {
            const s = JSON.parse((e as MessageEvent).data) as { account: string; state: ConnectionState; stateToken: string };
            this.connection.set(s.account, s.state);
            this.changed();
        });
        source.addEventListener('task', e => {
            const t = JSON.parse((e as MessageEvent).data) as TaskEvent;
            for (const l of this.taskListeners) l(t);
        });
        source.addEventListener('outbox', e => {
            const o = JSON.parse((e as MessageEvent).data) as OutboxEvent;
            for (const l of this.outboxListeners) l(o);
        });
        source.addEventListener('signed-out', e => {
            // The engine closed the stream because the session ended elsewhere: no reconnecting
            const { reason } = JSON.parse((e as MessageEvent).data) as { reason: string | null };
            source.close();
            if (this.source === source) this.source = null;
            window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { reason } }));
        });
        source.addEventListener('accounts', () => {
            for (const l of this.accountListeners) l();
        });
        this.source = source;
    }

    disconnect(): void {
        this.wanted = false;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.source?.close();
        this.source = null;
    }

    /** Logged in again after the session ended: reconnect, and let every screen fetch again. */
    sessionRestored(): void {
        this.sessionEpoch++;
        if (this.wanted && !this.source) this.connect();
        this.changed();
    }

    private reconnectLater(): void {
        if (!this.wanted || this.retryTimer) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.wanted && !this.source) this.connect();
        }, this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    }

    stateOf(account: string | null): string | undefined {
        return account ? this.tokens.get(account) : undefined;
    }

    connectionOf(account: string | null): ConnectionState | undefined {
        return account ? this.connection.get(account) : undefined;
    }

    subscribe = (l: Listener): (() => void) => {
        this.listeners.add(l);
        return () => this.listeners.delete(l);
    };

    getSnapshot = () => this.snapshot;

    onTask(l: (e: TaskEvent) => void): () => void {
        this.taskListeners.add(l);
        return () => this.taskListeners.delete(l);
    }

    onOutbox(l: (e: OutboxEvent) => void): () => void {
        this.outboxListeners.add(l);
        return () => this.outboxListeners.delete(l);
    }

    onAccounts(l: Listener): () => void {
        this.accountListeners.add(l);
        return () => this.accountListeners.delete(l);
    }

    /** A write's response carries the new token too: apply it at once instead of waiting for the stream. */
    noteState(account: string, token: string | undefined): void {
        const current = this.tokens.get(account);
        if (!token || current === token || (current && !isNewer(token, current))) return;
        this.tokens.set(account, token);
        this.changed();
    }

    private changed(): void {
        this.snapshot = { tokens: this.tokens, version: this.snapshot.version + 1 };
        for (const l of this.listeners) l();
    }
}

/** Tokens are "<engine start>.<version>": a write's reply must not undo a newer pushed token. */
function isNewer(token: string, than: string): boolean {
    const [boot, version] = token.split('.');
    const [thanBoot, thanVersion] = than.split('.');
    return boot !== thanBoot || Number(version) > Number(thanVersion);
}

export const engineEvents = new EngineEvents();
window.addEventListener(SESSION_RESTORED_EVENT, () => engineEvents.sessionRestored());

/**
 * Changes each time the user logs in again after the session ended. Add it to a fetch's
 * dependencies so whatever failed while logged out loads again, without leaving the screen.
 */
export function useSessionEpoch(): number {
    useSyncExternalStore(engineEvents.subscribe, engineEvents.getSnapshot);
    return engineEvents.sessionEpoch;
}

/** The account's current state token; re-render (and re-fetch) when it changes. */
export function useAccountState(account: string | null): string | undefined {
    useSyncExternalStore(engineEvents.subscribe, engineEvents.getSnapshot);
    return engineEvents.stateOf(account);
}

/** Whether the account is connected to its mail server right now. */
export function useConnection(account: string | null): ConnectionState | undefined {
    useSyncExternalStore(engineEvents.subscribe, engineEvents.getSnapshot);
    return engineEvents.connectionOf(account);
}
