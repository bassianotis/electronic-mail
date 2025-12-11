/**
 * useThreads Hook
 * Manages thread state and operations for the email threading feature
 */
import { useState, useCallback } from 'react';
import type { ThreadGroup } from '../../shared/types/email';

export const useThreads = () => {
    const [threads, setThreads] = useState<ThreadGroup[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Fetch threads for inbox view
     */
    const fetchInboxThreads = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/threads/inbox', {
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error('Failed to fetch inbox threads');
            }
            const data = await response.json();
            setThreads(data.threads || []);
            return data.threads;
        } catch (err) {
            console.error('Error fetching inbox threads:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
            return [];
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Fetch threads for a specific bucket
     */
    const fetchBucketThreads = useCallback(async (bucketId: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/threads/bucket/${encodeURIComponent(bucketId)}`, {
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error('Failed to fetch bucket threads');
            }
            const data = await response.json();
            return data.threads || [];
        } catch (err) {
            console.error('Error fetching bucket threads:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
            return [];
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Fetch threads for archive view
     */
    const fetchArchiveThreads = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/threads/archive', {
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error('Failed to fetch archive threads');
            }
            const data = await response.json();
            return data.threads || [];
        } catch (err) {
            console.error('Error fetching archive threads:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
            return [];
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * Move a thread to a bucket
     */
    const bucketThread = useCallback(async (threadId: string, bucketId: string) => {
        try {
            const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/bucket`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucketId })
            });
            if (!response.ok) {
                throw new Error('Failed to move thread to bucket');
            }

            // Optimistically update local state
            setThreads(prev => prev.filter(t => t.threadId !== threadId));

            return true;
        } catch (err) {
            console.error('Error moving thread to bucket:', err);
            return false;
        }
    }, []);

    /**
     * Return a resurfaced thread to its original bucket
     */
    const returnThreadToBucket = useCallback(async (threadId: string) => {
        try {
            const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/return`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error('Failed to return thread to bucket');
            }

            // Optimistically update local state
            setThreads(prev => prev.filter(t => t.threadId !== threadId));

            return true;
        } catch (err) {
            console.error('Error returning thread to bucket:', err);
            return false;
        }
    }, []);

    /**
     * Archive a thread
     */
    const archiveThread = useCallback(async (threadId: string) => {
        // Optimistic update - remove from local state immediately
        setThreads(prev => prev.filter(t => t.threadId !== threadId));

        try {
            const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/archive`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error('Failed to archive thread');
                // TODO: Could add rollback on error
            }

            return true;
        } catch (err) {
            console.error('Error archiving thread:', err);
            // TODO: Rollback by re-fetching threads
            return false;
        }
    }, []);

    /**
     * Trigger a sync of sent emails for threading
     */
    const syncSentEmails = useCallback(async () => {
        try {
            const response = await fetch('/api/threads/sync-sent', {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error('Failed to sync sent emails');
            }
            const data = await response.json();
            console.log(`Synced ${data.count} sent emails`);
            return data.count;
        } catch (err) {
            console.error('Error syncing sent emails:', err);
            return 0;
        }
    }, []);

    /**
     * Backfill thread IDs for existing emails
     */
    const backfillThreadIds = useCallback(async () => {
        try {
            const response = await fetch('/api/threads/backfill', {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error('Failed to backfill thread IDs');
            }
            const data = await response.json();
            console.log(`Backfilled thread IDs for ${data.updated} emails`);
            return data.updated;
        } catch (err) {
            console.error('Error backfilling thread IDs:', err);
            return 0;
        }
    }, []);

    return {
        threads,
        setThreads,
        isLoading,
        error,
        fetchInboxThreads,
        fetchBucketThreads,
        fetchArchiveThreads,
        bucketThread,
        returnThreadToBucket,
        archiveThread,
        syncSentEmails,
        backfillThreadIds
    };
};
