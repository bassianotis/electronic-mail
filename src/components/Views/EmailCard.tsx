import React from 'react';
import { motion } from 'framer-motion';
import type { Email } from '../../store/mailStore';
import { Clock, Edit3 } from 'lucide-react';

import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';

interface EmailCardProps {
    email: Email;
    onClick: () => void;
    onBucket: (emailId: string, bucketId: string) => void;
    threadCount?: number; // Optional thread count badge
}

export const EmailCard: React.FC<EmailCardProps> = ({ email, onClick, onBucket, threadCount }) => {
    const { setHoveredBucketId, setIsDragging } = useDragDrop();
    const { buckets } = useMail();
    const isDraggingRef = React.useRef(false);
    const [showSenderEmail, setShowSenderEmail] = React.useState(false);

    // Debug thread count
    React.useEffect(() => {
        if (threadCount && threadCount > 1) {
            console.log(`[EmailCard] Rendering with threadCount=${threadCount} for ${email.subject?.substring(0, 30)}`);
        }
    }, [threadCount, email.subject]);

    const handleDragStart = () => {
        isDraggingRef.current = true;
        setIsDragging(true);
    };

    const handleDrag = (_event: any, info: any) => {
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
                return;
            }
        }

        // Check for bucket targets
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
    };

    const handleDragEnd = (_event: any, info: any) => {
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
                onBucket(email.id, 'archive');
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
        }

        if (droppedBucketId) {
            onBucket(email.id, droppedBucketId);
        }

        setTimeout(() => {
            isDraggingRef.current = false;
        }, 100);
    };

    const handleClick = () => {
        if (!isDraggingRef.current) {
            onClick();
        }
    };

    const hasStack = threadCount && threadCount > 1;

    // The main card content
    const cardContent = (
        <motion.div
            layoutId={`email-${email.id}`}
            drag
            dragSnapToOrigin
            dragElastic={0.1}
            dragMomentum={false}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            whileDrag={{
                scale: 0.6,
                opacity: 0.9,
                borderRadius: '24px',
                zIndex: 300,
                boxShadow: 'var(--shadow-floating)',
                cursor: 'grabbing'
            }}
            onClick={handleClick}
            whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0,0,0,0.12)' }}
            style={{
                backgroundColor: '#fff',
                borderRadius: '12px',
                padding: 'var(--space-lg)',
                border: '1px solid var(--color-border)',
                cursor: 'grab',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-sm)',
                height: '100%',
                position: 'relative',
                zIndex: 3
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                    <span
                        style={{ cursor: email.senderAddress ? 'pointer' : 'default' }}
                        onClick={(e) => {
                            if (email.senderAddress) {
                                e.stopPropagation();
                                setShowSenderEmail(!showSenderEmail);
                            }
                        }}
                    >
                        {showSenderEmail && email.senderAddress ? email.senderAddress : email.sender}
                    </span>
                    {threadCount && threadCount > 1 && (
                        <span style={{
                            backgroundColor: '#3b82f6',
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '10px',
                            minWidth: '18px',
                            textAlign: 'center',
                            display: 'inline-block'
                        }}>
                            {threadCount}
                        </span>
                    )}
                </div>
                <span>{email.date.toLocaleDateString()}</span>
            </div>

            <h3 style={{
                fontSize: 'var(--font-size-lg)',
                fontWeight: 600,
                color: 'var(--color-text-main)',
                lineHeight: 1.3
            }}>
                {email.subject}
            </h3>

            <p className="text-muted" style={{
                fontSize: 'var(--font-size-sm)',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
            }}>
                {email.preview}
            </p>

            {/* Metadata Footer */}
            {(email.dueDate || email.note) && (
                <div style={{
                    marginTop: 'auto',
                    paddingTop: 'var(--space-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-xs)'
                }}>
                    {email.dueDate && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: '#c02d78',
                            fontSize: '11px',
                            fontWeight: 600
                        }}>
                            <Clock size={12} />
                            <span>Due {new Date(email.dueDate).toLocaleDateString()}</span>
                        </div>
                    )}
                    {email.note && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '6px',
                            color: '#e67e22',
                            fontSize: '11px',
                            backgroundColor: '#fff9db',
                            padding: '6px',
                            borderRadius: '4px'
                        }}>
                            <Edit3 size={12} style={{ marginTop: '2px', flexShrink: 0 }} />
                            <span style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                            }}>
                                {email.note}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </motion.div>
    );

    // If it's a thread with multiple emails, we need to create a draggable container with stack inside
    if (hasStack) {
        return (
            <motion.div
                layoutId={`email-stack-${email.id}`}
                drag
                dragSnapToOrigin
                dragElastic={0.1}
                dragMomentum={false}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                whileDrag={{
                    scale: 0.6,
                    opacity: 0.9,
                    zIndex: 300,
                    boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
                    cursor: 'grabbing'
                }}
                onClick={handleClick}
                whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0,0,0,0.12)' }}
                style={{
                    position: 'relative',
                    height: '100%',
                    cursor: 'grab',
                    isolation: 'isolate'
                }}
            >
                {/* Background stacked cards - inside the drag container */}
                <div style={{
                    position: 'absolute',
                    top: 4,
                    left: 6,
                    right: -4,
                    bottom: -4,
                    backgroundColor: '#f5f5f5',
                    border: '1px solid #e0e0e0',
                    borderRadius: '12px',
                    transform: 'rotate(1.5deg)',
                    zIndex: 1
                }} />
                {threadCount > 2 && (
                    <div style={{
                        position: 'absolute',
                        top: 6,
                        left: 4,
                        right: -2,
                        bottom: -6,
                        backgroundColor: '#ebebeb',
                        border: '1px solid #d5d5d5',
                        borderRadius: '12px',
                        transform: 'rotate(-1deg)',
                        zIndex: 0
                    }} />
                )}
                {/* Main card content */}
                <div
                    style={{
                        backgroundColor: '#fff',
                        borderRadius: '12px',
                        padding: 'var(--space-lg)',
                        border: '1px solid var(--color-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-sm)',
                        height: '100%',
                        position: 'relative',
                        zIndex: 3
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                            <span>{email.sender}</span>
                            <span style={{
                                backgroundColor: '#3b82f6',
                                color: '#fff',
                                fontSize: '10px',
                                fontWeight: 600,
                                padding: '2px 6px',
                                borderRadius: '10px',
                                minWidth: '18px',
                                textAlign: 'center',
                                display: 'inline-block'
                            }}>
                                {threadCount}
                            </span>
                        </div>
                        <span>{email.date.toLocaleDateString()}</span>
                    </div>
                    <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text-main)', lineHeight: 1.3 }}>
                        {email.subject}
                    </h3>
                    <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {email.preview}
                    </p>
                </div>
            </motion.div>
        );
    }

    return cardContent;
};
