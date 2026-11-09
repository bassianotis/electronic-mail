/**
 * Message bodies, fetched once and kept for a while: a card that re-renders, or a reply that
 * quotes the message just read, never asks the engine twice. (The engine keeps its own, larger
 * cache, so a miss here is still fast.)
 */
import { useCallback, useEffect, useState } from 'react';
import { api, errorText, paths } from './client';
import { useSessionEpoch } from './events';
import type { MessageBody } from './types';

const KEEP = 60;
const cache = new Map<string, Promise<MessageBody>>();
// The same bodies once they have arrived, so a card showing one it has already seen (stepping
// back and forth through a conversation) draws it at once instead of a skeleton for a frame.
const arrived = new Map<string, MessageBody>();

export function loadBody(accountId: string, msgKey: string): Promise<MessageBody> {
    const key = `${accountId}|${msgKey}`;
    let body = cache.get(key);
    if (body) {
        cache.delete(key); // most recently used goes last
        cache.set(key, body);
        return body;
    }
    body = api.get<MessageBody>(paths.body(accountId, msgKey));
    cache.set(key, body);
    body.then(b => { if (cache.has(key)) arrived.set(key, b); }, () => cache.delete(key)); // a failure is not remembered: the next try asks again
    while (cache.size > KEEP) {
        const oldest = cache.keys().next().value!;
        cache.delete(oldest);
        arrived.delete(oldest);
    }
    return body;
}

export function useMessageBody(accountId: string | null, msgKey: string | null, enabled = true) {
    const [state, setState] = useState<{ key: string; body: MessageBody | null; error: string | null } | null>(null);
    const key = accountId && msgKey ? `${accountId}|${msgKey}` : '';
    const sessionEpoch = useSessionEpoch(); // a body that failed while logged out loads again after login
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!enabled || !accountId || !msgKey) return;
        let current = true;
        loadBody(accountId, msgKey)
            .then(body => { if (current) setState({ key, body, error: null }); })
            .catch(err => { if (current) setState({ key, body: null, error: errorText(err) }); });
        return () => { current = false; };
    }, [accountId, msgKey, enabled, key, sessionEpoch, attempt]);

    /** Asks again after a failure (a failure is never cached), showing it as loading meanwhile. */
    const retry = useCallback(() => {
        setState(null);
        setAttempt(n => n + 1);
    }, []);

    const mine = state?.key === key ? state : null;
    const known = !mine && enabled && key ? arrived.get(key) ?? null : null;
    return { body: mine?.body ?? known, error: mine?.error ?? null, loading: enabled && !!key && !mine && !known, retry };
}
