import React from 'react';
import { ChevronDown } from 'lucide-react';
import { type Bucket, type Email } from '../../store/mailStore';
import { EmailCard } from './EmailCard';
import { useMail } from '../../context/MailContext';
import { useThreadList } from '../../hooks/useThreadList';
import { cardFromThread } from '../../utils/emailMapper';
import { AnimatePresence } from 'framer-motion';
import { useArrivals } from '../../hooks/useArrivals';
import { AfterDelay, BucketCardSkeleton } from '../Loading/Skeletons';
import { LoadMore } from '../Loading/LoadMore';
import { formatCount } from '../../utils/format';

interface BucketGalleryProps {
    bucket: Bucket;
    onSelectEmail: (email: Email) => void;
}

type GroupBy = 'none' | 'sender';

export const BucketGallery: React.FC<BucketGalleryProps> = ({ bucket, onSelectEmail }) => {
    const { activeAccountId, draftThreadIds, folderLabel, moveThread, undoMove, showToast } = useMail();
    const list = useThreadList(activeAccountId, bucket ? { location: bucket.id } : null, 200);
    const [groupBy, setGroupBy] = React.useState<GroupBy>('none');
    const [showGroupMenu, setShowGroupMenu] = React.useState(false);

    // One card per conversation, newest first (the engine's order)
    const cards = React.useMemo(() => list.threads.map(cardFromThread), [list.threads]);
    const arrivals = useArrivals(!list.loading, cards);
    const emailCount = React.useMemo(() => cards.reduce((n, c) => n + (c.threadCount ?? 1), 0), [cards]);

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

    const renderGrouped = () => {
        if (!groupedEmails) return null;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
                {groupedEmails.map(([sender, emails]) => (
                    <div key={sender}>
                        <h3 style={{
                            fontSize: 'var(--font-size-lg)',
                            fontWeight: 'var(--weight-semibold)',
                            color: 'var(--color-text-main)',
                            marginBottom: 'var(--space-md)'
                        }}>
                            {sender}
                        </h3>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                            gap: 'var(--space-lg)'
                        }}>
                            <AnimatePresence mode="popLayout">
                                {emails.map((email) => (
                                    <EmailCard
                                        key={email.id}
                                        email={email}
                                        onClick={() => onSelectEmail(email)}
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
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 'var(--space-lg)'
            }}>
                <AnimatePresence mode="popLayout">
                    {cards.map((email) => (
                        <EmailCard
                            key={email.id}
                            email={email}
                            onClick={() => onSelectEmail(email)}
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
        return <div style={{ padding: 'var(--space-xl)' }}>Loading</div>;
    }

    return (
        <div style={{ paddingTop: 'var(--space-xl)', paddingBottom: '140px' }}>
            {/* The title row spans the card grid: the title on its left edge, the count and Group on its right */}
            <header style={{ margin: '0 0 var(--space-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2 style={{
                    fontSize: 'var(--size-page-heading)',
                    fontWeight: 'var(--weight-bold)',
                    color: `var(--bucket-title, ${bucket.color})` // the dark theme sets it: no bucket colours
                }}>
                    {bucket.label}
                </h2>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-md)' }}>
                <span className="text-muted" style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {formatCount(list.count)} {list.count === 1 ? 'thread' : 'threads'}{list.hasMore ? '' : ` (${formatCount(emailCount)} emails)`}
                </span>

                {/* Group dropdown */}
                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setShowGroupMenu(!showGroupMenu)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-xs)',
                            padding: 'var(--space-sm) var(--space-md)',
                            backgroundColor: 'var(--surface-raised)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 500,
                            color: 'var(--color-text-main)',
                            cursor: 'pointer',
                            transition: 'background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)'
                        }}
                    >
                        {groupBy === 'none' ? 'Group' : 'Group: by sender'}
                        <ChevronDown size={16} />
                    </button>

                    {showGroupMenu && (
                        <>
                            <div
                                onClick={() => setShowGroupMenu(false)}
                                style={{
                                    position: 'fixed',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    zIndex: 10
                                }}
                            />
                            <div
                                style={{
                                    position: 'absolute',
                                    top: 'calc(100% + var(--space-xs))',
                                    right: 0,
                                    backgroundColor: 'var(--surface-raised)',
                                    border: '1px solid var(--border-strong)',
                                    borderRadius: 'var(--radius-md)',
                                    boxShadow: 'var(--shadow-menu)',
                                    minWidth: '200px',
                                    zIndex: 20,
                                    overflow: 'hidden'
                                }}
                            >
                                <button
                                    onClick={() => {
                                        setGroupBy('none');
                                        setShowGroupMenu(false);
                                    }}
                                    style={{
                                        width: '100%',
                                        padding: 'var(--space-sm) var(--space-md)',
                                        textAlign: 'left',
                                        backgroundColor: groupBy === 'none' ? 'var(--color-bg-subtle)' : 'transparent',
                                        border: 'none',
                                        color: 'var(--color-text-main)',
                                        fontSize: 'var(--font-size-sm)',
                                        cursor: 'pointer',
                                        transition: 'background-color var(--dur-fast) var(--ease)'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = groupBy === 'none' ? 'var(--color-bg-subtle)' : 'transparent'}
                                >
                                    None
                                </button>
                                <button
                                    onClick={() => {
                                        setGroupBy('sender');
                                        setShowGroupMenu(false);
                                    }}
                                    style={{
                                        width: '100%',
                                        padding: 'var(--space-sm) var(--space-md)',
                                        textAlign: 'left',
                                        backgroundColor: groupBy === 'sender' ? 'var(--color-bg-subtle)' : 'transparent',
                                        border: 'none',
                                        color: 'var(--color-text-main)',
                                        fontSize: 'var(--font-size-sm)',
                                        cursor: 'pointer',
                                        transition: 'background-color var(--dur-fast) var(--ease)'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = groupBy === 'sender' ? 'var(--color-bg-subtle)' : 'transparent'}
                                >
                                    By sender
                                </button>
                            </div>
                        </>
                    )}
                </div>
                </div>
            </header>

            {/* Email Grid or Grouped View */}
            {list.error && (
                <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>Couldn't load this bucket: {list.error}</p>
            )}
            {list.loading ? (
                <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-lg)' }}>
                    <AfterDelay>
                        {[0, 1, 2, 3, 4, 5].map(i => <BucketCardSkeleton key={i} />)}
                    </AfterDelay>
                </div>
            ) : groupBy === 'sender' ? renderGrouped() : renderUngrouped()}

            <LoadMore list={list} skeletons={(
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-lg)', marginTop: 'var(--space-lg)' }}>
                    {[0, 1, 2].map(i => <BucketCardSkeleton key={i} />)}
                </div>
            )} />
        </div>
    );
};
