/**
 * Who's signed in with the shared Bassapps sign-in, and the family of apps (for the apps menu);
 * null with the engine's own login. Set once from /auth/status at start.
 */
import { useSyncExternalStore } from 'react';
import type { AuthStatus } from './types';

export interface SignedInFamily {
    username: string;
    apps: { id: string; name: string; url: string }[];
    accountUrl: string;
    current: string;
}

let family: SignedInFamily | null = null;
const listeners = new Set<() => void>();

export function setFamilyFrom(status: AuthStatus): void {
    family = status.mode === 'door' && status.authenticated && status.family && status.user
        ? { username: status.user.identifier, ...status.family }
        : null;
    for (const l of listeners) l();
}

export const useFamily = (): SignedInFamily | null => useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => family,
);

/**
 * Why this computer was signed out, as the screens put it: another
 * computer used Account (Sign out everywhere, or signed this one out), the passphrase was changed on
 * another computer, or anything else (unused for 30 days, signed out from this computer).
 */
export type SignedOutKind = 'ended' | 'elsewhere' | 'passphrase';

export function signedOutKind(reason: string | null | undefined): SignedOutKind {
    return reason === 'everywhere' || reason === 'removed' ? 'elsewhere' : reason === 'passphrase' ? 'passphrase' : 'ended';
}

/** The sign-in page's notice for each (its ?reason=). */
export const SIGN_IN_REASON: Record<SignedOutKind, string> = { ended: 'ended', elsewhere: 'everywhere', passphrase: 'passphrase' };

/** Off to the shared sign-in page, coming back to `returnPath` (with why, for its banner). */
export function signInAgain(returnPath: string, reason?: string | null): void {
    const query = new URLSearchParams({ return: returnPath });
    if (reason) query.set('reason', reason);
    window.location.assign(`/api/v2/auth/begin?${query}`);
}
