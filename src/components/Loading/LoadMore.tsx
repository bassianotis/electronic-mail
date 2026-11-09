/**
 * Load on scroll (Explore 1, 6): a marker about 600px before the end of a list asks for the next
 * page as it comes near the screen. While that page loads, three skeleton rows are appended; if
 * it fails, "Couldn't load more." with Try again, and everything already loaded stays. The end of
 * the list is just its last card.
 */
import React, { useEffect, useRef } from 'react';
import type { ThreadList } from '../../hooks/useThreadList';
import { AfterDelay, ListFailure } from './Skeletons';

export const LoadMore: React.FC<{ list: ThreadList; skeletons: React.ReactNode }> = ({ list, skeletons }) => {
    const marker = useRef<HTMLDivElement>(null);
    const { hasMore, loadingMore, moreFailed, loadMore, threads } = list;

    // Observed afresh after every page, so a page too short to fill the screen asks for the next.
    useEffect(() => {
        const el = marker.current;
        if (!el || !hasMore || loadingMore || moreFailed) return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) loadMore();
        }, { rootMargin: '0px 0px 600px 0px' });
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, loadingMore, moreFailed, loadMore, threads.length]);

    if (!hasMore) return null;
    return (
        <>
            {moreFailed ? (
                <ListFailure onRetry={loadMore} />
            ) : loadingMore && (
                <div aria-busy="true">
                    <AfterDelay>{skeletons}</AfterDelay>
                </div>
            )}
            <div ref={marker} aria-hidden="true" style={{ height: 1 }} />
        </>
    );
};
