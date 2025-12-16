/**
 * useThreads Hook
 * Manages thread state and provides thread operations
 */
import { useState, useCallback } from 'react';
import type { ThreadGroup } from '../../shared/types/email';

export const useThreads = () => {
    const [threads, setThreads] = useState<ThreadGroup[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    /**
     * Fetch inbox threads (unbucketed, unarchived)
     */
    const fetchInboxThreads = useCallback(async (): Promise<ThreadGroup[]> => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/threads/inbox');
            if (!res.ok) throw new Error('Failed to fetch inbox threads');
            const data = await res.json();
            const threadList = data.threads || [];
            setThreads(threadList);
            return threadList;
        } catch (err) {
            console.error('[useThreads] Error fetching inbox threads:', err);
            return [];
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Fetch threads for a specific bucket
     */
    const fetchBucketThreads = useCallback(async (bucketId: string): Promise<ThreadGroup[]> => {
        try {
            const res = await fetch(`/api/threads/bucket/${encodeURIComponent(bucketId)}`);
            if (!res.ok) throw new Error('Failed to fetch bucket threads');
            const data = await res.json();
            return data.threads || [];
        } catch (err) {
            console.error('[useThreads] Error fetching bucket threads:', err);
            return [];
        }
    }, []);

    /**
     * Fetch archived threads
     */
    const fetchArchiveThreads = useCallback(async (): Promise<ThreadGroup[]> => {
        try {
            const res = await fetch('/api/threads/archive');
            if (!res.ok) throw new Error('Failed to fetch archive threads');
            const data = await res.json();
            return data.threads || [];
        } catch (err) {
            console.error('[useThreads] Error fetching archive threads:', err);
            return [];
        }
    }, []);

    /**
     * Move entire thread to a bucket
     */
    const bucketThread = useCallback(async (threadId: string, bucketId: string): Promise<boolean> => {
        // Optimistic update - remove from inbox threads
        setThreads(prev => prev.filter(t => t.threadId !== threadId));

        try {
            const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/bucket`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucketId })
            });
            return res.ok;
        } catch (err) {
            console.error('[useThreads] Error bucketing thread:', err);
            return false;
        }
    }, []);

    /**
     * Archive entire thread
     */
    const archiveThread = useCallback(async (threadId: string): Promise<boolean> => {
        // Optimistic update
        setThreads(prev => prev.filter(t => t.threadId !== threadId));

        try {
            const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/archive`, {
                method: 'POST'
            });
            return res.ok;
        } catch (err) {
            console.error('[useThreads] Error archiving thread:', err);
            return false;
        }
    }, []);

    /**
     * Unarchive entire thread
     */
    const unarchiveThread = useCallback(async (threadId: string, targetLocation: string): Promise<boolean> => {
        try {
            const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/unarchive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetLocation })
            });
            return res.ok;
        } catch (err) {
            console.error('[useThreads] Error unarchiving thread:', err);
            return false;
        }
    }, []);

    /**
     * Return thread to its original bucket
     */
    const returnThreadToBucket = useCallback(async (threadId: string): Promise<boolean> => {
        const thread = threads.find(t => t.threadId === threadId);
        if (!thread?.originalBucketId) {
            console.error('[useThreads] Thread has no original bucket');
            return false;
        }

        // Optimistic update
        setThreads(prev => prev.filter(t => t.threadId !== threadId));

        try {
            const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/bucket`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucketId: thread.originalBucketId })
            });
            return res.ok;
        } catch (err) {
            console.error('[useThreads] Error returning thread to bucket:', err);
            return false;
        }
    }, [threads]);

    /**
     * Unbucket thread (move back to inbox)
     */
    const unbucketThread = useCallback(async (threadId: string): Promise<boolean> => {
        try {
            const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/unbucket`, {
                method: 'POST'
            });
            return res.ok;
        } catch (err) {
            console.error('[useThreads] Error unbucketing thread:', err);
            return false;
        }
    }, []);

    return {
        threads,
        isLoading,
        fetchInboxThreads,
        fetchBucketThreads,
        fetchArchiveThreads,
        bucketThread,
        archiveThread,
        unarchiveThread,
        returnThreadToBucket,
        unbucketThread
    };
};
