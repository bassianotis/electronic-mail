/**
 * useBuckets Hook
 * Manages bucket CRUD operations and reordering
 */
import { useState, useCallback } from 'react';
import { type Bucket, type ApiBucketResponse } from '../store/mailStore';

export interface UseBucketsReturn {
    buckets: Bucket[];
    setBuckets: React.Dispatch<React.SetStateAction<Bucket[]>>;
    fetchBuckets: () => Promise<void>;
    refetchBuckets: () => Promise<void>;
    addBucket: (label: string, color: string) => Promise<void>;
    updateBucket: (id: string, updates: Partial<Bucket>) => Promise<void>;
    deleteBucket: (id: string) => Promise<void>;
    reorderBuckets: (bucketIds: string[]) => Promise<void>;
}

export function useBuckets(): UseBucketsReturn {
    const [buckets, setBuckets] = useState<Bucket[]>([]);

    const fetchBuckets = useCallback(async () => {
        try {
            const res = await fetch('/api/buckets');
            if (res.ok) {
                const data: ApiBucketResponse[] = await res.json();
                const mapped: Bucket[] = data.map((b) => ({
                    ...b,
                    sortOrder: b.sort_order
                }));
                setBuckets(mapped);
            }
        } catch (err) {
            console.error('Error fetching buckets:', err);
        }
    }, []);

    const refetchBuckets = useCallback(async () => {
        await fetchBuckets();
    }, [fetchBuckets]);

    const addBucket = useCallback(async (label: string, color: string) => {
        // Find highest sort_order to add new bucket at end
        const maxSortOrder = buckets.reduce((max, b) =>
            Math.max(max, b.sortOrder ?? 0), -1
        );

        const newBucket: Bucket = {
            id: `bucket_${Date.now()}`,
            label,
            color,
            count: 0,
            sortOrder: maxSortOrder + 1
        };

        // Optimistic update
        setBuckets(prev => [...prev, newBucket]);

        try {
            await fetch('/api/buckets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newBucket)
            });
            await refetchBuckets();
        } catch (err) {
            console.error('Failed to create bucket:', err);
        }
    }, [buckets, refetchBuckets]);

    const updateBucket = useCallback(async (id: string, updates: Partial<Bucket>) => {
        setBuckets(prev => prev.map(b => {
            if (b.id === id) {
                return { ...b, ...updates };
            }
            return b;
        }));

        const bucket = buckets.find(b => b.id === id);
        if (bucket) {
            try {
                await fetch(`/api/buckets/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...bucket, ...updates })
                });
            } catch (err) {
                console.error('Failed to update bucket:', err);
            }
        }
    }, [buckets]);

    const deleteBucket = useCallback(async (id: string) => {
        setBuckets(prev => prev.filter(b => b.id !== id));
        try {
            await fetch(`/api/buckets/${id}`, { method: 'DELETE' });
        } catch (err) {
            console.error('Failed to delete bucket:', err);
        }
    }, []);

    const reorderBuckets = useCallback(async (bucketIds: string[]) => {
        // Optimistic update
        const reorderedBuckets = bucketIds.map((id, index) => {
            const bucket = buckets.find(b => b.id === id);
            return bucket ? { ...bucket, sortOrder: index } : null;
        }).filter(Boolean) as Bucket[];
        setBuckets(reorderedBuckets);

        try {
            const bucketUpdates = bucketIds.map((id, index) => ({
                id,
                sort_order: index
            }));

            const res = await fetch('/api/buckets/reorder', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buckets: bucketUpdates })
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error('❌ API Error:', errorText);
            }
        } catch (err) {
            console.error('❌ Failed to reorder buckets:', err);
        }
    }, [buckets]);

    return {
        buckets,
        setBuckets,
        fetchBuckets,
        refetchBuckets,
        addBucket,
        updateBucket,
        deleteBucket,
        reorderBuckets
    };
}
