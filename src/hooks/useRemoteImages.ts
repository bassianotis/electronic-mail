/**
 * Outside images for one message: hidden until the person loads them, then loading, then loaded.
 * The choice is per message and lasts for this session, so opening the message again shows its
 * images. "Loading images…" stays at least 300ms so the strip doesn't flicker.
 */
import { useCallback, useRef, useState } from 'react';
import type { ImagesState } from '../components/Views/ImagesStrip';

const MIN_LOADING_MS = 300;
/** Messages whose images were loaded this session (account:msgKey). */
const loadedThisSession = new Set<string>();

export function useRemoteImages(key: string) {
    const [current, setCurrent] = useState<{ key: string; state: ImagesState }>(() => ({ key, state: loadedThisSession.has(key) ? 'loaded' : 'hidden' }));
    const state: ImagesState = current.key === key ? current.state : loadedThisSession.has(key) ? 'loaded' : 'hidden';
    const startedAt = useRef(0);

    const load = useCallback(() => {
        startedAt.current = Date.now();
        setCurrent({ key, state: 'loading' });
    }, [key]);

    /** Every image has loaded or failed: the strip reads "Images loaded" (failed ones keep their placeholder). */
    const settled = useCallback(() => {
        const wait = Math.max(0, MIN_LOADING_MS - (Date.now() - startedAt.current));
        setTimeout(() => {
            loadedThisSession.add(key);
            setCurrent(c => (c.key === key ? { key, state: 'loaded' } : c));
        }, wait);
    }, [key]);

    return { state, load, settled, allowed: state !== 'hidden' };
}
