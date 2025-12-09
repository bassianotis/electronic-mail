/**
 * useDragToBucket hook
 * 
 * Handles drag-and-drop logic for moving emails to buckets.
 * Provides handlers for drag start/drag/end and bucket detection.
 */

import { useRef, useState, useCallback } from 'react';
import type { Bucket } from '../store/mailStore';
import { useDragDrop } from '../context/DragDropContext';

interface DragInfo {
    point: { x: number; y: number };
}

interface UseDragToBucketOptions {
    /** Available buckets for drop targets */
    buckets: Bucket[];
    /** Callback when email is dropped on a bucket */
    onBucket: (bucketId: string) => void;
    /** Callback when email is dropped on archive */
    onArchive?: () => void;
    /** Callback when email is dropped on inbox */
    onInbox?: () => void;
}

interface UseDragToBucketReturn {
    /** Whether currently dragging */
    isDragging: boolean;
    /** Whether currently over a bucket */
    isOverBucket: boolean;
    /** Props to spread on the draggable element */
    dragHandlers: {
        onDragStart: () => void;
        onDrag: (event: any, info: DragInfo) => void;
        onDragEnd: (event: any, info: DragInfo) => void;
    };
}

/**
 * Hook that handles drag-and-drop for moving emails to buckets.
 * 
 * @example
 * ```tsx
 * const { dragHandlers, isOverBucket } = useDragToBucket({
 *   buckets,
 *   onBucket: (bucketId) => moveEmail(email.id, bucketId),
 *   onArchive: () => archiveEmail(email.id)
 * });
 * 
 * <motion.div
 *   drag
 *   onDragStart={dragHandlers.onDragStart}
 *   onDrag={dragHandlers.onDrag}
 *   onDragEnd={dragHandlers.onDragEnd}
 *   whileDrag={{ opacity: isOverBucket ? 0.15 : 0.5 }}
 * />
 * ```
 */
export function useDragToBucket(options: UseDragToBucketOptions): UseDragToBucketReturn {
    const { buckets, onBucket, onArchive, onInbox } = options;
    const { setHoveredBucketId, setIsDragging } = useDragDrop();

    const [isOverBucket, setIsOverBucket] = useState(false);
    const isDraggingRef = useRef(false);

    /**
     * Check if a point is within an element's bounds
     */
    const isPointInElement = useCallback((point: { x: number; y: number }, elementId: string): boolean => {
        const element = document.getElementById(elementId);
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        return (
            point.x >= rect.left &&
            point.x <= rect.right &&
            point.y >= rect.top &&
            point.y <= rect.bottom
        );
    }, []);

    /**
     * Find which bucket (if any) the point is over
     */
    const findTargetBucket = useCallback((point: { x: number; y: number }): string | null => {
        // Check archive target
        if (isPointInElement(point, 'archive-target')) {
            return 'archive';
        }

        // Check inbox target
        if (isPointInElement(point, 'inbox-target')) {
            return 'inbox';
        }

        // Check bucket targets
        const targetBuckets = buckets.filter(b => b.id !== 'inbox');
        for (const bucket of targetBuckets) {
            if (isPointInElement(point, `bucket-target-${bucket.id}`)) {
                return bucket.id;
            }
        }

        return null;
    }, [buckets, isPointInElement]);

    const handleDragStart = useCallback(() => {
        isDraggingRef.current = true;
        setIsDragging(true);
    }, [setIsDragging]);

    const handleDrag = useCallback((_event: any, info: DragInfo) => {
        const targetId = findTargetBucket(info.point);
        setHoveredBucketId(targetId);
        setIsOverBucket(targetId !== null);
    }, [findTargetBucket, setHoveredBucketId]);

    const handleDragEnd = useCallback((_event: any, info: DragInfo) => {
        setIsDragging(false);
        setHoveredBucketId(null);
        setIsOverBucket(false);

        const targetId = findTargetBucket(info.point);

        if (targetId === 'archive' && onArchive) {
            onArchive();
        } else if (targetId === 'inbox' && onInbox) {
            onInbox();
        } else if (targetId && targetId !== 'archive' && targetId !== 'inbox') {
            onBucket(targetId);
        }

        // Reset dragging ref after a short delay to prevent click handling
        setTimeout(() => {
            isDraggingRef.current = false;
        }, 100);
    }, [findTargetBucket, onArchive, onInbox, onBucket, setIsDragging, setHoveredBucketId]);

    return {
        isDragging: isDraggingRef.current,
        isOverBucket,
        dragHandlers: {
            onDragStart: handleDragStart,
            onDrag: handleDrag,
            onDragEnd: handleDragEnd
        }
    };
}

export default useDragToBucket;
