import React from 'react';
import { motion, type PanInfo } from 'framer-motion';
import type { Email } from '../../store/mailStore';

import { useDragDropActions } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { formatListDate } from '../../utils/formatDate';
import { DraftBadge } from './DraftBadge';
import { ThreadLink } from './ThreadLink';
import { Z } from '../../utils/layers';
import { type Arrivals, useEntrance } from '../../hooks/useArrivals';
import { DURATION, leave, noNativeAnimation, tween } from '../../utils/motion';
import { inDockStrip } from '../../utils/dropTargets';
import { useDragLook } from '../../hooks/useDragLook';
import { formatCount } from '../../utils/format';
import { useServerUnreachable } from '../../api/reachability';


interface EmailCardProps {
    email: Email;
    onClick: () => void;
    onBucket: (emailId: string, bucketId: string) => void;
    threadCount?: number;
    hasDraft?: boolean;
    /** The list's arrivals: a card animates in only if it arrived while the list was showing. */
    arrivals?: Arrivals;
}

export const EmailCard = React.forwardRef<HTMLDivElement, EmailCardProps>(
    ({ email, onClick, onBucket, threadCount, hasDraft, arrivals }, ref) => {
        const { setHoveredBucketId, setIsDragging } = useDragDropActions();
        const { buckets } = useMail();
        const offline = useServerUnreachable(); // filing waits for the server
        const isDraggingRef = React.useRef(false);
        const cardRef = React.useRef<HTMLDivElement | null>(null);
        const setRef = (el: HTMLDivElement | null) => {
            cardRef.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
        };
        const look = useDragLook(cardRef);
        const [showSenderEmail, setShowSenderEmail] = React.useState(false);
        const enters = useEntrance(arrivals, email.id);

        const handleDragStart = () => {
            isDraggingRef.current = true;
            setIsDragging(true);
            look.start();
        };

        const handleDrag = (_event: unknown, info: PanInfo) => {
            const dropPoint = { x: info.point.x, y: info.point.y };
            let foundBucketId: string | null = null;

            // Check for archive target
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
                    look.aim(foundBucketId);
                    return;
                }
            }

            // Check for inbox target (Mail logo)
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
                    look.aim(foundBucketId);
                    return;
                }
            }

            // Check for bucket targets
            const targetBuckets = buckets.filter(b => b.id !== 'inbox');
            for (const bucket of targetBuckets) {
                const element = document.getElementById(`bucket-target-${bucket.id}`);
                if (element && inDockStrip(dropPoint)) {
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
            look.aim(foundBucketId);
        };

        const handleDragEnd = (_event: unknown, info: PanInfo) => {
            setIsDragging(false);
            setHoveredBucketId(null);

            // Check if dropped on a target
            const dropPoint = { x: info.point.x, y: info.point.y };
            let droppedBucketId: string | null = null;

            // Check for archive target
            const archiveElement = document.getElementById('archive-target');
            if (archiveElement) {
                const rect = archiveElement.getBoundingClientRect();
                if (
                    dropPoint.x >= rect.left &&
                    dropPoint.x <= rect.right &&
                    dropPoint.y >= rect.top &&
                    dropPoint.y <= rect.bottom
                ) {
                    // Archive the email (handled by BucketGallery)
                    void look.land('archive', () => onBucket(email.id, 'archive'));
                    setTimeout(() => {
                        isDraggingRef.current = false;
                    }, 100);
                    return;
                }
            }

            // Check for inbox target (Mail logo)
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

            // Check for bucket targets if not dropped on inbox
            if (!droppedBucketId) {
                const targetBuckets = buckets.filter(b => b.id !== 'inbox');
                for (const bucket of targetBuckets) {
                    const element = document.getElementById(`bucket-target-${bucket.id}`);
                    if (element && inDockStrip(dropPoint)) {
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
            }

            const to = droppedBucketId;
            void look.land(to, () => { if (to) onBucket(email.id, to); });

            setTimeout(() => {
                isDraggingRef.current = false;
            }, 100);
        };

        const handleClick = () => {
            if (!isDraggingRef.current) {
                onClick();
            }
        };

        const isThread = !!(threadCount && threadCount > 1);

        return (
            <motion.div
                ref={setRef}
                onPointerDownCapture={look.grab}
                className={`em-card${isThread ? ` thread-stack${threadCount === 2 ? ' thread-stack-pair' : ''}` : ''}`}
                drag={!offline}
                dragElastic={0.1}
                dragMomentum={false}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                layout
                initial={enters ? { opacity: 0, scale: 0.95 } : false}
                onUpdate={noNativeAnimation}
                animate={look.animate({ opacity: 1, scale: 1 })}
                exit={{ opacity: 0, scale: 0.97, transition: leave(DURATION.mid) }}
                transition={tween(DURATION.mid)}
                whileDrag={look.whileDrag}
                onClick={handleClick}
                data-thread-card=""
                style={{
                    backgroundColor: 'var(--surface-1)',
                    borderRadius: 'var(--radius-3)',
                    padding: 'var(--card-padding)',
                    border: '1px solid var(--line-1)',
                    cursor: 'grab',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    height: '100%',
                    minWidth: 0, // a grid cell: long text can't widen its column
                    position: 'relative', // for its z-index while away from its slot
                    originX: look.originX,
                    originY: look.originY,
                    x: look.x,
                    y: look.y,
                    zIndex: look.raised ? Z.drag.card : undefined
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', fontSize: 'var(--size-body)', color: 'var(--text-3)' }}>
                    <span
                        // A long sender (an unbroken address) ends in "…" rather than pushing the card wider
                        style={{ cursor: email.senderAddress ? 'pointer' : 'default', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={(e) => {
                            if (email.senderAddress) {
                                e.stopPropagation();
                                setShowSenderEmail(!showSenderEmail);
                            }
                        }}
                    >
                        {showSenderEmail && email.senderAddress ? email.senderAddress : email.sender}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                        {hasDraft && <DraftBadge />}
                        {threadCount && threadCount > 1 && (
                            <span style={{
                                backgroundColor: 'transparent',
                                color: 'var(--text-4)',
                                fontSize: 'var(--size-caption)',
                                fontWeight: 'var(--weight-medium)',
                                padding: '0',
                                borderRadius: 'var(--radius-full)',
                                minWidth: '20px',
                                textAlign: 'center',
                                fontVariantNumeric: 'tabular-nums'
                            }}>
                                {formatCount(threadCount)}
                            </span>
                        )}
                        <span style={{ fontSize: '1em', color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>{formatListDate(email.date)}</span>
                    </div>
                </div>

                <h3 style={{
                    fontSize: 'var(--size-title)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-1)',
                    lineHeight: 1.3
                }}>
                    <ThreadLink threadId={email.threadId} onOpen={handleClick}>{email.subject}</ThreadLink>
                </h3>

                <p className="text-muted" style={{
                    fontSize: 'var(--size-body)',
                    color: 'var(--text-4)',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                }}>
                    {email.preview}
                </p>

            </motion.div>
        );
    }
);
