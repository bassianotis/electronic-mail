import React, { useRef, useState, useEffect } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { type Email } from '../../store/mailStore';
import { useAnimation } from '../../context/AnimationContext';
import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { Check, Edit3, Clock, Calendar } from 'lucide-react';
import { ShadowContainer } from '../Views/ShadowContainer';
import { sanitizeHtml } from '../../utils/sanitize';

interface InboxItemProps {
    email: Email;
    isExpanded: boolean;
    onBucket: (emailId: string, bucketId: string) => void;
    onDone: (emailId: string) => void;
    onClick: () => void;
}

export const InboxItem: React.FC<InboxItemProps> = ({ email, isExpanded, onBucket, onDone, onClick }) => {
    const [isHovered, setIsHovered] = React.useState(false);
    const itemRef = useRef<HTMLDivElement>(null);
    const { } = useAnimation();
    const { setHoveredBucketId, setIsDragging } = useDragDrop();
    const { updateEmail, loadEmailBody, buckets, markAsRead } = useMail();

    const dragControls = useDragControls();

    const isDraggingRef = useRef(false);

    // Inline Action States
    const [note, setNote] = useState('');
    const [dueDate, setDueDate] = useState<string>('');
    const [isEditingNote, setIsEditingNote] = useState(false);
    const [isSettingDate, setIsSettingDate] = useState(false);
    const dateButtonRef = useRef<HTMLButtonElement>(null);
    const [datePopupPosition, setDatePopupPosition] = useState({ top: 0, left: 0 });

    // Control layout animation to prevent double-expansion
    const [enableLayoutAnim, setEnableLayoutAnim] = useState(false);

    // Track when hovering over a bucket for enhanced transparency
    const [isOverBucket, setIsOverBucket] = useState(false);

    // Track drag origin to shrink towards the mouse
    const [dragOrigin, setDragOrigin] = useState('top center');

    // Toggle between sender name and email address
    const [showSenderEmail, setShowSenderEmail] = useState(false);

    useEffect(() => {
        if (isExpanded) {
            setEnableLayoutAnim(true);
            // Disable layout animation after transition completes
            const timer = setTimeout(() => setEnableLayoutAnim(false), 400);
            return () => clearTimeout(timer);
        } else {
            setEnableLayoutAnim(true);
        }
    }, [isExpanded]);

    // Track which email has been marked as read to prevent duplicate calls
    const markedAsReadRef = useRef<string | null>(null);

    useEffect(() => {
        if (isExpanded) {
            setNote(email.note || '');
            setDueDate(email.dueDate ? new Date(email.dueDate).toISOString().split('T')[0] : '');

            // Only load body and mark as read once per email
            if (markedAsReadRef.current !== email.id) {
                markedAsReadRef.current = email.id;
                loadEmailBody(email.id);

                // Mark as read when expanded
                if (email.uid) {
                    markAsRead(email.id, email.uid);
                } else {
                    markAsRead(email.id);
                }
            }
        } else {
            setIsEditingNote(false);
            setIsSettingDate(false);
            markedAsReadRef.current = null; // Reset when collapsed
        }
    }, [isExpanded, email.id, email.note, email.dueDate, email.uid]);



    const handleArchive = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDone(email.id);
    };

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
                onDone(email.id); // Archive uses the same handler as Done
                setTimeout(() => {
                    isDraggingRef.current = false;
                }, 100);
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
                    droppedBucketId = bucket.id;
                    break;
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

    const handleClick = (e: React.MouseEvent) => {
        // Don't toggle if dragging
        if (isDraggingRef.current) return;

        // Don't toggle if clicking on a link or button within the email
        const target = e.target as HTMLElement;
        if (target.closest('a, button, input, textarea, [role="button"]')) {
            return;
        }

        onClick();
    };

    const handleSaveNote = () => {
        updateEmail(email.id, { note });
        setIsEditingNote(false);
    };

    return (
        <>
            <motion.div
                ref={itemRef}
                layout={enableLayoutAnim}
                drag
                dragControls={dragControls}
                dragListener={!isExpanded} // When expanded, only drag from handle
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
                    marginBottom: isExpanded ? 'var(--space-lg)' : 'var(--space-md)',
                    boxShadow: isExpanded ? 'var(--shadow-lg)' : (isHovered ? 'var(--shadow-md)' : 'var(--shadow-sm)')
                }}
                exit={{ opacity: 0, scale: 0.95, height: 0, marginBottom: 0 }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onClick={handleClick}
                style={{
                    position: 'relative',
                    backgroundColor: '#fff',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    cursor: isExpanded ? 'default' : 'grab',
                    overflow: 'hidden',
                    transformOrigin: dragOrigin
                }}
            >
                <div
                    style={{
                        padding: 'var(--space-lg)',
                        cursor: isExpanded ? 'grab' : 'inherit'
                    }}
                    onPointerEnter={() => setDragOrigin('top center')}
                    onPointerDown={(e) => {
                        if (isExpanded) {
                            // Allow text selection on selectable elements
                            const target = e.target as HTMLElement;
                            const isTextSelectable = target.closest('[data-text-selectable="true"]');
                            if (!isTextSelectable) {
                                e.preventDefault(); // Prevent text selection only on non-selectable areas
                                dragControls.start(e); // Only start drag when not in selectable areas
                            }
                        }
                    }}
                >
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-sm)' }}>
                        <div>
                            <h3 style={{
                                fontSize: 'var(--font-size-lg)',
                                fontWeight: 600,
                                marginBottom: 'var(--space-xs)',
                                color: 'var(--color-text-main)'
                            }}>
                                {email.subject}
                            </h3>
                            <div style={{ display: 'flex', gap: 'var(--space-md)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span
                                    style={{
                                        fontWeight: 600,
                                        color: 'var(--color-text-main)',
                                        cursor: 'text'
                                    }}
                                    onClick={(e) => {
                                        if (email.senderAddress) {
                                            // Only toggle if no text is selected
                                            const selection = window.getSelection();
                                            if (!selection || selection.toString().length === 0) {
                                                e.stopPropagation();
                                                setShowSenderEmail(!showSenderEmail);
                                            }
                                        }
                                    }}
                                    data-text-selectable="true"
                                >
                                    {showSenderEmail && email.senderAddress ? email.senderAddress : email.sender}
                                </span>
                                {!isExpanded && <span>•</span>}
                                <span>{email.date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                            </div>

                            {/* Metadata Badges (Always visible if present) */}
                            {(email.note || email.dueDate) && (
                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                    {email.dueDate && (
                                        <span style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            backgroundColor: '#fff0f6',
                                            color: '#c02d78',
                                            padding: '2px 8px',
                                            borderRadius: '4px',
                                            fontSize: '11px',
                                            fontWeight: 600
                                        }}>
                                            <Clock size={10} /> Due {new Date(email.dueDate).toLocaleDateString()}
                                        </span>
                                    )}
                                    {email.note && (
                                        <span style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '4px',
                                            backgroundColor: '#fff9db',
                                            color: '#e67e22',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            maxWidth: '200px'
                                        }}>
                                            <Edit3 size={10} style={{ marginTop: '2px', flexShrink: 0 }} />
                                            <span style={{
                                                display: '-webkit-box',
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical',
                                                overflow: 'hidden'
                                            }}>
                                                {email.note}
                                            </span>
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Archive Action (Visible on Hover or Expanded) */}
                        <motion.button
                            initial={{ opacity: 0 }}
                            animate={{ opacity: isHovered || isExpanded ? 1 : 0 }}
                            onClick={handleArchive}
                            style={{
                                padding: '8px 16px',
                                borderRadius: 'var(--radius-full)',
                                backgroundColor: 'var(--color-success)',
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
                            <Check size={14} strokeWidth={3} />
                            Archive
                        </motion.button>
                    </div>

                    {/* Body Content */}
                    <div style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-muted)',
                        lineHeight: 1.6
                    }}>
                        {isExpanded ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.3 }}
                            >
                                {/* Note Editor */}
                                {isEditingNote && (
                                    <div style={{ marginBottom: 'var(--space-lg)', padding: 'var(--space-md)', backgroundColor: '#fff9db', borderRadius: 'var(--radius-md)' }}>
                                        <textarea
                                            value={note}
                                            onChange={(e) => setNote(e.target.value)}
                                            placeholder="Add a note..."
                                            style={{
                                                width: '100%',
                                                minHeight: '80px',
                                                border: 'none',
                                                backgroundColor: 'transparent',
                                                resize: 'none',
                                                outline: 'none',
                                                fontSize: 'var(--font-size-base)',
                                                marginBottom: 'var(--space-sm)'
                                            }}
                                            autoFocus
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                            <button onClick={(e) => { e.stopPropagation(); setIsEditingNote(false); }} style={{ fontSize: '12px', padding: '4px 8px' }}>Cancel</button>
                                            <button onClick={(e) => { e.stopPropagation(); handleSaveNote(); }} style={{ fontSize: '12px', padding: '4px 8px', backgroundColor: '#e67e22', color: '#fff', borderRadius: '4px' }}>Save Note</button>
                                        </div>
                                    </div>
                                )}

                                {/* Display Note if not editing */}
                                {!isEditingNote && note && (
                                    <div
                                        onClick={(e) => { e.stopPropagation(); setIsEditingNote(true); }}
                                        style={{
                                            marginBottom: 'var(--space-lg)',
                                            padding: 'var(--space-md)',
                                            backgroundColor: '#fff9db',
                                            borderRadius: 'var(--radius-md)',
                                            cursor: 'pointer',
                                            border: '1px dashed transparent',
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#e67e22'}
                                        onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                    >
                                        <p style={{ fontSize: 'var(--font-size-sm)', color: '#5e4e3e', whiteSpace: 'pre-wrap' }}>{note}</p>
                                    </div>
                                )}

                                <div
                                    style={{
                                        marginTop: 'var(--space-md)',
                                        padding: 'var(--space-md)',
                                        backgroundColor: 'var(--color-bg-subtle)',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'text'
                                    }}
                                    data-text-selectable="true"
                                >
                                    <ShadowContainer>
                                        <div
                                            style={{ minHeight: '300px' }}
                                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(email.body) }}
                                        />
                                    </ShadowContainer>

                                    {/* Attachments */}
                                    {email.attachments && email.attachments.length > 0 && (
                                        <div style={{
                                            marginTop: 'var(--space-lg)',
                                            paddingTop: 'var(--space-md)',
                                            borderTop: '1px solid var(--color-border)'
                                        }}>
                                            <div style={{
                                                fontSize: 'var(--font-size-sm)',
                                                fontWeight: 600,
                                                color: 'var(--color-text-muted)',
                                                marginBottom: 'var(--space-sm)'
                                            }}>
                                                Attachments ({email.attachments.length})
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                                                {email.attachments.map((attachment, idx) => (
                                                    <a
                                                        key={idx}
                                                        href={`/api/emails/${email.id}/attachments/${idx}`}
                                                        download={attachment.filename}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 'var(--space-sm)',
                                                            padding: 'var(--space-sm)',
                                                            backgroundColor: 'var(--color-surface)',
                                                            border: '1px solid var(--color-border)',
                                                            borderRadius: 'var(--radius-sm)',
                                                            textDecoration: 'none',
                                                            color: 'var(--color-text-main)',
                                                            fontSize: 'var(--font-size-sm)',
                                                            cursor: 'pointer',
                                                            transition: 'background-color 0.2s'
                                                        }}
                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'}
                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface)'}
                                                    >
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                            <polyline points="7 10 12 15 17 10"></polyline>
                                                            <line x1="12" y1="15" x2="12" y2="3"></line>
                                                        </svg>
                                                        <span style={{ flex: 1 }}>{attachment.filename}</span>
                                                        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
                                                            {(attachment.size / 1024).toFixed(1)} KB
                                                        </span>
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Inline Actions */}
                                <div
                                    style={{
                                        marginTop: 'var(--space-lg)',
                                        display: 'flex',
                                        gap: 'var(--space-sm)',
                                        borderTop: '1px solid var(--color-border)',
                                        paddingTop: 'var(--space-md)',
                                        cursor: isExpanded ? 'grab' : 'inherit'
                                    }}
                                    onPointerEnter={() => setDragOrigin('bottom center')}
                                    onPointerDown={(e) => {
                                        if (isExpanded) {
                                            // Allow text selection - buttons already have stopPropagation
                                            e.preventDefault();
                                            dragControls.start(e);
                                        }
                                    }}
                                >
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsEditingNote(true); }}
                                        style={actionButtonStyle}
                                    >
                                        <Edit3 size={16} /> Note
                                    </button>

                                    <div style={{ position: 'relative' }}>
                                        <button
                                            ref={dateButtonRef}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!isSettingDate && !dueDate) {
                                                    setDueDate(new Date().toISOString().split('T')[0]);
                                                }

                                                // Calculate button position for fixed popup
                                                if (dateButtonRef.current && !isSettingDate) {
                                                    const rect = dateButtonRef.current.getBoundingClientRect();
                                                    setDatePopupPosition({
                                                        top: rect.bottom + 8,
                                                        left: rect.left
                                                    });
                                                }

                                                setIsSettingDate(!isSettingDate);
                                            }}
                                            style={actionButtonStyle}
                                        >
                                            <Calendar size={16} /> Due
                                        </button>
                                        {isSettingDate && (
                                            <div
                                                onClick={(e) => e.stopPropagation()}
                                                style={{
                                                    position: 'fixed',
                                                    top: `${datePopupPosition.top}px`,
                                                    left: `${datePopupPosition.left}px`,
                                                    backgroundColor: '#fff',
                                                    padding: '12px',
                                                    borderRadius: '8px',
                                                    boxShadow: 'var(--shadow-lg)',
                                                    zIndex: 1000,
                                                    border: '1px solid var(--color-border)',
                                                    minWidth: '200px'
                                                }}
                                            >
                                                <input
                                                    type="date"
                                                    value={dueDate}
                                                    onChange={(e) => setDueDate(e.target.value)}
                                                    style={{
                                                        padding: '6px 8px',
                                                        borderRadius: '4px',
                                                        border: '1px solid #ddd',
                                                        width: '100%',
                                                        marginBottom: '8px'
                                                    }}
                                                    autoFocus
                                                />
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            updateEmail(email.id, { dueDate: dueDate ? new Date(dueDate + 'T12:00:00') : undefined });
                                                            setIsSettingDate(false);
                                                        }}
                                                        style={{
                                                            flex: 1,
                                                            padding: '6px 12px',
                                                            borderRadius: '4px',
                                                            backgroundColor: 'var(--color-accent-secondary)',
                                                            color: '#fff',
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            border: 'none',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDueDate('');
                                                            updateEmail(email.id, { dueDate: null as any, messageId: email.messageId });
                                                            setIsSettingDate(false);
                                                        }}
                                                        style={{
                                                            flex: 1,
                                                            padding: '6px 12px',
                                                            borderRadius: '4px',
                                                            backgroundColor: '#f5f5f5',
                                                            color: '#666',
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            border: '1px solid #ddd',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Clear
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        onClick={handleArchive}
                                        style={{
                                            backgroundColor: 'var(--color-success)',
                                            color: '#fff',
                                            padding: '8px 24px',
                                            borderRadius: 'var(--radius-full)',
                                            fontWeight: 600,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            boxShadow: 'var(--shadow-md)',
                                            transition: 'transform 0.1s',
                                            marginLeft: 'auto',
                                            cursor: 'pointer',
                                            border: 'none'
                                        }}
                                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                        <Check size={18} strokeWidth={3} /> Archive
                                    </button>
                                </div>
                            </motion.div>
                        ) : (
                            <p style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 3, // Increased preview length
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                            }}>
                                {email.preview}
                            </p>
                        )}
                    </div>
                </div>
            </motion.div >

            {/* SubBucketPopover removed - feature not currently used */}
        </>
    );
};

const actionButtonStyle = {
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
    boxShadow: 'var(--shadow-sm)',
    cursor: 'pointer'
};
