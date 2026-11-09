/**
 * Conversations being moved right now. A dragged card disappears at once from every list; it
 * stays hidden until a list has fetched from the engine after the engine accepted the move
 * (from then on the engine's own answer no longer contains it). If the engine refuses the move,
 * the card comes straight back.
 */
import { useSyncExternalStore } from 'react';

let lastTicket = 0;
/** Every list fetch takes a ticket when it starts. */
export const takeTicket = () => ++lastTicket;

// threadId → first ticket whose fetch reflects the move (Infinity until the engine accepted it)
const moving = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
    version++;
    for (const l of listeners) l();
}

export function markMoving(threadId: string): void {
    moving.set(threadId, Infinity);
    changed();
}

/** The engine accepted the move: lists that fetch from now on reflect it. */
export function settleMoving(threadId: string): void {
    if (!moving.has(threadId)) return;
    const after = lastTicket + 1;
    moving.set(threadId, after);
    changed();
    setTimeout(() => {
        if (moving.get(threadId) === after) {
            moving.delete(threadId);
            changed();
        }
    }, 60_000);
}

/** The engine refused: show the card again. */
export function cancelMoving(threadId: string): void {
    if (moving.delete(threadId)) changed();
}

/** Whether a list showing the result of the fetch with this ticket should hide the thread. */
export function isHidden(threadId: string, shownTicket: number): boolean {
    const after = moving.get(threadId);
    return after !== undefined && shownTicket < after;
}

export function useMovingVersion(): number {
    return useSyncExternalStore(
        l => { listeners.add(l); return () => listeners.delete(l); },
        () => version,
    );
}
