/**
 * ThreadItem Component
 * Displays a thread as a stacked card with inline expansion
 * Following the InboxItem pattern for click-to-expand behavior
 */
import React, { useRef, useState, useEffect } from 'react';
import { motion, useDragControls } from 'framer-motion';
import type { ThreadGroup } from '../../../shared/types/email';
import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { Edit3, Calendar } from 'lucide-react';
import { ShadowContainer } from '../Views/ShadowContainer';
import { sanitizeHtml } from '../../utils/sanitize';

interface ThreadItemProps {
    thread: ThreadGroup;
    isExpanded: boolean;
    onBucket: (threadId: string, bucketId: string) => void;
    onArchive: (threadId: string) => void;
    onClick: () => void;
}

export const ThreadItem: React.FC<ThreadItemProps> = ({
    thread,
    isExpanded,
    onBucket,
    onArchive,
    onClick
}) => {
    const { setHoveredBucketId, setIsDragging } = useDragDrop();
    const { loadEmailBody, emails, buckets, markAsRead } = useMail();

    const dragControls = useDragControls();
    const isDraggingRef = useRef(false);
    const itemRef = useRef<HTMLDivElement>(null);

    // Use thread's latest email for display
    const latestEmail = thread.latestEmail;
    const emailId = latestEmail.messageId || thread.threadId;

    // Get email body from context
    const emailBody = emails.find(e => e.id === emailId || e.messageId === emailId)?.body;

    // Track drag state
    const [isOverBucket, setIsOverBucket] = useState(false);
    const [dragOrigin, setDragOrigin] = useState('top center');

    // Toggle between sender name and email address
    const [showSenderEmail, setShowSenderEmail] = useState(false);

    // Inline Action States (note editing not yet implemented in this component)
    const [_isSettingDate, setIsSettingDate] = useState(false);
    const [_isEditingNote, setIsEditingNote] = useState(false);

    // Control layout animation
    const [enableLayoutAnim, setEnableLayoutAnim] = useState(false);

    // Track marked as read
    const markedAsReadRef = useRef<string | null>(null);

    useEffect(() => {
        if (isExpanded) {
            setEnableLayoutAnim(true);
            const timer = setTimeout(() => setEnableLayoutAnim(false), 400);
            return () => clearTimeout(timer);
        } else {
            setEnableLayoutAnim(true);
        }
    }, [isExpanded]);

    useEffect(() => {
        if (isExpanded) {
            // Load body when expanded
            if (markedAsReadRef.current !== emailId) {
                markedAsReadRef.current = emailId;
                loadEmailBody(emailId, latestEmail.uid?.toString());

                // Mark as read
                if (latestEmail.uid) {
                    markAsRead(emailId, latestEmail.uid.toString());
                } else {
                    markAsRead(emailId);
                }
            }
        } else {
            setIsEditingNote(false);
            setIsSettingDate(false);
            markedAsReadRef.current = null;
        }
    }, [isExpanded, emailId, latestEmail.uid, loadEmailBody, markAsRead]);

    const handleDragStart = () => {
        isDraggingRef.current = true;
        setIsDragging(true);
    };

    const handleDrag = (_event: any, info: any) => {
        const dragX = info.point.x;

        // Get bucket container dimensions
        const bucketContainer = document.querySelector('.bucket-container');
        if (bucketContainer) {
            const rect = bucketContainer.getBoundingClientRect();
            const bucketContainerStart = rect.left;
            const bucketContainerEnd = rect.right;

            if (dragX >= bucketContainerStart && dragX <= bucketContainerEnd) {
                // Over bucket area - determine which bucket
                setIsOverBucket(true);
                const bucketWidth = (bucketContainerEnd - bucketContainerStart) / buckets.length;
                const bucketIndex = Math.floor((dragX - bucketContainerStart) / bucketWidth);
                const clampedIndex = Math.max(0, Math.min(bucketIndex, buckets.length - 1));

                if (buckets[clampedIndex]) {
                    setHoveredBucketId(buckets[clampedIndex].id);
                }
            } else {
                setIsOverBucket(false);
                setHoveredBucketId(null);
            }
        }

        // Update drag origin based on mouse position (for shrinking towards the mouse)
        const cardRect = itemRef.current?.getBoundingClientRect();
        if (cardRect) {
            const relativeY = (info.point.y - cardRect.top) / cardRect.height;
            const yPercent = Math.min(Math.max(relativeY * 100, 0), 100);
            setDragOrigin(`50% ${yPercent}%`);
        }
    };

    const handleDragEnd = (_event: any, info: any) => {
        isDraggingRef.current = false;
        setIsDragging(false);
        setIsOverBucket(false);

        const dragX = info.point.x;

        const bucketContainer = document.querySelector('.bucket-container');
        if (bucketContainer) {
            const rect = bucketContainer.getBoundingClientRect();
            if (dragX >= rect.left && dragX <= rect.right) {
                const bucketWidth = (rect.right - rect.left) / buckets.length;
                const bucketIndex = Math.floor((dragX - rect.left) / bucketWidth);
                const clampedIndex = Math.max(0, Math.min(bucketIndex, buckets.length - 1));

                if (buckets[clampedIndex]) {
                    const targetBucket = buckets[clampedIndex];
                    if (targetBucket.id === 'archive') {
                        onArchive(thread.threadId);
                    } else {
                        onBucket(thread.threadId, targetBucket.id);
                    }
                }
            }
        }

        setHoveredBucketId(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        if (isDraggingRef.current) return;

        // Check if clicking on text-selectable elements
        const target = e.target as HTMLElement;
        if (target.closest('[data-text-selectable="true"]')) {
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                return; // Don't toggle if text is selected
            }
        }

        onClick();
    };


    const hasStack = thread.count > 1;

    return (
        <motion.div
            ref={itemRef}
            layoutId={`thread-${thread.threadId}`}
            layout={enableLayoutAnim ? 'position' : false}
            drag
            dragSnapToOrigin
            dragElastic={0.1}
            dragMomentum={false}
            dragControls={dragControls}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
            whileDrag={{
                scale: 0.6,
                opacity: isOverBucket ? 0.6 : 0.9,
                zIndex: 300,
                boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
                cursor: 'grabbing',
                transformOrigin: dragOrigin
            }}
            initial={{ opacity: 0, y: 20 }}
            animate={{
                opacity: 1,
                y: 0,
                height: 'auto'
            }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.2 }}
            style={{
                marginBottom: 'var(--space-md)',
                cursor: 'grab',
                position: 'relative',
                isolation: 'isolate'
            }}
        >
            {/* Stacked card effect for threads */}
            {hasStack && (
                <>
                    {thread.count > 2 && (
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

            {/* Main card content */}
            <div
                style={{
                    backgroundColor: '#fff',
                    border: '1px solid var(--color-border)',
                    borderRadius: '12px',
                    padding: 'var(--space-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-sm)',
                    position: 'relative',
                    zIndex: 3
                }}
            >
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
                            <span
                                data-text-selectable="true"
                                style={{
                                    fontWeight: 600,
                                    color: 'var(--color-text-main)',
                                    cursor: latestEmail.senderAddress ? 'pointer' : 'default'
                                }}
                                onClick={(e) => {
                                    if (latestEmail.senderAddress) {
                                        e.stopPropagation();
                                        const selection = window.getSelection();
                                        if (!selection || selection.toString().length === 0) {
                                            setShowSenderEmail(!showSenderEmail);
                                        }
                                    }
                                }}
                            >
                                {showSenderEmail && latestEmail.senderAddress ? latestEmail.senderAddress : latestEmail.sender}
                            </span>
                            {hasStack && (
                                <span style={{
                                    backgroundColor: '#3b82f6',
                                    color: '#fff',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    padding: '2px 6px',
                                    borderRadius: '10px',
                                    minWidth: '18px',
                                    textAlign: 'center'
                                }}>
                                    {thread.count}
                                </span>
                            )}
                        </div>
                        <h3
                            data-text-selectable="true"
                            style={{
                                fontSize: 'var(--font-size-lg)',
                                fontWeight: 600,
                                color: 'var(--color-text-main)',
                                margin: 0,
                                cursor: 'text'
                            }}
                        >
                            {latestEmail.subject}
                        </h3>
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(latestEmail.date).toLocaleDateString()}
                    </div>
                </div>

                {/* Preview or expanded content */}
                {!isExpanded ? (
                    <p
                        className="text-muted"
                        style={{
                            fontSize: 'var(--font-size-sm)',
                            margin: 0,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                        }}
                    >
                        {latestEmail.preview}
                    </p>
                ) : (
                    <>
                        {/* Email body */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.1 }}
                            style={{ marginTop: 'var(--space-md)' }}
                        >
                            {emailBody ? (
                                <ShadowContainer>
                                    <div
                                        className="email-body-content"
                                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(emailBody) }}
                                        style={{
                                            fontSize: 'var(--font-size-sm)',
                                            lineHeight: 1.6,
                                            color: 'var(--color-text-main)'
                                        }}
                                    />
                                </ShadowContainer>
                            ) : (
                                <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                    Loading...
                                </p>
                            )}
                        </motion.div>

                        {/* Action bar */}
                        <div style={{
                            display: 'flex',
                            gap: 'var(--space-sm)',
                            marginTop: 'var(--space-md)',
                            paddingTop: 'var(--space-md)',
                            borderTop: '1px solid var(--color-border)'
                        }}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsEditingNote(true);
                                }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '8px 16px',
                                    borderRadius: 'var(--radius-full)',
                                    backgroundColor: '#fff',
                                    border: '1px solid var(--color-border)',
                                    color: 'var(--color-text-main)',
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: 500,
                                    cursor: 'pointer'
                                }}
                            >
                                <Edit3 size={16} /> Note
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsSettingDate(true);
                                }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '8px 16px',
                                    borderRadius: 'var(--radius-full)',
                                    backgroundColor: '#fff',
                                    border: '1px solid var(--color-border)',
                                    color: 'var(--color-text-main)',
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: 500,
                                    cursor: 'pointer'
                                }}
                            >
                                <Calendar size={16} /> Due
                            </button>
                        </div>
                    </>
                )}
            </div>
        </motion.div>
    );
};
