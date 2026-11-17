import React from 'react';
import { ChevronDown } from 'lucide-react';
import { type Bucket, type Email } from '../../store/mailStore';
import { EmailCard } from './EmailCard';
import { useMail } from '../../context/MailContext';
import { useThreadList } from '../../hooks/useThreadList';
import { cardFromThread } from '../../utils/emailMapper';
import { AnimatePresence } from 'framer-motion';
import { useArrivals } from '../../hooks/useArrivals';
import { AfterDelay, BucketCardSkeleton, ViewFailure } from '../Loading/Skeletons';
import { LoadMore } from '../Loading/LoadMore';
import { usePublishList, type ListKey } from '../../hooks/conversationLists';
import { formatCount } from '../../utils/format';
import { Button } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';

interface BucketGalleryProps {
    bucket: Bucket;
    /** Opens a conversation, saying which list it was opened from (for previous / next). */
    onSelectEmail: (email: Email, list?: ListKey) => void;
}

type GroupBy = 'none' | 'sender';

export const BucketGallery: React.FC<BucketGalleryProps> = ({ bucket, onSelectEmail }) => {
    const { activeAccountId, draftThreadIds, folderLabel, moveThread, undoMove, showToast } = useMail();
    const list = useThreadList(activeAccountId, bucket ? { location: bucket.id } : null, 200);
    const [groupBy, setGroupBy] = React.useState<GroupBy>('none');
    const [showGroupMenu, setShowGroupMenu] = React.useState(false);
    const groupButton = React.useRef<HTMLButtonElement>(null);

    // One card per conversation, newest first (the engine's order)
    const cards = React.useMemo(() => list.threads.map(cardFromThread), [list.threads]);
    const arrivals = useArrivals(!list.loading, cards);

    const handleBucketEmail = async (emailId: string, targetBucketId: string) => {
        if (!bucket || targetBucketId === bucket.id) return;
        const email = cards.find(e => e.id === emailId);
        if (!email) return;
        const taskId = await moveThread(email.threadId, targetBucketId);
        if (taskId === null) return;
        const where = targetBucketId === 'inbox' ? 'Inbox' : folderLabel(targetBucketId);
        showToast({
            message: targetBucketId === 'archive' ? 'Archived' : <>Moved to <strong>{where}</strong></>,
            actions: [{ label: 'Undo', onClick: () => void undoMove(taskId) }],
        });
    };

    // Group emails by sender
    const groupedEmails = React.useMemo(() => {
        if (groupBy !== 'sender') return null;
        const groups = new Map<string, Email[]>();
        for (const email of cards) {
            if (!groups.has(email.sender)) groups.set(email.sender, []);
            groups.get(email.sender)!.push(email); // already newest first
        }
        // Sender names alphabetically
        return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [cards, groupBy]);

    // Previous / next follow the order shown: by sender when grouped
    const listKey: ListKey = `bucket:${bucket.id}`;
    const shownOrder = React.useMemo(() => (groupedEmails ? groupedEmails.flatMap(([, emails]) => emails) : cards), [groupedEmails, cards]);
    usePublishList(listKey, shownOrder, { total: list.count, hasMore: list.hasMore, loadMore: list.loadMore });

    const renderGrouped = () => {
        if (!groupedEmails) return null;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-12)' }}>
                {groupedEmails.map(([sender, emails]) => (
                    <div key={sender}>
                        <h3 style={{
                            fontSize: 'var(--size-title)',
                            fontWeight: 'var(--weight-medium)',
                            color: 'var(--text-1)',
                            marginBottom: 'var(--space-4)'
                        }}>
                            {sender}
                        </h3>
                        <div data-thread-list="" style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                            gap: 'var(--space-6)'
                        }}>
                            <AnimatePresence mode="popLayout">
                                {emails.map((email) => (
                                    <EmailCard
                                        key={email.id}
                                        email={email}
                                        onClick={() => onSelectEmail(email, listKey)}
                                        onBucket={handleBucketEmail}
                                        threadCount={email.threadCount}
                                        hasDraft={draftThreadIds.has(email.threadId)}
                                        arrivals={arrivals}
                                    />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderUngrouped = () => {
        return (
            <div data-thread-list="" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 'var(--space-6)'
            }}>
                <AnimatePresence mode="popLayout">
                    {cards.map((email) => (
                        <EmailCard
                            key={email.id}
                            email={email}
                            onClick={() => onSelectEmail(email, listKey)}
                            onBucket={handleBucketEmail}
                            threadCount={email.threadCount}
                            hasDraft={draftThreadIds.has(email.threadId)}
                            arrivals={arrivals}
                        />
                    ))}
                </AnimatePresence>
            </div>
        );
    };

    // Guard against undefined bucket (can happen during re-renders after refreshData)
    if (!bucket) {
        return <div style={{ padding: 'var(--space-8)' }}>Loading</div>;
    }

    return (
        <div style={{ paddingTop: 'var(--space-8)', paddingBottom: '140px' }}>
            {/* The title row spans the card grid: the title on its left edge, the count and Group on its right */}
            <header style={{ margin: '0 0 var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2 style={{
                    fontSize: 'var(--size-page)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-1)' // no bucket colours
                }}>
                    {bucket.label}
                </h2>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)' }}>
                <span className="text-muted" style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {formatCount(list.count)} {list.count === 1 ? 'thread' : 'threads'}{/* one way to count (rule W6) */}
                </span>

                {/* Group: a menu button (the shared Button and Menu) */}
                <div style={{ position: 'relative' }}>
                    <Button ref={groupButton} trailingIcon={<ChevronDown size={16} aria-hidden="true" />}
                        aria-haspopup="menu" aria-expanded={showGroupMenu}
                        onClick={() => setShowGroupMenu(open => !open)}
                        onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setShowGroupMenu(true); } }}>
                        {groupBy === 'none' ? 'Group' : 'Group: by sender'}
                    </Button>
                    {showGroupMenu && (
                        <Menu label="Group" anchor={groupButton} onClose={() => setShowGroupMenu(false)} returnFocus={() => groupButton.current}
                            style={{ position: 'absolute', top: 'calc(100% + var(--space-1))', right: 0, minWidth: 200, zIndex: 20 /* layer: popover, local (the Group menu) */ }}>
                            <MenuItem checked={groupBy === 'none'} onSelect={() => { setGroupBy('none'); setShowGroupMenu(false); }}>None</MenuItem>
                            <MenuItem checked={groupBy === 'sender'} onSelect={() => { setGroupBy('sender'); setShowGroupMenu(false); }}>By sender</MenuItem>
                        </Menu>
                    )}
                </div>
                </div>
            </header>

            {/* Email Grid or Grouped View */}
            {list.error && (
                <ViewFailure what={bucket.label} why={list.error} onRetry={list.retry} room="var(--space-8)" />
            )}
            {list.loading ? (
                <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-6)' }}>
                    <AfterDelay>
                        {[0, 1, 2, 3, 4, 5].map(i => <BucketCardSkeleton key={i} />)}
                    </AfterDelay>
                </div>
            ) : cards.length === 0 && !list.error ? (
                // One line where the cards would be, as in the Inbox (rule T5; owner, Checkpoint B)
                <p style={{ textAlign: 'center', padding: 'var(--space-16)', color: 'var(--text-3)' }}>Nothing in {bucket.label}.</p>
            ) : groupBy === 'sender' ? renderGrouped() : renderUngrouped()}

            <LoadMore list={list} skeletons={(
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-6)', marginTop: 'var(--space-6)' }}>
                    {[0, 1, 2].map(i => <BucketCardSkeleton key={i} />)}
                </div>
            )} />
        </div>
    );
};
