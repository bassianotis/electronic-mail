import React, { useCallback, useState, useMemo } from 'react';
import { motion, type PanInfo } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive } from 'lucide-react';
import { type Email } from '../../store/mailStore';
import { useMail } from '../../context/MailContext';
import { useDragDropActions } from '../../context/DragDropContext';
import { useThreadList } from '../../hooks/useThreadList';
import { cardFromThread } from '../../utils/emailMapper';
import { formatListDate } from '../../utils/formatDate';
import { type Arrivals, useArrivals, useEntrance } from '../../hooks/useArrivals';
import { AfterDelay, ArchiveRowSkeleton } from '../Loading/Skeletons';
import { LoadMore } from '../Loading/LoadMore';
import { usePublishList, type ListKey } from '../../hooks/conversationLists';
import { DURATION, noNativeAnimation, tween } from '../../utils/motion';
import { inDockStrip } from '../../utils/dropTargets';
import { useDragLook } from '../../hooks/useDragLook';
import { formatCount } from '../../utils/format';
import { useServerUnreachable } from '../../api/reachability';

// A row and the gap below it, until a row is measured (most are exactly this).
const ROW_ESTIMATE = 106 + 16;


interface ArchiveViewProps {
    /** Opens a conversation, saying which list it was opened from (for previous / next). */
    onSelectEmail: (email: Email, list?: ListKey) => void;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({ onSelectEmail }) => {
    const { activeAccountId, folders, folderLabel, moveThread, undoMove, showToast } = useMail();
    // The old app listed conversations holding only mail you sent here too; they still are.
    const list = useThreadList(activeAccountId, folders.archive ? { location: folders.archive, withSentOnly: true } : null, 50);
    const cards = useMemo(() => list.threads.map(cardFromThread), [list.threads]);
    usePublishList('archive', cards, { total: list.count, hasMore: list.hasMore, loadMore: list.loadMore });
    const emailCount = useMemo(() => cards.reduce((n, c) => n + (c.threadCount ?? 1), 0), [cards]);
    const arrivals = useArrivals(!list.loading, cards);

    // The Archive holds tens of thousands of conversations: only the rows near the screen are
    // drawn. The page scrolls in the layout's <main>, where the list starts below the heading.
    const [scroller, setScroller] = useState<{ main: HTMLElement | null; top: number }>({ main: null, top: 0 });
    const listRef = useCallback((el: HTMLDivElement | null) => {
        if (el) setScroller({ main: el.closest('main'), top: el.offsetTop });
    }, []);
    const virtualizer = useVirtualizer({
        count: cards.length,
        getScrollElement: () => scroller.main,
        estimateSize: () => ROW_ESTIMATE,
        overscan: 8,
        scrollMargin: scroller.top,
        getItemKey: index => cards[index].id,
    });

    const handleRestore = async (email: Email, target: string) => {
        const taskId = await moveThread(email.threadId, target);
        if (taskId === null) return;
        const where = target === 'inbox' ? 'Inbox' : folderLabel(target);
        showToast({
            message: <>Restored to <strong>{where}</strong></>,
            actions: [
                { label: 'Undo', onClick: () => void undoMove(taskId) },
                { label: 'Open', onClick: () => onSelectEmail({ ...email, location: target === 'inbox' ? folders.inbox : target }) },
            ],
        });
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingTop: 'var(--space-xl)', paddingBottom: '140px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-lg)' }}>
                <div>
                    <h2 style={{ fontSize: 'var(--size-page-heading)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-xs)' }}>
                        Archive
                    </h2>
                </div>
                <span className="text-muted" style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {formatCount(list.count)} threads{list.hasMore ? ` (${formatCount(cards.length)} loaded)` : ` (${formatCount(emailCount)} emails)`}
                </span>
            </div>

            {list.loading && folders.archive ? (
                <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <AfterDelay>
                        {[0, 1, 2, 3, 4, 5].map(i => <ArchiveRowSkeleton key={i} />)}
                    </AfterDelay>
                </div>
            ) : list.error ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-3xl)', color: 'var(--color-text-muted)' }}>
                    Couldn't load the archive: {list.error}
                </div>
            ) : cards.length === 0 ? (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{
                        textAlign: 'center',
                        padding: 'var(--space-3xl)',
                        color: 'var(--color-text-muted)'
                    }}
                >
                    <Archive size={48} style={{ marginBottom: 'var(--space-md)', opacity: 0.3 }} />
                    <p>No archived emails</p>
                </motion.div>
            ) : (
                <>
                    <div ref={listRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
                        {virtualizer.getVirtualItems().map(row => {
                            const email = cards[row.index];
                            return (
                                <div
                                    key={row.key}
                                    data-index={row.index}
                                    ref={virtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        width: '100%',
                                        // top, not a transform: a transform would make each row a layer of its own,
                                        // and the rows below would cover a card dragged out of it
                                        top: row.start - scroller.top,
                                        paddingBottom: 'var(--space-md)'
                                    }}
                                >
                                    <ArchiveItem
                                        email={email}
                                        threadCount={email.threadCount}
                                        arrivals={arrivals}
                                        onClick={() => onSelectEmail(email, 'archive')}
                                        onUnarchive={(email, targetLocation) => void handleRestore(email, targetLocation)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                    <LoadMore list={list} skeletons={(
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                            {[0, 1, 2].map(i => <ArchiveRowSkeleton key={i} />)}
                        </div>
                    )} />
                </>
            )}
        </div>
    );
};

interface ArchiveItemProps {
    email: Email;
    onClick: () => void;
    onUnarchive: (email: Email, targetLocation: string) => void;
    threadCount?: number;
    /** The list's arrivals: a row animates in only if it arrived while the list was showing. */
    arrivals?: Arrivals;
}

export const ArchiveItem = React.forwardRef<HTMLDivElement, ArchiveItemProps>(
    ({ email, onClick, onUnarchive, threadCount, arrivals }, ref) => {
        const { setHoveredBucketId, setIsDragging } = useDragDropActions();
        const { buckets } = useMail();
        const offline = useServerUnreachable(); // filing waits for the server
        const [showSenderEmail, setShowSenderEmail] = useState(false);
        const isDraggingRef = React.useRef(false);
        const cardRef = React.useRef<HTMLDivElement | null>(null);
        const setRef = (el: HTMLDivElement | null) => {
            cardRef.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
        };
        const look = useDragLook(cardRef, 0.6);
        const enters = useEntrance(arrivals, email.id);

        const handleDragStart = () => {
            isDraggingRef.current = true;
            setIsDragging(true);
            look.start();
        };

        const handleDrag = (_event: PointerEvent, info: PanInfo) => {
            const dropPoint = { x: info.point.x, y: info.point.y };
            let foundTarget: string | null = null;

            // Check inbox
            const inboxElement = document.getElementById('inbox-target');
            if (inboxElement) {
                const rect = inboxElement.getBoundingClientRect();
                if (
                    dropPoint.x >= rect.left &&
                    dropPoint.x <= rect.right &&
                    dropPoint.y >= rect.top &&
                    dropPoint.y <= rect.bottom
                ) {
                    foundTarget = 'inbox';
                    setHoveredBucketId(foundTarget);
                    look.aim(foundTarget);
                    return;
                }
            }

            // Check buckets
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
                        foundTarget = bucket.id;
                        break;
                    }
                }
            }
            setHoveredBucketId(foundTarget);
            look.aim(foundTarget);
        };

        const handleDragEnd = (_event: PointerEvent, info: PanInfo) => {
            setIsDragging(false);
            setHoveredBucketId(null);

            const dropPoint = { x: info.point.x, y: info.point.y };
            let targetLocation: string | null = null;

            // Check for inbox target
            const inboxElement = document.getElementById('inbox-target');
            if (inboxElement) {
                const rect = inboxElement.getBoundingClientRect();
                if (
                    dropPoint.x >= rect.left &&
                    dropPoint.x <= rect.right &&
                    dropPoint.y >= rect.top &&
                    dropPoint.y <= rect.bottom
                ) {
                    targetLocation = 'inbox';
                }
            }

            // Check for bucket targets if not dropped on inbox
            if (!targetLocation) {
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
                            targetLocation = bucket.id;
                            break;
                        }
                    }
                }
            }

            const to = targetLocation;
            void look.land(to, () => { if (to) onUnarchive(email, to); });

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
        const isSentOnly = email.mailbox === 'Sent';

        return (
            <motion.div
                ref={setRef}
                onPointerDownCapture={look.grab}
                className={`em-card${isThread ? ` thread-stack${threadCount === 2 ? ' thread-stack-pair' : ''}` : ''}`}
                drag={!isSentOnly && !offline}
                dragElastic={0.1}
                dragMomentum={false}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                whileDrag={look.whileDrag}
                onClick={handleClick}
                initial={enters ? { opacity: 0, scale: 0.95 } : false}
                onUpdate={noNativeAnimation}
                animate={look.animate({ opacity: 1, scale: 1 })}
                exit={{ opacity: 0, scale: 0.97, transition: tween(DURATION.mid) }}
                transition={tween(DURATION.mid)}
                style={{
                    backgroundColor: 'var(--surface-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--card-pad)',
                    cursor: isSentOnly ? 'pointer' : 'grab',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-sm)',
                    position: 'relative',
                    transformOrigin: look.origin,
                    x: look.x,
                    y: look.y,
                    zIndex: look.raised ? 9999 : undefined
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
                            <span
                                style={{
                                    fontSize: 'var(--size-list-sender)',
                                    fontWeight: 'var(--weight-semibold)',
                                    color: 'var(--color-text-main)',
                                    cursor: email.senderAddress ? 'pointer' : 'default'
                                }}
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
                                    backgroundColor: 'var(--thread-badge)',
                                    color: 'var(--thread-badge-text)',
                                    fontSize: 'var(--font-size-2xs)',
                                    fontWeight: 'var(--weight-semibold)',
                                    padding: 'var(--thread-badge-pad)',
                                    borderRadius: 'var(--radius-full)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '16px',
                                    minWidth: '16px',
                                    fontVariantNumeric: 'tabular-nums'
                                }}>
                                    {formatCount(threadCount)}
                                </span>
                            )}
                        </div>
                        <h3 style={{
                            fontSize: 'var(--size-list-title)',
                            fontWeight: 'var(--weight-semibold)',
                            color: 'var(--color-text-main)',
                            margin: '4px 0'
                        }}>
                            {email.subject}
                        </h3>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 'var(--size-list-date)', color: 'var(--color-text-faint)', fontVariantNumeric: 'var(--date-numerals)', minWidth: '120px' }}>
                        <div>{isSentOnly ? 'Sent' : 'Received'} {formatListDate(email.date)}</div>
                    </div>
                </div>

            </motion.div>
        );
    });
