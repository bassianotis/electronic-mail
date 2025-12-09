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
}

export const EmailCard: React.FC<EmailCardProps> = ({ email, onClick, onBucket }) => {
    const { setHoveredBucketId, setIsDragging } = useDragDrop();
    const { buckets } = useMail();
    const isDraggingRef = React.useRef(false);
    const [showSenderEmail, setShowSenderEmail] = React.useState(false);

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

    return (
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
            whileHover={{ y: -4, boxShadow: 'var(--shadow-md)' }}
            style={{
                backgroundColor: '#fff',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-lg)',
                border: '1px solid var(--color-border)',
                cursor: 'grab',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-sm)',
                height: '100%',
                position: 'relative' // Needed for z-index during drag
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
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
};
