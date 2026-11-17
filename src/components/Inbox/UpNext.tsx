/**
 * Up next (Explore 1, board X1HomeB): one strip above the Inbox with the conversations in buckets
 * marked "Show on home" and every draft, newest first (hooks/useUpNext.ts; the Inbox shows it and
 * its own list together). A bucket item opens its conversation, drags like an Inbox card and
 * archives from the card; a draft reopens where it was left. With nothing to show, the section
 * (heading included) isn't there at all.
 */
import React, { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Tooltip } from '../../ui/Tooltip';
import { useMail } from '../../context/MailContext';
import { useComposer } from '../../context/ComposerContext';
import { useDragDropActions } from '../../context/DragDropContext';
import { cardFromThread } from '../../utils/emailMapper';
import { usePublishList, type ListKey } from '../../hooks/conversationLists';
import { formatListDate } from '../../utils/formatDate';
import { dropTargetAt } from '../../utils/dropTargets';
import { DraftBadge } from '../Views/DraftBadge';
import { noNativeAnimation } from '../../utils/motion';
import { useDragLook } from '../../hooks/useDragLook';
import type { DraftSummary } from '../../api/types';
import type { UpNextDraft, UpNextItem, UpNextThread } from '../../hooks/useUpNext';
import type { Email } from '../../store/mailStore';
import { formatCount } from '../../utils/format';
import { useServerUnreachable } from '../../api/reachability';
import { focusNextBeforeLeaving, Z } from '../../utils/layers';

const pill: React.CSSProperties = {
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    color: 'var(--text-4)',
    fontSize: 'var(--size-caption)',
    fontWeight: 'var(--weight-medium)',
    padding: '0',
    borderRadius: 'var(--radius-full)',
    fontVariantNumeric: 'tabular-nums',
};

// minWidth 0: otherwise a flex item grows to its longest unwrapped line (a long "To:" address).
const slotStyle: React.CSSProperties = { flex: '0 0 236px', minWidth: 0, height: '120px', scrollSnapAlign: 'start' };

const cardStyle: React.CSSProperties = {
    position: 'relative',
    height: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--surface-1)',
    border: '1px solid var(--line-1)',
    borderRadius: 'var(--radius-3)',
    boxShadow: 'none',
};

// The whole card is one button (Enter opens it); the quick Archive sits on top of it.
const openStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    width: '100%',
    height: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    padding: 'var(--space-3) var(--space-4)',
    background: 'none',
    border: 'none',
    borderRadius: 'var(--radius-3)',
    textAlign: 'left',
    font: 'inherit',
    color: 'inherit',
    cursor: 'inherit',
};

const Subject = ({ text }: { text: string | null }) => (
    <span style={{
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        width: '100%',
        boxSizing: 'border-box',
        paddingRight: 'var(--space-6)', // clears the Archive button
        fontSize: 'var(--size-body)',
        fontWeight: 'var(--weight-medium)',
        lineHeight: 1.35,
        color: text ? 'var(--text-1)' : 'var(--text-3)',
    }}>
        {text || 'No subject'}
    </span>
);

const Meta = ({ who, count, date }: { who: string | null; count: number; date: string | null }) => (
    <span style={{
        marginTop: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        minWidth: 0,
        whiteSpace: 'nowrap',
        fontSize: 'var(--size-caption)',
        color: 'var(--text-3)',
    }}>
        {who && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{who}</span>}
        {count > 1 && (
            <span style={{
                flexShrink: 0,
                backgroundColor: 'transparent',
                color: 'var(--text-4)',
                fontSize: 'var(--size-caption)',
                fontWeight: 'var(--weight-medium)',
                padding: '0',
                borderRadius: 'var(--radius-full)',
                minWidth: '20px',
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
            }}>
                {formatCount(count)}
            </span>
        )}
        {date && <span style={{ flexShrink: 0, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>{formatListDate(new Date(date))}</span>}
    </span>
);

/** A conversation from a bucket on home: opens, drags like an Inbox card, archives from the card. */
const ThreadCardItem: React.FC<{ item: UpNextThread; bucketIds: string[]; onOpen: () => void; onMove: (to: string) => void }> = ({ item, bucketIds, onOpen, onMove }) => {
    const { setHoveredBucketId, setIsDragging } = useDragDropActions();
    const offline = useServerUnreachable(); // filing waits for the server
    const slotRef = useRef<HTMLDivElement>(null);
    const dragged = useRef(false);
    const t = item.thread;
    const look = useDragLook(slotRef);
    // While away from its slot (dragged, going home, fading where it was dropped), the card is held
    // where it was with position: fixed, so the strip's scrolling box doesn't clip it on its way to
    // the dock; its slot keeps the space.
    const [slot, setSlot] = useState<DOMRect | null>(null);
    const lifted = look.raised ? slot : null;

    return (
        <div ref={slotRef} style={slotStyle}>
            <motion.div
                className={`upnext-card${t.messageCount > 1 ? ` thread-stack${t.messageCount === 2 ? ' thread-stack-pair' : ''}` : ''}`}
                drag={!offline}
                dragElastic={0.1}
                dragMomentum={false}
                onPointerDownCapture={look.grab}
                onDragStart={() => {
                    dragged.current = true;
                    setSlot(slotRef.current?.getBoundingClientRect() ?? null);
                    setIsDragging(true);
                    look.start();
                }}
                onDrag={(_e, info) => {
                    const to = dropTargetAt(info.point, bucketIds, true);
                    setHoveredBucketId(to);
                    look.aim(to);
                }}
                onDragEnd={(_e, info) => {
                    setIsDragging(false);
                    setHoveredBucketId(null);
                    const to = dropTargetAt(info.point, bucketIds, true);
                    void look.land(to, () => { if (to) onMove(to); });
                    setTimeout(() => { dragged.current = false; }, 100);
                }}
                onUpdate={noNativeAnimation}
                whileDrag={look.whileDrag}
                animate={look.animate({ opacity: 1, scale: 1 })}
                style={{
                    ...cardStyle,
                    cursor: 'grab',
                    originX: look.originX,
                    originY: look.originY,
                    x: look.x,
                    y: look.y,
                    ...(lifted ? { position: 'fixed', top: lifted.top, left: lifted.left, width: lifted.width, height: lifted.height, zIndex: Z.drag.card } : {}),
                }}
            >
                <button type="button" data-thread-link="" onClick={() => { if (!dragged.current) onOpen(); }} style={openStyle}>
                    <span style={{ ...pill, alignSelf: 'flex-start' }}>{item.bucket.label}</span>
                    <Subject text={t.subject} />
                    <Meta who={t.fromName || t.fromAddr || 'Unknown'} count={t.messageCount} date={t.latestDate} />
                </button>
                <Tooltip content="Archive">
                    <button
                        type="button"
                        className="upnext-archive"
                        aria-label="Archive"
                        onClick={() => { focusNextBeforeLeaving(slotRef.current); onMove('archive'); }} // rule K7
                        style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            width: '32px',
                            height: '32px',
                            borderRadius: 'var(--radius-full)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'var(--surface-raised)',
                            color: 'var(--success)',
                            border: '1px solid var(--line-2)',
                            boxShadow: 'none',
                        }}
                    >
                        <Check size={16} />
                    </button>
                </Tooltip>
            </motion.div>
        </div>
    );
};

/** A draft: reopens where it was left. Drafts aren't draggable. The one closed last has a soft ring. */
const DraftCardItem: React.FC<{ item: UpNextDraft; me: string; recent: boolean; onOpen: () => void }> = ({ item, me, recent, onOpen }) => {
    const d = item.draft;
    // The summary lists the sender first, then To and Cc (addresses only): show the first one that isn't you.
    const to = d.recipients.find(a => a !== me) ?? d.recipients[0];
    return (
        <div style={slotStyle}>
            <div style={recent ? { ...cardStyle, border: '1px solid var(--action)', boxShadow: 'none' } : cardStyle}>
                <button type="button" data-thread-link="" onClick={onOpen} style={{ ...openStyle, cursor: 'pointer' }}>
                    <span style={{ alignSelf: 'flex-start' }}><DraftBadge /></span>
                    <Subject text={d.subject} />
                    <Meta who={to ? `To: ${to}` : null} count={0} date={d.date} />
                </button>
            </div>
        </div>
    );
};

interface UpNextProps {
    items: UpNextItem[];
    /** Opens a conversation, saying which list it was opened from (for previous / next). */
    onSelectEmail: (email: Email, list?: ListKey) => void;
    onOpenDraft: (draft: DraftSummary) => void;
}

export const UpNext: React.FC<UpNextProps> = ({ items, onSelectEmail, onOpenDraft }) => {
    const { activeAccount, buckets, folderLabel, moveThread, undoMove, showToast } = useMail();
    const bucketIds = useMemo(() => buckets.map(b => b.id), [buckets]);
    const me = (activeAccount?.email ?? '').toLowerCase();
    const { recentDraft, discarding } = useComposer();
    // The draft closed last this session comes first (Explore 2, C16); one just discarded (its
    // notice still offers Undo) isn't shown.
    const isRecent = (item: UpNextItem) => item.kind === 'draft' && item.draft.msgKey === recentDraft;
    const shown = useMemo(() => {
        const kept = items.filter(i => i.kind !== 'draft' || !discarding.includes(i.draft.msgKey));
        return [...kept.filter(isRecent), ...kept.filter(i => !isRecent(i))];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, recentDraft, discarding]);

    // The same move, notice and Undo as on a bucket's own screen.
    const move = async (item: UpNextThread, to: string) => {
        if (to === item.bucket.id) return;
        const taskId = await moveThread(item.thread.threadId, to);
        if (taskId === null) return;
        const where = to === 'inbox' ? 'Inbox' : folderLabel(to);
        showToast({
            message: to === 'archive' ? 'Archived' : <>Moved to <strong>{where}</strong></>,
            actions: [{ label: 'Undo', onClick: () => void undoMove(taskId) }],
        });
    };

    // Its conversations, for previous / next (its drafts open the composer instead)
    const conversations = useMemo(() => shown.flatMap(i => (i.kind === 'thread' ? [cardFromThread(i.thread)] : [])), [shown]);
    usePublishList('upnext', conversations);

    if (!shown.length) return null;

    return (
        <section aria-label="Up next" style={{ marginBottom: '36px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <h2 style={{
                    margin: 0,
                    fontSize: 'var(--size-body)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-3)'
                }}>
                    Up next
                </h2>
                <span style={pill}>{formatCount(shown.length)}</span>
            </div>
            <div className="upnext-row" data-thread-list="" style={{ display: 'flex', gap: 'var(--space-3)', overflowX: 'auto', scrollSnapType: 'x mandatory', padding: '2px 2px var(--space-2)', margin: '0 -2px' }}>
                {shown.map(item => item.kind === 'thread' ? (
                    <ThreadCardItem
                        key={item.key}
                        item={item}
                        bucketIds={bucketIds}
                        onOpen={() => onSelectEmail(cardFromThread(item.thread), 'upnext')}
                        onMove={to => void move(item, to)}
                    />
                ) : (
                    <DraftCardItem key={item.key} item={item} me={me} recent={isRecent(item)} onOpen={() => onOpenDraft(item.draft)} />
                ))}
            </div>
        </section>
    );
};
