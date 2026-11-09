/**
 * Entrance animation for new arrivals only (Explore 1, 5c). A list's first draw is instant: on
 * mount, on an account switch, on coming back to a screen. Only a card that arrives while its list
 * is already showing (new mail, an Undo putting a card back, a page appended by scrolling)
 * animates in. A row a virtual list mounts while scrolling was already in the list, so it doesn't.
 * Nothing animates under reduced motion.
 */
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

export class Arrivals {
    private showing = false;
    private seen = new Set<string>();
    /** After each draw: whether the list is showing, and the cards it holds. */
    update(showing: boolean, ids: string[]): void {
        this.showing = showing;
        this.seen = new Set(ids);
    }
    /** A card mounting now: did it arrive while the list was showing without it? */
    arrived(id: string): boolean {
        return this.showing && !this.seen.has(id);
    }
}

/** For a list: `ready` once its first page is on screen (false while it loads from empty). */
export function useArrivals(ready: boolean, items: { id: string }[]): Arrivals {
    const [arrivals] = useState(() => new Arrivals());
    useEffect(() => {
        arrivals.update(ready, items.map(i => i.id));
    }, [arrivals, ready, items]);
    return arrivals;
}

/** For a card: whether it should animate in. */
export function useEntrance(arrivals: Arrivals | undefined, id: string): boolean {
    const reduced = useReducedMotion();
    const [arrived] = useState(() => !!arrivals?.arrived(id));
    return arrived && !reduced;
}
