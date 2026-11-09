/**
 * Whether the app's own server (the engine) answers. This is not the mail servers: their state is
 * the pill in the top bar. A request that can't connect, or that a proxy answers on the engine's
 * behalf (502/503/504, or Vite's plain 500), marks the server unreachable. It's then asked again
 * quietly after 5, 10 and 20 seconds, and every 30 seconds after that. The banner shows only after
 * about 10 seconds of failure, so a blip shows nothing. Any answer from the engine itself (even "not
 * signed in") marks it reachable again.
 */
import { useSyncExternalStore } from 'react';

const RETRY_STEPS_MS = [5_000, 10_000, 20_000, 30_000];
const SHOW_AFTER_MS = 10_000;

export interface ReachabilityState {
    /** Failing for long enough to tell the person (the banner, and actions that need the server off). */
    unreachable: boolean;
    /** When the next quiet try happens (epoch ms); null while one is under way. */
    nextTryAt: number | null;
}

/** A response a proxy gave in the engine's place: the engine itself always answers in JSON. */
export const isGatewayFailure = (status: number, contentType: string | null) =>
    status === 502 || status === 503 || status === 504 || (status === 500 && !contentType?.includes('json'));

class ServerReachability {
    private failingSince: number | null = null;
    private step = 0;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private showTimer: ReturnType<typeof setTimeout> | null = null;
    private probing = false;
    private state: ReachabilityState = { unreachable: false, nextTryAt: null };
    private readonly listeners = new Set<() => void>();
    private readonly recoveryListeners = new Set<(afterBanner: boolean) => void>();

    /** Failing right now, banner or not (a blip counts). */
    isFailing(): boolean {
        return this.failingSince !== null;
    }

    failed(): void {
        if (this.failingSince !== null) return;
        this.failingSince = Date.now();
        this.step = 0;
        this.showTimer = setTimeout(() => {
            if (this.failingSince !== null) this.set({ unreachable: true });
        }, SHOW_AFTER_MS);
        this.scheduleTry();
    }

    succeeded(): void {
        if (this.failingSince === null) return;
        const afterBanner = this.state.unreachable;
        this.failingSince = null;
        this.clearTimers();
        this.set({ unreachable: false, nextTryAt: null });
        for (const l of this.recoveryListeners) l(afterBanner);
    }

    /** "Try now": ask at once instead of waiting for the countdown. */
    tryNow(): void {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        void this.probe();
    }

    /** Called when the server answers again; `afterBanner` says whether the banner was showing. */
    onRecovered(l: (afterBanner: boolean) => void): () => void {
        this.recoveryListeners.add(l);
        return () => { this.recoveryListeners.delete(l); };
    }

    subscribe = (l: () => void): (() => void) => {
        this.listeners.add(l);
        return () => { this.listeners.delete(l); };
    };

    getSnapshot = () => this.state;

    private scheduleTry(): void {
        const delay = RETRY_STEPS_MS[Math.min(this.step, RETRY_STEPS_MS.length - 1)];
        this.step++;
        this.set({ nextTryAt: Date.now() + delay });
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.probe();
        }, delay);
    }

    private async probe(): Promise<void> {
        if (this.probing || this.failingSince === null) return;
        this.probing = true;
        this.set({ nextTryAt: null });
        let ok = false;
        try {
            const res = await fetch('/api/v2/auth/status', { credentials: 'same-origin', cache: 'no-store' });
            ok = !isGatewayFailure(res.status, res.headers.get('content-type'));
        } catch {
            ok = false;
        }
        this.probing = false;
        if (ok) this.succeeded();
        else if (this.failingSince !== null) this.scheduleTry();
    }

    private clearTimers(): void {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        if (this.showTimer) clearTimeout(this.showTimer);
        this.retryTimer = null;
        this.showTimer = null;
    }

    private set(patch: Partial<ReachabilityState>): void {
        this.state = { ...this.state, ...patch };
        for (const l of this.listeners) l();
    }
}

export const reachability = new ServerReachability();

export const useReachability = (): ReachabilityState =>
    useSyncExternalStore(reachability.subscribe, reachability.getSnapshot);

/** Shorthand for the actions that need the server: disabled while the banner shows. */
export const useServerUnreachable = (): boolean => useReachability().unreachable;
