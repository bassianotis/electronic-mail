import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { onPointerRecheck, pointerIsOver } from '../../utils/pointer';
import { motion, useDragControls } from 'framer-motion';
import { type Email } from '../../store/mailStore';
import { useDragDropActions } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { Check, Download, Layers } from 'lucide-react';
import { MailFrame } from '../Views/MailFrame';
import { ImagesStrip } from '../Views/ImagesStrip';
import { prepareBody } from '../../utils/remoteImages';
import { useRemoteImages } from '../../hooks/useRemoteImages';
import { sanitizeHtml } from '../../utils/sanitize';
import { useMessageBody } from '../../api/bodies';
import { urls } from '../../api/client';
import { bodyHtml } from '../../utils/emailMapper';
import { formatListDate } from '../../utils/formatDate';
import { DraftBadge } from '../Views/DraftBadge';
import { BodyFailure, BodySkeleton } from '../Loading/Skeletons';
import { type Arrivals, useEntrance } from '../../hooks/useArrivals';
import { DURATION, noNativeAnimation, tween } from '../../utils/motion';
import { showsOnPaper, stripToTheme } from '../../utils/mailLook';
import { splitQuotedContent } from '../../utils/quotes';
import { useDragLook } from '../../hooks/useDragLook';
import { inDockStrip } from '../../utils/dropTargets';
import { formatCount, formatSize } from '../../utils/format';
import { useServerUnreachable } from '../../api/reachability';


interface InboxItemProps {
    email: Email;
    isExpanded: boolean;
    onBucket: (emailId: string, bucketId: string) => void;
    onDone: (emailId: string) => void;
    onClick: () => void;
    threadCount?: number;
    onViewThread?: (email: Email) => void;
    /** The conversation holds a draft (the same badge bucket cards show). */
    hasDraft?: boolean;
    /** The list's arrivals: a card animates in only if it arrived while the list was showing. */
    arrivals?: Arrivals;
}

export const InboxItem: React.FC<InboxItemProps> = ({ email, isExpanded, onBucket, onDone, onClick, threadCount, onViewThread, hasDraft, arrivals }) => {
    const [isHovered, setIsHovered] = React.useState(false);
    // A card that slid into place under a still cursor (the one above it archived) gets no "mouse
    // entered", so once it settles it checks for itself: Archive shows whenever the mouse is over it.
    const checkHover = useCallback(() => {
        const over = pointerIsOver(itemRef.current);
        setIsHovered(was => (was === over ? was : over));
    }, []);
    useEffect(() => onPointerRecheck(checkHover), [checkHover]);
    const itemRef = useRef<HTMLDivElement>(null);
    const { setHoveredBucketId, setIsDragging } = useDragDropActions();
    const { buckets, markThreadSeen, activeAccount, activeAccountId, download, accounts } = useMail();
    // Filing (drag to a bucket) needs the server: off while it can't be reached
    const offline = useServerUnreachable();
    const viewPreference = activeAccount?.inboxView || 'expand';

    // The newest message's body, fetched when the card is opened
    const { body, error: bodyError, retry: retryBody } = useMessageBody(activeAccountId, email.msgKey, isExpanded);
    const bodyContent = body ? bodyHtml(body) : '';
    // Designed mail from someone else sits on paper; the rest is shown in the theme, its own look
    // stripped (utils/mailLook.ts: the same rule as the reading view, decided on the newest part)
    const fromMe = !!email.senderAddress && accounts.some(a => a.email.toLowerCase() === email.senderAddress!.toLowerCase());
    const paper = useMemo(() => !!body && showsOnPaper(splitQuotedContent(bodyContent).original, body, fromMe), [body, bodyContent, fromMe]);
    // Outside images: hidden (placeholders) until loaded for this message (utils/remoteImages.ts)
    const images = useRemoteImages(`${activeAccountId}:${email.msgKey}`);
    const shown = useMemo(
        () => (paper ? prepareBody(sanitizeHtml(bodyContent), 'paper', images.allowed) : prepareBody(stripToTheme(sanitizeHtml(bodyContent)).html, 'theme', images.allowed)),
        [bodyContent, paper, images.allowed]
    );
    const attachments = body?.attachments ?? [];
    const enters = useEntrance(arrivals, email.id);
    // Mail arriving while you look slides up 20px into place (the hook moves it: its y is the drag's)
    const look = useDragLook(itemRef, 0.4, enters ? 20 : 0);

    const dragControls = useDragControls();

    const isDraggingRef = useRef(false);

    // Control layout animation to prevent double-expansion
    const [enableLayoutAnim, setEnableLayoutAnim] = useState(false);
    // This card opening or closing moves at the slow, full pace; anything else (a gap closing as
    // a card above leaves) at 200ms, as in buckets
    const [lastExpanded, setLastExpanded] = useState(isExpanded);
    const [resizing, setResizing] = useState(false);
    if (lastExpanded !== isExpanded) {
        setLastExpanded(isExpanded);
        setResizing(true);
    }
    useEffect(() => {
        if (!resizing) return;
        const timer = setTimeout(() => setResizing(false), DURATION.slow * 1000 + 50);
        return () => clearTimeout(timer);
    }, [resizing]);

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

    // Opening a card marks the conversation read (once per opening)
    const markedAsReadRef = useRef<string | null>(null);

    useEffect(() => {
        if (isExpanded) {
            if (markedAsReadRef.current !== email.id) {
                markedAsReadRef.current = email.id;
                if (!email.read) markThreadSeen(email.threadId);
            }
        } else {
            markedAsReadRef.current = null; // Reset when collapsed
        }
    }, [isExpanded, email.id, email.read, email.threadId, markThreadSeen]);



    const handleArchive = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDone(email.id);
    };

    const handleDragStart = () => {
        isDraggingRef.current = true;
        setIsDragging(true);
        look.start();
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
                look.aim(foundBucketId);
                return;
            }
        }

        // Check bucket targets
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

    const handleDragEnd = (_event: any, info: any) => {
        setIsDragging(false);
        setHoveredBucketId(null);

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
                void look.land('archive', () => onDone(email.id)); // Archive uses the same handler as Done
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

        const to = droppedBucketId;
        void look.land(to, () => { if (to) onBucket(email.id, to); });

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

        // Don't collapse if clicking inside the email body content area
        // (Shadow DOM prevents target checks from seeing through to actual content)
        if (target.closest('[data-email-body]')) {
            return;
        }

        onClick();
    };

    const isThread = !!(threadCount && threadCount > 1);

    return (
        <>
            <motion.div
                className={isThread ? `thread-stack${threadCount === 2 ? ' thread-stack-pair' : ''}` : undefined}
                ref={itemRef}
                // Its own size, opening and closing; moving up into a gap is the list's (TriageInbox)
                layout={enableLayoutAnim && resizing}
                drag={!offline}
                dragControls={dragControls}
                dragListener={!isExpanded} // When expanded, only drag from handle
                dragElastic={0.1}
                dragMomentum={false}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                whileDrag={look.whileDrag}
                onPointerDownCapture={look.grab}
                initial={enters ? { opacity: 0 } : false}
                onUpdate={noNativeAnimation}
                animate={look.animate({
                    opacity: 1,
                    boxShadow: isExpanded ? 'var(--shadow-lg)' : (isHovered ? 'var(--shadow-md)' : 'var(--shadow-sm)')
                })}
                // Hover's shadow is quick; closing a gap matches the buckets' (200ms); opening a card takes its time
                transition={{ default: tween(DURATION.slow), boxShadow: tween(DURATION.fast), layout: tween(resizing ? DURATION.slow : DURATION.mid) }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onLayoutAnimationComplete={checkHover}
                onAnimationComplete={checkHover}
                onClick={handleClick}
                style={{
                    position: 'relative',
                    marginBottom: isExpanded ? 'var(--space-lg)' : 'var(--card-gap)',
                    backgroundColor: 'var(--surface-card)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    cursor: isExpanded ? 'default' : 'grab',
                    overflow: 'hidden',
                    transformOrigin: look.origin ?? dragOrigin,
                    x: look.x,
                    y: look.y,
                    zIndex: look.raised ? 9999 : undefined
                }}
            >
                <div
                    style={{
                        padding: 'var(--card-pad)',
                        cursor: isExpanded ? 'grab' : 'inherit'
                    }}
                    onPointerEnter={() => setDragOrigin('top center')}
                    onPointerDown={(e) => {
                        if (isExpanded) {
                            // Allow text selection on selectable elements (email body, sender name)
                            const target = e.target as HTMLElement;
                            const isTextSelectable = target.closest('[data-text-selectable="true"]') || target.closest('[data-email-body]');
                            if (!isTextSelectable) {
                                e.preventDefault(); // Prevent text selection only on non-selectable areas
                                dragControls.start(e); // Only start drag when not in selectable areas
                            }
                        }
                    }}
                >
                    {/* Header */}
                    {/* Dark (the Instrument trial): the meta line spans the card with its date on the right. On hover and
                        while the card is open, its Archive takes the date's spot (as mail apps put hover actions where the
                        date was), centred on that line, so it never moves when the card opens. */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-sm)', position: 'relative', gap: 'var(--space-md)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{
                                fontSize: 'var(--size-card-title)',
                                fontWeight: 'var(--weight-semibold)',
                                marginBottom: 'var(--space-xs)',
                                color: 'var(--color-text-main)'
                            }}>
                                {email.subject}
                            </h3>
                            <div style={{ display: 'flex', gap: 'var(--space-md)', color: 'var(--color-text-muted)', fontSize: 'var(--size-sender-line)', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span
                                    style={{
                                        fontWeight: 'var(--weight-semibold)',
                                        color: 'var(--sender-text)',
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
                                {hasDraft && <DraftBadge />}
                                {threadCount && threadCount > 1 && (
                                    <span style={{
                                        backgroundColor: 'var(--thread-badge)',
                                        color: 'var(--thread-badge-text)',
                                        fontSize: 'var(--font-size-2xs)',
                                        fontWeight: 'var(--weight-semibold)',
                                        padding: 'var(--thread-badge-pad)',
                                        borderRadius: 'var(--radius-full)',
                                        minWidth: '20px',
                                        textAlign: 'center',
                                        fontVariantNumeric: 'tabular-nums'
                                    }}>
                                        {formatCount(threadCount)}
                                    </span>
                                )}
                                {/* View Thread CTA - visible when thread has multiple emails and preference is expand */}
                                {threadCount && threadCount > 1 && onViewThread && viewPreference !== 'thread' && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onViewThread(email);
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            padding: '4px 12px',
                                            borderRadius: 'var(--radius-pill)',
                                            backgroundColor: 'var(--view-thread-bg)',
                                            border: '1px solid var(--view-thread-border)',
                                            color: 'var(--view-thread-text)',
                                            fontSize: 'var(--font-size-xs)',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--view-thread-hover-bg)';
                                            e.currentTarget.style.color = 'var(--view-thread-hover-text)';
                                            e.currentTarget.style.borderColor = 'var(--view-thread-hover-bg)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--view-thread-bg)';
                                            e.currentTarget.style.color = 'var(--view-thread-text)';
                                            e.currentTarget.style.borderColor = 'var(--view-thread-border)';
                                        }}
                                    >
                                        <Layers size={14} />
                                        View thread
                                    </button>
                                )}
                                {/* Archive sits in the date's spot, shown on hover or when open */}
                                    <span style={{ marginLeft: 'auto', position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <span style={{
                                            fontSize: 'var(--size-date)',
                                            color: 'var(--color-text-faint)',
                                            fontVariantNumeric: 'var(--date-numerals)',
                                            whiteSpace: 'nowrap',
                                            opacity: isHovered || isExpanded ? 0 : 1,
                                            transition: 'opacity var(--dur-fast) var(--ease)'
                                        }}>{formatListDate(email.date)}</span>
                                        <motion.button
                                            initial={false}
                                            animate={{ opacity: isHovered || isExpanded ? 1 : 0 }}
                                            transition={tween(DURATION.fast)}
                                            onClick={handleArchive}
                                            whileTap={{ scale: 0.97, transition: tween(DURATION.fast) }}
                                            style={{
                                                position: 'absolute',
                                                right: 0,
                                                top: '50%',
                                                y: '-50%',
                                                pointerEvents: isHovered || isExpanded ? 'auto' : 'none',
                                                height: '28px',
                                                padding: '0 12px',
                                                borderRadius: 'var(--radius-control)',
                                                backgroundColor: 'var(--archive-button-bg)',
                                                color: 'var(--archive-button-text)',
                                                border: 'var(--archive-button-border)',
                                                fontSize: '13px',
                                                fontWeight: 500,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                whiteSpace: 'nowrap',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <Check size={14} style={{ color: 'var(--archive-button-icon)' }} />
                                            Archive
                                        </motion.button>
                                    </span>
                            </div>

                        </div>

                    </div>

                    {/* Body Content */}
                    <div style={{
                        fontSize: 'var(--size-preview)',
                        color: 'var(--color-text-faint)',
                        lineHeight: 1.6
                    }}>
                        {isExpanded ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={tween(DURATION.slow)}
                            >
                                <div
                                    data-email-body
                                    style={{
                                        marginTop: 'var(--space-md)',
                                        padding: 'var(--opened-body-pad)',
                                        backgroundColor: 'var(--opened-body-bg)',
                                        border: 'var(--opened-body-border)',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'text',
                                        userSelect: 'text',
                                        WebkitUserSelect: 'text'
                                    }}
                                    data-text-selectable="true"
                                    onPointerDown={(e) => {
                                        // Stop propagation to prevent drag initiation from email body
                                        e.stopPropagation();
                                    }}
                                    onClick={(e) => {
                                        // Stop click from collapsing the expanded view
                                        e.stopPropagation();
                                    }}
                                >
                                    {bodyError ? (
                                        <BodyFailure minHeight={300} onRetry={retryBody} />
                                    ) : !body ? (
                                        <BodySkeleton minHeight={300} />
                                    ) : (
                                        <>
                                            {shown.remote && <ImagesStrip state={images.state} onLoad={images.load} variant="inline" />}
                                            <div style={{ marginTop: shown.remote ? 'var(--space-md)' : 0 }}>
                                                <MailFrame
                                                    html={shown.html}
                                                    look={paper ? 'paper' : 'theme'}
                                                    imagesAllowed={images.allowed}
                                                    fontSize={16}
                                                    minHeight={300}
                                                    onImagesSettled={images.settled}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {/* Attachments */}
                                    {attachments.length > 0 && (
                                        <div style={{
                                            marginTop: 'var(--space-lg)',
                                            paddingTop: 'var(--space-md)',
                                            borderTop: '1px solid var(--color-border)'
                                        }}>
                                            <div style={{
                                                fontSize: 'var(--font-size-sm)',
                                                fontWeight: 'var(--weight-semibold)',
                                                color: 'var(--color-text-muted)',
                                                marginBottom: 'var(--space-sm)'
                                            }}>
                                                Attachments ({formatCount(attachments.length)})
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                                                {attachments.map((attachment) => (
                                                    <a
                                                        key={attachment.part}
                                                        href={urls.attachment(activeAccountId ?? '', email.msgKey, attachment.part)}
                                                        download={attachment.filename ?? undefined}
                                                        onClick={e => {
                                                            e.preventDefault();
                                                            download(e.currentTarget.href, attachment.filename ?? `attachment-${attachment.part}`);
                                                        }}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 'var(--space-sm)',
                                                            padding: 'var(--space-sm)',
                                                            backgroundColor: 'var(--surface-card)',
                                                            border: '1px solid var(--color-border)',
                                                            borderRadius: 'var(--radius-sm)',
                                                            textDecoration: 'none',
                                                            color: 'var(--color-text-main)',
                                                            fontSize: 'var(--font-size-sm)',
                                                            cursor: 'pointer',
                                                            transition: 'background-color var(--dur-fast) var(--ease)'
                                                        }}
                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-card)'}
                                                    >
                                                        <Download size={16} />
                                                        <span style={{ flex: 1 }}>{attachment.filename ?? `attachment-${attachment.part}`}</span>
                                                        {attachment.size !== null && (
                                                            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
                                                                {formatSize(attachment.size)}
                                                            </span>
                                                        )}
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
                                        onClick={handleArchive}
                                        style={{
                                            backgroundColor: 'var(--archive-button-bg)',
                                            color: 'var(--archive-button-text)',
                                            padding: '8px 24px',
                                            borderRadius: 'var(--radius-pill)',
                                            fontWeight: 'var(--weight-semibold)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            boxShadow: 'var(--shadow-md)',
                                            transition: 'transform var(--dur-fast) var(--ease)',
                                            marginLeft: 'auto',
                                            cursor: 'pointer',
                                            border: 'var(--archive-button-border)'
                                        }}
                                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.97)'}
                                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                        <Check size={16} style={{ color: 'var(--archive-button-icon)' }} /> Archive
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
