import React, { useRef, useState } from 'react';
import { motion, useDragControls } from 'framer-motion';
import type { ThreadGroup } from '../../../shared/types/email';
import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { Check, ArrowLeft, Mail } from 'lucide-react';

interface ThreadItemProps {
    thread: ThreadGroup;
    onBucket: (threadId: string, bucketId: string) => void;
    onArchive: (threadId: string) => void;
    onReturnToBucket?: (threadId: string) => void;
    onClick: () => void;
}

export const ThreadItem: React.FC<ThreadItemProps> = ({
    thread,
    onBucket,
    onArchive,
    onReturnToBucket,
    onClick
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const itemRef = useRef<HTMLDivElement>(null);
    const { setHoveredBucketId, setIsDragging } = useDragDrop();
    const { buckets } = useMail();
    const dragControls = useDragControls();
    const isDraggingRef = useRef(false);
    const [isOverBucket, setIsOverBucket] = useState(false);

    const { latestEmail, count, hasNewEmail, originalBucketId } = thread;
    const originalBucket = buckets.find(b => b.id === originalBucketId);

    const handleDragStart = () => {
        isDraggingRef.current = true;
        setIsDragging(true);
    };

    const handleDrag = (_event: any, info: any) => {
        const dropPoint = { x: info.point.x, y: info.point.y };
        let foundBucketId: string | null = null;

        // Check archive target
        const archiveElement = document.getElementById('archive-target');
        if (archiveElement) {
            const rect = archiveElement.getBoundingClientRect();
            if (
                dropPoint.x >= rect.left &&
                dropPoint.x <= rect.right &&
                dropPoint.y >= rect.top &&
                dropPoint.y <= rect.bottom
            ) {
                foundBucketId = 'archive';
                setHoveredBucketId(foundBucketId);
                return;
            }
        }

        // Check inbox target (Mail logo)
        const inboxElement = document.getElementById('inbox-target');
        if (inboxElement) {
            const rect = inboxElement.getBoundingClientRect();
            if (
                dropPoint.x >= rect.left &&
                dropPoint.x <= rect.right &&
                dropPoint.y >= rect.top &&
                dropPoint.y <= rect.bottom
            ) {
                foundBucketId = 'inbox';
                setHoveredBucketId(foundBucketId);
                setIsOverBucket(true);
                return;
            }
        }

        // Check bucket targets
        const targetBuckets = buckets.filter(b => b.id !== 'inbox');
        for (const bucket of targetBuckets) {
            const element = document.getElementById(`bucket-target-${bucket.id}`);
            if (element) {
                const rect = element.getBoundingClientRect();
                if (
                    dropPoint.x >= rect.left &&
                    dropPoint.x <= rect.right &&
                    dropPoint.y >= rect.top &&
                    dropPoint.y <= rect.bottom
                ) {
                    foundBucketId = bucket.id;
                    break;
                }
            }
        }
        setHoveredBucketId(foundBucketId);
        setIsOverBucket(foundBucketId !== null);
    };

    const handleDragEnd = (_event: any, info: any) => {
        setIsDragging(false);
        setHoveredBucketId(null);
        setIsOverBucket(false);

        const dropPoint = { x: info.point.x, y: info.point.y };
        let droppedBucketId: string | null = null;

        // Check archive target
        const archiveElement = document.getElementById('archive-target');
        if (archiveElement) {
            const rect = archiveElement.getBoundingClientRect();
            if (
                dropPoint.x >= rect.left &&
                dropPoint.x <= rect.right &&
                dropPoint.y >= rect.top &&
                dropPoint.y <= rect.bottom
            ) {
                onArchive(thread.threadId);
                setTimeout(() => {
                    isDraggingRef.current = false;
                }, 100);
                return;
            }
        }

        // Check inbox target (Mail logo)
        const inboxElement = document.getElementById('inbox-target');
        if (inboxElement) {
            const rect = inboxElement.getBoundingClientRect();
            if (
                dropPoint.x >= rect.left &&
                dropPoint.x <= rect.right &&
                dropPoint.y >= rect.top &&
                dropPoint.y <= rect.bottom
            ) {
                droppedBucketId = 'inbox';
            }
        }

        // Check bucket targets (if not dropped on inbox)
        const targetBuckets = buckets.filter(b => b.id !== 'inbox');
        for (const bucket of targetBuckets) {
            const element = document.getElementById(`bucket-target-${bucket.id}`);
            if (element) {
                const rect = element.getBoundingClientRect();
                if (
                    dropPoint.x >= rect.left &&
                    dropPoint.x <= rect.right &&
                    dropPoint.y >= rect.top &&
                    dropPoint.y <= rect.bottom
                ) {
                    droppedBucketId = bucket.id;
                    break;
                }
            }
        }

        if (droppedBucketId) {
            onBucket(thread.threadId, droppedBucketId);
        }

        setTimeout(() => {
            isDraggingRef.current = false;
        }, 100);
    };

    const handleClick = (e: React.MouseEvent) => {
        if (isDraggingRef.current) return;
        const target = e.target as HTMLElement;
        if (target.closest('a, button, input, textarea, [role="button"]')) {
            return;
        }
        onClick();
    };

    const handleArchive = (e: React.MouseEvent) => {
        e.stopPropagation();
        onArchive(thread.threadId);
    };

    const handleReturnToBucket = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onReturnToBucket) {
            onReturnToBucket(thread.threadId);
        }
    };

    // Format date with null safety
    const formatDate = (dateInput: Date | string | null | undefined) => {
        if (!dateInput) return 'Unknown date';
        const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
        if (isNaN(date.getTime())) return 'Invalid date';
        return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    };

    return (
        <motion.div
            ref={itemRef}
            drag
            dragControls={dragControls}
            dragSnapToOrigin
            dragElastic={0.1}
            dragMomentum={false}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            whileDrag={{
                scale: 0.4,
                opacity: isOverBucket ? 0.15 : 0.5,
                borderRadius: '24px',
                zIndex: 300,
                boxShadow: 'var(--shadow-floating)',
                cursor: 'grabbing',
                transition: { opacity: { duration: 0.15 } }
            }}
            initial={{ opacity: 0, y: 20 }}
            animate={{
                opacity: 1,
                y: 0,
                boxShadow: isHovered ? 'var(--shadow-md)' : 'var(--shadow-sm)'
            }}
            exit={{ opacity: 0, scale: 0.95, height: 0, marginBottom: 0 }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleClick}
            style={{
                position: 'relative',
                marginBottom: 'var(--space-md)',
                cursor: 'grab',
                isolation: 'isolate' // Creates new stacking context
            }}
        >
            {/* Stacked card effect - show depth when count > 1 */}
            {count > 1 && (
                <>
                    {/* Third layer (if 3+ emails) */}
                    {count > 2 && (
                        <div
                            style={{
                                position: 'absolute',
                                top: '4px',
                                left: '6px',
                                right: '-6px',
                                bottom: '-4px',
                                backgroundColor: '#ebebeb',
                                borderRadius: '12px',
                                border: '1px solid #d5d5d5',
                                transform: 'rotate(-1deg)',
                                zIndex: 1
                            }}
                        />
                    )}
                    {/* Second layer */}
                    <div
                        style={{
                            position: 'absolute',
                            top: '2px',
                            left: '4px',
                            right: '-4px',
                            bottom: '-2px',
                            backgroundColor: '#f5f5f5',
                            borderRadius: '12px',
                            border: '1px solid #e0e0e0',
                            transform: 'rotate(1deg)',
                            zIndex: 2
                        }}
                    />
                </>
            )}

            {/* Main card */}
            <div
                style={{
                    backgroundColor: '#fff',
                    borderRadius: '12px',
                    border: '1px solid var(--color-border)',
                    padding: 'var(--space-lg)',
                    position: 'relative',
                    zIndex: 3
                }}
            >
                {/* Thread count badge */}
                {count > 1 && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '-8px',
                            right: '-8px',
                            backgroundColor: 'var(--color-primary)',
                            color: '#fff',
                            borderRadius: 'var(--radius-full)',
                            minWidth: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 700,
                            boxShadow: 'var(--shadow-sm)',
                            padding: '0 6px'
                        }}
                    >
                        {count}
                    </div>
                )}

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-sm)' }}>
                    <div style={{ flex: 1 }}>
                        <h3 style={{
                            fontSize: 'var(--font-size-lg)',
                            fontWeight: 600,
                            marginBottom: 'var(--space-xs)',
                            color: 'var(--color-text-main)'
                        }}>
                            {latestEmail.subject}
                        </h3>
                        <div style={{
                            display: 'flex',
                            gap: 'var(--space-md)',
                            color: 'var(--color-text-muted)',
                            fontSize: 'var(--font-size-sm)',
                            alignItems: 'center',
                            flexWrap: 'wrap'
                        }}>
                            <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
                                {latestEmail.sender}
                            </span>
                            <span>•</span>
                            <span>{formatDate(latestEmail.date)}</span>
                            {count > 1 && (
                                <>
                                    <span>•</span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Mail size={12} />
                                        {count} messages
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                        {/* Return to Bucket - Primary action for resurfaced threads */}
                        {hasNewEmail && originalBucket && onReturnToBucket && (
                            <motion.button
                                initial={{ opacity: 0 }}
                                animate={{ opacity: isHovered ? 1 : 0.8 }}
                                onClick={handleReturnToBucket}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: 'var(--radius-full)',
                                    backgroundColor: originalBucket.color || 'var(--color-primary)',
                                    color: '#fff',
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: 600,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    transition: 'all 0.2s ease',
                                    boxShadow: 'var(--shadow-sm)',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                <ArrowLeft size={14} />
                                Return to {originalBucket.label}
                            </motion.button>
                        )}

                        {/* Archive Action */}
                        <motion.button
                            initial={{ opacity: 0 }}
                            animate={{ opacity: isHovered ? 1 : 0 }}
                            onClick={handleArchive}
                            style={{
                                padding: '8px 16px',
                                borderRadius: 'var(--radius-full)',
                                backgroundColor: hasNewEmail ? 'var(--color-bg-subtle)' : 'var(--color-success)',
                                color: hasNewEmail ? 'var(--color-text-main)' : '#fff',
                                fontSize: 'var(--font-size-sm)',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.2s ease',
                                boxShadow: 'var(--shadow-sm)',
                                border: hasNewEmail ? '1px solid var(--color-border)' : 'none',
                                cursor: 'pointer'
                            }}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <Check size={14} strokeWidth={3} />
                            Archive
                        </motion.button>
                    </div>
                </div>

                {/* Preview */}
                <p style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.6,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                }}>
                    {latestEmail.preview}
                </p>
            </div>
        </motion.div>
    );
};

export default ThreadItem;
