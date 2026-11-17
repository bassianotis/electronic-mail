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
import { ThreadLink } from '../Views/ThreadLink';
import { BodyFailure, BodySkeleton } from '../Loading/Skeletons';
import { type Arrivals, useEntrance } from '../../hooks/useArrivals';
import { DURATION, leave, noNativeAnimation, tween } from '../../utils/motion';
import { showsOnPaper, stripToTheme } from '../../utils/mailLook';
import { splitQuotedContent } from '../../utils/quotes';
import { useDragLook } from '../../hooks/useDragLook';
import { inDockStrip } from '../../utils/dropTargets';
import { formatCount, formatSize } from '../../utils/format';
import { useServerUnreachable } from '../../api/reachability';
import { focusNextBeforeLeaving, Z } from '../../utils/layers';
import { Button } from '../../ui/Button';


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
    // Nothing only on hover (rule A5): keyboard focus in the card shows its Archive too
    const [keyFocus, setKeyFocus] = React.useState(false);
    const showArchive = isHovered || isExpanded || keyFocus;
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
    const look = useDragLook(itemRef, enters ? 20 : 0);

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

    // Before the card is first grabbed: which end it scales from (the top, or the bottom over the reply)
    const [restOriginY, setRestOriginY] = useState(0);

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
        focusNextBeforeLeaving(itemRef.current); // rule K7: the next card, not the page
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
                void look.land('archive', () => { focusNextBeforeLeaving(itemRef.current); onDone(email.id); }); // Archive uses the same handler as Done
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
        void look.land(to, () => { if (to) { focusNextBeforeLeaving(itemRef.current); onBucket(email.id, to); } });

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
                    boxShadow: 'none'
                })}
                // Hover's shadow is quick; closing a gap matches the buckets' (200ms); opening a card takes its time
                transition={{ default: tween(DURATION.slow), boxShadow: tween(DURATION.fast), layout: tween(resizing ? DURATION.slow : DURATION.mid) }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onFocus={e => setKeyFocus((e.target as HTMLElement).matches(':focus-visible'))}
                onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyFocus(false); }}
                onLayoutAnimationComplete={checkHover}
                onAnimationComplete={checkHover}
                onClick={handleClick}
                data-thread-card=""
                style={{
                    position: 'relative',
                    marginBottom: isExpanded ? 'var(--space-6)' : 'var(--card-gap)',
                    backgroundColor: 'var(--surface-1)',
                    borderRadius: 'var(--radius-3)',
                    border: '1px solid var(--line-1)',
                    cursor: isExpanded ? 'default' : 'grab',
                    overflow: 'hidden',
                    originX: look.originX ?? 0.5,
                    originY: look.originY ?? restOriginY,
                    x: look.x,
                    y: look.y,
                    zIndex: look.raised ? Z.drag.card : undefined
                }}
            >
                <div
                    style={{
                        padding: 'var(--card-padding)',
                        cursor: isExpanded ? 'grab' : 'inherit'
                    }}
                    onPointerEnter={() => setRestOriginY(0)}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)', position: 'relative', gap: 'var(--space-4)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{
                                fontSize: 'var(--size-title)',
                                fontWeight: 'var(--weight-medium)',
                                marginBottom: 'var(--space-1)',
                                color: 'var(--text-1)'
                            }}>
                                <ThreadLink threadId={email.threadId} onOpen={() => { if (!isDraggingRef.current) onClick(); }}>{email.subject}</ThreadLink>
                            </h3>
                            <div style={{ display: 'flex', gap: 'var(--space-4)', color: 'var(--text-3)', fontSize: 'var(--size-body)', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span
                                    style={{
                                        fontWeight: 'var(--weight-medium)',
                                        color: 'var(--text-3)',
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
                                            gap: 'var(--space-1)',
                                            padding: 'var(--space-1) var(--space-3)',
                                            borderRadius: 'var(--radius-2)',
                                            backgroundColor: 'transparent',
                                            border: '1px solid transparent',
                                            color: 'var(--text-4)',
                                            fontSize: 'var(--size-caption)',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'background-color var(--dur-instant) var(--ease-in), color var(--dur-instant) var(--ease-in), border-color var(--dur-instant) var(--ease-in)'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                            e.currentTarget.style.color = 'var(--text-1)';
                                            e.currentTarget.style.borderColor = 'transparent';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                            e.currentTarget.style.color = 'var(--text-4)';
                                            e.currentTarget.style.borderColor = 'transparent';
                                        }}
                                    >
                                        <Layers size={14} />
                                        View thread
                                    </button>
                                )}
                                {/* Archive sits in the date's spot, shown on hover or when open */}
                                    <span style={{ marginLeft: 'auto', position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <span style={{
                                            fontSize: '1em',
                                            color: 'var(--text-4)',
                                            fontVariantNumeric: 'tabular-nums',
                                            whiteSpace: 'nowrap',
                                            opacity: showArchive ? 0 : 1,
                                            transition: 'opacity var(--dur-instant) var(--ease-in)'
                                        }}>{formatListDate(email.date)}</span>
                                        {/* The shared Button's look (secondary, 28), faded in and out where the date is */}
                                        <motion.button
                                            type="button"
                                            className="ba-button ba-button--secondary ba-button--sm"
                                            initial={false}
                                            animate={{ opacity: showArchive ? 1 : 0 }}
                                            transition={showArchive ? tween(DURATION.instant) : leave(DURATION.instant)}
                                            onClick={handleArchive}
                                            style={{
                                                position: 'absolute',
                                                right: 0,
                                                top: '50%',
                                                y: '-50%',
                                                pointerEvents: showArchive ? 'auto' : 'none'
                                            }}
                                        >
                                            <Check size={14} aria-hidden="true" style={{ color: 'var(--success)' }} />
                                            Archive
                                        </motion.button>
                                    </span>
                            </div>

                        </div>

                    </div>

                    {/* Body Content */}
                    <div style={{
                        fontSize: 'var(--size-body)',
                        color: 'var(--text-4)',
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
                                        marginTop: 'var(--space-4)',
                                        padding: '0',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        borderRadius: 'var(--radius-3)',
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
                                            <div style={{ marginTop: shown.remote ? 'var(--space-4)' : 0 }}>
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
                                            marginTop: 'var(--space-6)',
                                            paddingTop: 'var(--space-4)',
                                            borderTop: '1px solid var(--line-1)'
                                        }}>
                                            <div style={{
                                                fontSize: 'var(--size-body)',
                                                fontWeight: 'var(--weight-medium)',
                                                color: 'var(--text-3)',
                                                marginBottom: 'var(--space-2)'
                                            }}>
                                                Attachments ({formatCount(attachments.length)})
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
                                                            gap: 'var(--space-2)',
                                                            padding: 'var(--space-2)',
                                                            backgroundColor: 'var(--surface-1)',
                                                            border: '1px solid var(--line-1)',
                                                            borderRadius: 'var(--radius-2)',
                                                            textDecoration: 'none',
                                                            color: 'var(--text-1)',
                                                            fontSize: 'var(--size-body)',
                                                            cursor: 'pointer',
                                                            transition: 'background-color var(--dur-instant) var(--ease-in)'
                                                        }}
                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-1)'}
                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-1)'}
                                                    >
                                                        <Download size={16} />
                                                        <span style={{ flex: 1 }}>{attachment.filename ?? `attachment-${attachment.part}`}</span>
                                                        {attachment.size !== null && (
                                                            <span style={{ color: 'var(--text-3)', fontSize: 'var(--size-caption)' }}>
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
                                        marginTop: 'var(--space-6)',
                                        display: 'flex',
                                        gap: 'var(--space-2)',
                                        borderTop: '1px solid var(--line-1)',
                                        paddingTop: 'var(--space-4)',
                                        cursor: isExpanded ? 'grab' : 'inherit'
                                    }}
                                    onPointerEnter={() => setRestOriginY(1)}
                                    onPointerDown={(e) => {
                                        if (isExpanded) {
                                            // Allow text selection - buttons already have stopPropagation
                                            e.preventDefault();
                                            dragControls.start(e);
                                        }
                                    }}
                                >
                                    <Button icon={<Check size={16} aria-hidden="true" style={{ color: 'var(--success)' }} />} onClick={handleArchive} style={{ marginLeft: 'auto' }}>
                                        Archive
                                    </Button>
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
