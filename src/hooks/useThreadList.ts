/**
 * One list of conversations (the Inbox, a bucket, the Archive), straight from the engine.
 * It re-fetches whenever the account's state token changes, so moves made here, on the phone or
 * by a rule all show up the same way, and the count always comes from the same query as the
 * cards (docs/architecture.md, rule 2). Cards being moved are hidden at once (api/moving.ts).
 *
 * It loads a page at a time as the list is scrolled (Explore 1, 6): loadMore fetches just the
 * next page (by offset). A change refreshes the rows already loaded, from the top.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, acct, errorText } from '../api/client';
import { useAccountState, useSessionEpoch } from '../api/events';
import { isHidden, takeTicket, useMovingVersion } from '../api/moving';
import type { ThreadCard, ViewPage } from '../api/types';

/** The engine's largest page. */
const MAX_PAGE = 500;

export interface ThreadListQuery {
    location: string;
    /** Also the conversations holding only mail you sent (the Archive shows these). */
    withSentOnly?: boolean;
}

export interface ThreadList {
    threads: ThreadCard[];
    /** How many conversations the list holds in all (not just the loaded pages). */
    count: number;
    loading: boolean;
    error: string | null;
    hasMore: boolean;
    loadingMore: boolean;
    /** The last page asked for didn't load (the rest stays); loadMore tries it again. */
    moreFailed: boolean;
    loadMore: () => void;
}

/** `count` rows from `offset`, in as many requests as the engine's page limit needs. */
async function fetchRows(accountId: string, query: ThreadListQuery, offset: number, count: number): Promise<ViewPage> {
    const threads: ThreadCard[] = [];
    let page: ViewPage;
    do {
        const limit = Math.min(MAX_PAGE, count - threads.length);
        const params = new URLSearchParams({ location: query.location, limit: String(limit), offset: String(offset + threads.length) });
        if (query.withSentOnly) params.set('withSentOnly', '1');
        page = await api.get<ViewPage>(`${acct(accountId)}/threads?${params}`);
        threads.push(...page.threads);
        if (page.threads.length < limit) break;
    } while (threads.length < count);
    return { ...page, threads };
}

type Shown = { key: string; ticket: number; page: ViewPage };

export function useThreadList(accountId: string | null, query: ThreadListQuery | null, pageSize = 50): ThreadList {
    const state = useAccountState(accountId);
    const sessionEpoch = useSessionEpoch();
    const movingVersion = useMovingVersion();
    const [shown, setShown] = useState<Shown | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [more, setMore] = useState<'idle' | 'loading' | 'failed'>('idle');
    const shownRef = useRef<Shown | null>(null);
    const moreRef = useRef(false);
    const shownTicket = useRef(0);
    const location = query?.location ?? null;
    const withSentOnly = !!query?.withSentOnly;
    const queryKey = accountId && location ? `${accountId}|${location}|${withSentOnly ? 1 : 0}` : '';
    const shownKey = useRef('');

    const show = useCallback((next: Shown | null) => {
        shownRef.current = next;
        setShown(next);
    }, []);

    // From the top: the first page, or (after a change) as many rows as are already loaded.
    useEffect(() => {
        if (!queryKey || !accountId || !location) return;
        if (shownKey.current !== queryKey) {
            // A different list starts empty, from its first page.
            shownKey.current = queryKey;
            shownTicket.current = 0;
            show(null);
            setError(null);
            setMore('idle');
        }
        const key = queryKey;
        const ticket = takeTicket();
        const loaded = shownRef.current?.key === key ? shownRef.current.page.threads.length : 0;
        // Answers may arrive out of order; show any answer newer than the one on screen, so a
        // burst of changes (a big sync) never starves the list.
        fetchRows(accountId, { location, withSentOnly }, 0, Math.max(pageSize, loaded))
            .then(page => {
                if (shownKey.current !== key || ticket < shownTicket.current) return;
                shownTicket.current = ticket;
                show({ key, ticket, page });
                setError(null);
            })
            .catch(err => {
                if (shownKey.current === key && ticket >= shownTicket.current) setError(errorText(err));
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryKey, state, sessionEpoch, pageSize]);

    // The next page only, appended to what is loaded.
    const loadMore = useCallback(() => {
        const current = shownRef.current;
        if (!current || !accountId || !location || moreRef.current) return;
        if (current.page.threads.length >= current.page.count) return;
        moreRef.current = true;
        setMore('loading');
        fetchRows(accountId, { location, withSentOnly }, current.page.threads.length, pageSize)
            .then(page => {
                setMore('idle');
                const now = shownRef.current;
                // Refreshed from the top meanwhile: the offset is stale, and scrolling asks again.
                if (!now || now.key !== current.key || now.ticket !== current.ticket) return;
                const have = new Set(now.page.threads.map(t => t.threadId));
                show({ ...now, page: { ...page, threads: [...now.page.threads, ...page.threads.filter(t => !have.has(t.threadId))] } });
            })
            .catch(() => setMore('failed'))
            .finally(() => { moreRef.current = false; });
    }, [accountId, location, withSentOnly, pageSize, show]);

    return useMemo(() => {
        const all = shown?.page.threads ?? [];
        const threads = all.filter(t => !isHidden(t.threadId, shown!.ticket));
        return {
            threads,
            count: Math.max(0, (shown?.page.count ?? 0) - (all.length - threads.length)),
            loading: !shown && !error,
            error,
            hasMore: !!shown && shown.page.threads.length < shown.page.count,
            loadingMore: more === 'loading',
            moreFailed: more === 'failed',
            loadMore,
        };
        // movingVersion: re-filter when a move starts, settles or is refused
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shown, error, more, loadMore, movingVersion]);
}
