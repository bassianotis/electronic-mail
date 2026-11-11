/**
 * Conversations fetched ahead: the previous and next ones in the list a conversation was opened
 * from, so moving to one shows it at once (docs/design/motion-audit.md, problem a). A conversation
 * opened from here is still fetched again, so what it shows is never older than a moment.
 */
import { api, paths } from './client';
import { loadBody } from './bodies';
import type { ThreadDetail } from './types';

const KEEP = 12;
const known = new Map<string, ThreadDetail>();
const asked = new Set<string>();
const keyOf = (accountId: string, threadId: string) => `${accountId}|${threadId}`;

/** A conversation fetched ahead (or opened lately), if there is one. */
export function cachedThread(accountId: string | null, threadId: string): ThreadDetail | null {
    return accountId ? known.get(keyOf(accountId, threadId)) ?? null : null;
}

/** Keeps a conversation's latest answer, the most recent last. */
export function rememberThread(accountId: string, threadId: string, detail: ThreadDetail): void {
    const key = keyOf(accountId, threadId);
    known.delete(key);
    known.set(key, detail);
    while (known.size > KEEP) known.delete(known.keys().next().value!);
}

/** Fetches a conversation and its newest message's body in the background (once per conversation). */
export function prefetchThread(accountId: string, threadId: string): void {
    const key = keyOf(accountId, threadId);
    if (known.has(key) || asked.has(key)) return;
    asked.add(key);
    api.get<ThreadDetail>(paths.thread(accountId, threadId))
        .then(detail => {
            rememberThread(accountId, threadId, detail);
            const newest = detail.messages[detail.messages.length - 1];
            if (newest) loadBody(accountId, newest.msgKey).catch(() => { /* shown when it opens */ });
        })
        .catch(() => { /* fetched when it opens */ })
        .finally(() => asked.delete(key));
}
