/**
 * The list a conversation was opened from, for previous / next (docs/design/reading-navigation-spec.md
 * §7): each list on screen (the Inbox, Up next, a bucket, Archive, search results) publishes its cards
 * in the order it shows them, under its own key, and the conversation view reads that list live. A
 * list that goes away (search closes as a result opens) keeps its last cards.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { Email } from '../store/mailStore';

export type ListKey = 'inbox' | 'upnext' | 'archive' | 'search' | `bucket:${string}`;

export interface ConversationList {
    cards: Email[];
    /** How many there are in all (more than `cards` when the list loads as you scroll). */
    total: number;
    hasMore: boolean;
    loadMore?: () => void;
}

const lists = new Map<ListKey, ConversationList>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** Publishes a list's cards (in the order shown) while the list is on screen. */
export function usePublishList(key: ListKey | null, cards: Email[], more?: { total?: number; hasMore?: boolean; loadMore?: () => void }) {
    const total = more?.total, hasMore = more?.hasMore ?? false, loadMore = more?.loadMore;
    useEffect(() => {
        if (!key) return;
        lists.set(key, { cards, total: Math.max(total ?? 0, cards.length), hasMore, loadMore });
        for (const listener of listeners) listener();
    }, [key, cards, total, hasMore, loadMore]);
}

/** The list published under `key`, kept up to date. */
export function useConversationList(key: ListKey | null | undefined): ConversationList | null {
    return useSyncExternalStore(subscribe, () => (key ? lists.get(key) ?? null : null));
}

/** Forgets every list (the account changed: they all belong to the other one). */
export function clearConversationLists() {
    lists.clear();
    for (const listener of listeners) listener();
}
