/**
 * Up next on home (Explore 1): the conversations in buckets marked "Show on home" and every draft,
 * newest first, from one engine answer (GET …/home) asked for alongside the Inbox list, so home
 * can show both at once. Like the lists, it asks again whenever the account's state token changes,
 * and cards being moved are hidden at once (api/moving.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, acct } from '../api/client';
import { useAccountState, useSessionEpoch } from '../api/events';
import { isHidden, takeTicket, useMovingVersion } from '../api/moving';
import type { DraftSummary, HomePage, ThreadCard } from '../api/types';

export type UpNextThread = { kind: 'thread'; key: string; time: number; thread: ThreadCard; bucket: { id: string; label: string } };
export type UpNextDraft = { kind: 'draft'; key: string; time: number; draft: DraftSummary };
export type UpNextItem = UpNextThread | UpNextDraft;

const timeOf = (iso: string | null) => (iso ? Date.parse(iso) : 0) || 0;

export function useUpNext(accountId: string | null): { items: UpNextItem[]; ready: boolean } {
    const state = useAccountState(accountId);
    const sessionEpoch = useSessionEpoch();
    const movingVersion = useMovingVersion();
    const [shown, setShown] = useState<{ accountId: string; ticket: number; home: HomePage | null } | null>(null);
    const shownTicket = useRef(0);

    useEffect(() => {
        if (!accountId) return;
        const ticket = takeTicket();
        api.get<HomePage>(`${acct(accountId)}/home`)
            .then(home => {
                // Answers may arrive out of order: show any answer newer than the one on screen.
                if (ticket < shownTicket.current) return;
                shownTicket.current = ticket;
                setShown({ accountId, ticket, home });
            })
            .catch(err => {
                console.error('Could not load Up next:', err);
                // Keep what is on screen; with nothing yet, don't hold home back (an empty row).
                setShown(prev => (prev?.accountId === accountId ? prev : { accountId, ticket, home: null }));
            });
    }, [accountId, state, sessionEpoch]);

    return useMemo(() => {
        if (!accountId || shown?.accountId !== accountId) return { items: [], ready: false };
        const items: UpNextItem[] = [];
        for (const bucket of shown.home?.buckets ?? []) {
            for (const thread of bucket.threads) {
                if (isHidden(thread.threadId, shown.ticket)) continue;
                items.push({ kind: 'thread', key: `t:${thread.threadId}`, time: timeOf(thread.latestDate), thread, bucket: { id: bucket.path, label: bucket.name } });
            }
        }
        for (const draft of shown.home?.drafts ?? []) items.push({ kind: 'draft', key: `d:${draft.msgKey}`, time: timeOf(draft.date), draft });
        return { items: items.sort((a, b) => b.time - a.time), ready: true };
        // movingVersion: re-filter when a move starts, settles or is refused
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shown, accountId, movingVersion]);
}
