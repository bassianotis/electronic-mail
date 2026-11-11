import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { InboxItem } from './InboxItem';
import { UpNext } from './UpNext';
import { type Email } from '../../store/mailStore';
import { isToday, isYesterday, subDays, isAfter } from 'date-fns';
import { useMail } from '../../context/MailContext';
import { useConnection } from '../../api/events';
import { useThreadList } from '../../hooks/useThreadList';
import { cardFromThread } from '../../utils/emailMapper';
import type { DraftSummary } from '../../api/types';
import { useArrivals } from '../../hooks/useArrivals';
import { AfterDelay, Bone, InboxCardSkeleton } from '../Loading/Skeletons';
import { useUpNext } from '../../hooks/useUpNext';
import { usePublishList, type ListKey } from '../../hooks/conversationLists';
import { watchForMoves } from '../../utils/pointer';
import { useDragDrop } from '../../context/DragDropContext';
import { DURATION, tween } from '../../utils/motion';
import { LoadMore } from '../Loading/LoadMore';
import { formatTimeAgo } from '../../utils/formatDate';
import { formatCount } from '../../utils/format';

interface TriageInboxProps {
    /** Opens a conversation, saying which list it was opened from (for previous / next). */
    onSelectEmail: (email: Email, list?: ListKey) => void;
    /** A draft picked in Up next: reopen it where it was left. */
    onOpenDraft: (draft: DraftSummary) => void;
}

export const TriageInbox: React.FC<TriageInboxProps> = ({ onSelectEmail, onOpenDraft }) => {
    const { activeAccountId, activeAccount, folders, folderLabel, moveThread, undoMove, showToast, draftThreadIds } = useMail();
    const connection = useConnection(activeAccountId);
    const list = useThreadList(activeAccountId, { location: folders.inbox }, 500);
    const upNext = useUpNext(activeAccountId);
    const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
    // While a card is dragged, the list holds still: a list that re-measured itself mid-drag (as
    // the page redraws for a highlighted target) would nudge the dragged card off the pointer
    const { isDragging } = useDragDrop();
    // Cards that come, go or move under a still mouse check whether it's over them (utils/pointer.ts)
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => (listRef.current ? watchForMoves(listRef.current, DURATION.slow * 1000 + 150) : undefined), []);
    // Up next and the Inbox appear together: one arriving after the other would push the page about.
    const ready = !list.loading && upNext.ready;

    // One card per conversation, newest first (the engine's order)
    const inboxEmails = useMemo(() => list.threads.map(cardFromThread), [list.threads]);
    usePublishList('inbox', inboxEmails, { total: list.count, hasMore: list.hasMore, loadMore: list.loadMore });
    const arrivals = useArrivals(ready, inboxEmails);
    // A new account's first sync: nothing here yet while the account connects
    const firstSync = !list.loading && !list.error && inboxEmails.length === 0 && connection === 'connecting';
    const lastSyncAt = activeAccount?.lastSyncAt ? new Date(activeAccount.lastSyncAt) : null;

    const handleBucket = async (emailId: string, bucketId: string) => {
        const email = inboxEmails.find(e => e.id === emailId);
        if (!email) return;
        const taskId = await moveThread(email.threadId, bucketId);
        if (taskId === null) return;
        showToast({
            message: <>Filed to <strong>{folderLabel(bucketId)}</strong></>,
            actions: [
                { label: 'Undo', onClick: () => void undoMove(taskId) },
                { label: 'Open', onClick: () => onSelectEmail({ ...email, location: bucketId }) },
            ],
        });
    };

    const handleDone = async (emailId: string) => {
        const email = inboxEmails.find(e => e.id === emailId);
        if (!email) return;
        if (expandedEmailId === emailId) setExpandedEmailId(null);
        const taskId = await moveThread(email.threadId, 'archive');
        if (taskId === null) return;
        showToast({ message: 'Archived', actions: [{ label: 'Undo', onClick: () => void undoMove(taskId) }] });
    };

    const handleToggleExpand = (email: Email) => {
        if (activeAccount?.inboxView === 'thread') {
            handleViewThread(email);
        } else {
            setExpandedEmailId(prev => prev === email.id ? null : email.id);
        }
    };

    const handleViewThread = (email: Email) => {
        // Collapse the expanded card first
        setExpandedEmailId(null);
        // Then open the conversation view in App.tsx
        onSelectEmail(email, 'inbox');
    };

    // Segmentation Logic
    const today = new Date();
    const lastWeekStart = subDays(today, 7);
    const twoWeeksAgoStart = subDays(today, 14);

    const segments = {
        today: [] as Email[],
        yesterday: [] as Email[],
        pastWeek: [] as Email[],
        lastWeek: [] as Email[],
        earlier: [] as Email[]
    };

    inboxEmails.forEach(email => {
        const date = email.date;
        if (isToday(date)) {
            segments.today.push(email);
        } else if (isYesterday(date)) {
            segments.yesterday.push(email);
        } else if (isAfter(date, lastWeekStart)) {
            segments.pastWeek.push(email);
        } else if (isAfter(date, twoWeeksAgoStart)) {
            segments.lastWeek.push(email);
        } else {
            segments.earlier.push(email);
        }
    });

    // One list, headings and cards side by side (not a block per heading), so whatever leaves, a
    // card or a heading whose last card went, fades where it is while everything below slides up
    // as one, at 200ms: as in buckets (motion-audit.md, L8)
    const sections: [string, Email[]][] = [
        ['Today', segments.today], ['Yesterday', segments.yesterday], ['Past Week', segments.pastWeek],
        ['Last Week', segments.lastWeek], ['Earlier', segments.earlier],
    ];
    const listItems = sections.flatMap(([title, items]) => (items.length === 0 ? [] : [
        <motion.h3
            key={`heading:${title}`}
            layout={isDragging ? false : 'position'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tween(DURATION.mid)}
            className="text-muted"
            style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--weight-semibold)',
                textTransform: 'var(--label-case)' as React.CSSProperties['textTransform'],
                letterSpacing: 'var(--label-tracking)',
                margin: 'var(--space-lg) 0 var(--space-md)'
            }}
        >
            {title}
        </motion.h3>,
        // Each card in a wrapper the list moves: it slides up into a gap and, leaving, fades and
        // shrinks a little where it is, as in buckets (framer moves only the list's own children)
        ...items.map(email => (
            <motion.div key={email.id} layout={isDragging ? false : 'position'} exit={{ opacity: 0, scale: 0.97 }} transition={tween(DURATION.mid)}>
            <InboxItem
                email={email}
                isExpanded={expandedEmailId === email.id}
                onBucket={handleBucket}
                onDone={handleDone}
                onClick={() => handleToggleExpand(email)}
                threadCount={email.threadCount}
                onViewThread={handleViewThread}
                hasDraft={draftThreadIds.has(email.threadId)}
                arrivals={arrivals}
            />
            </motion.div>
        )),
    ]));

    return (
        <div ref={listRef} style={{ maxWidth: '800px', margin: '0 auto', paddingTop: 'var(--space-xl)', paddingBottom: '140px' }}>
            {!ready ? (
                // Waiting for both: blank, then (if the wait is noticeable) the heading and card skeletons
                <div aria-busy="true">
                    <AfterDelay>
                        <Bone w={110} h={28} r="var(--radius-sm)" style={{ marginBottom: 'var(--space-lg)' }} />
                        {[0, 1, 2, 3].map(i => <InboxCardSkeleton key={i} />)}
                    </AfterDelay>
                </div>
            ) : (<>
            <UpNext items={upNext.items} onSelectEmail={onSelectEmail} onOpenDraft={onOpenDraft} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                    <h2 style={{
                        fontSize: 'var(--size-page-heading)',
                        fontWeight: 'var(--weight-bold)',
                        color: 'var(--color-text-main)'
                    }}>
                        Inbox
                    </h2>
                    {firstSync && (
                        <span role="status" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                            <span aria-hidden="true" className="sync-dot" />
                            {lastSyncAt ? `Syncing… last synced ${formatTimeAgo(lastSyncAt, new Date())}` : 'Syncing…'}
                        </span>
                    )}
                </div>
                <span className="text-muted" style={{ fontWeight: 500, color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatCount(list.count)} {list.count === 1 ? 'thread' : 'threads'}
                </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                {/* Each heading's top margin is the gap between headings (the first one's is taken back
                    here); a column, so a card's margin and the next heading's add up as before */}
                <div style={{ marginTop: 'calc(-1 * var(--space-lg))', display: 'flex', flexDirection: 'column' }}>
                    <AnimatePresence mode="popLayout" initial={false}>
                        {listItems}
                    </AnimatePresence>
                </div>

                <LoadMore list={list} skeletons={[0, 1, 2].map(i => <InboxCardSkeleton key={i} />)} />

                {/* The first sync: skeleton cards (only if the wait is noticeable) */}
                {inboxEmails.length === 0 && firstSync && (
                    <div aria-busy="true">
                        <AfterDelay>
                            {[0, 1, 2, 3].map(i => <InboxCardSkeleton key={i} />)}
                        </AfterDelay>
                    </div>
                )}

                {/* Empty States */}
                {inboxEmails.length === 0 && !firstSync && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        style={{
                            textAlign: 'center',
                            padding: 'var(--space-3xl)',
                            color: 'var(--color-text-muted)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '16px'
                        }}
                    >
                        {list.error ? (
                            <>
                                <AlertCircle size={24} aria-hidden="true" style={{ color: 'var(--color-text-faint)' }} />
                                <p>Couldn't load your inbox: {list.error}</p>
                            </>
                        ) : (
                            <>
                                <p>All caught up</p>
                            </>
                        )}
                    </motion.div>

                )}
            </div>
            </>)}
        </div>
    );
};
