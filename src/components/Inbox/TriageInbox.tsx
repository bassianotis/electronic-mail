import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { InboxItem } from './InboxItem';
import { ThreadItem } from './ThreadItem';
import { type Email } from '../../store/mailStore';
import type { ThreadGroup } from '../../../shared/types/email';
import { CheckCircle, ArrowRight, Layers } from 'lucide-react';
import { isToday, isYesterday, subDays, isAfter } from 'date-fns';
import { useMail } from '../../context/MailContext';

interface TriageInboxProps {
    onSelectEmail: (email: Email) => void;
}

export const TriageInbox: React.FC<TriageInboxProps> = ({ onSelectEmail }) => {
    const {
        emails,
        bucketEmail,
        archiveEmail,
        buckets,
        setCurrentView,
        isLoading,
        isSyncing,
        // Thread operations
        threads,
        threadsLoading,
        fetchInboxThreads,
        bucketThread,
        archiveThread,
        returnThreadToBucket
    } = useMail();

    const [lastBucketed, setLastBucketed] = useState<{ email: Email; bucketId: string } | null>(null);
    const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
    const [useThreadView, setUseThreadView] = useState(true); // Toggle for thread view

    // Set current view to inbox when this component mounts
    useEffect(() => {
        setCurrentView('inbox');
    }, [setCurrentView]);

    // Fetch threads when component mounts or when switching to thread view
    useEffect(() => {
        if (useThreadView) {
            fetchInboxThreads();
        }
    }, [useThreadView, fetchInboxThreads]);

    // Filter for Inbox (items without a bucketId) and sort by date descending
    const inboxEmails = emails.filter(e => !e.bucketId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const handleBucket = (emailId: string, bucketId: string) => {
        const email = inboxEmails.find(e => e.id === emailId);
        if (!email) return;

        // 1. Update Global State
        bucketEmail(emailId, bucketId);

        // 2. Show Toast
        setLastBucketed({ email, bucketId });

        // 3. Auto-hide toast after 4s
        setTimeout(() => {
            setLastBucketed(prev => (prev?.email.id === emailId ? null : prev));
        }, 4000);
    };

    const handleThreadBucket = async (threadId: string, bucketId: string) => {
        await bucketThread(threadId, bucketId);
        // Refresh threads after bucketing
        fetchInboxThreads();
    };

    const handleThreadArchive = async (threadId: string) => {
        // Optimistic update - archiveThread already removes from local state
        archiveThread(threadId);
        // Backend call happens async, no await needed for UI
    };

    const handleThreadReturn = async (threadId: string) => {
        await returnThreadToBucket(threadId);
        // Refresh threads after returning
        fetchInboxThreads();
    };

    const handleDone = (emailId: string) => {
        archiveEmail(emailId);
    };

    const handleToggleExpand = (email: Email) => {
        setExpandedEmailId(prev => prev === email.id ? null : email.id);
    };

    const handleThreadClick = (thread: ThreadGroup) => {
        // For now, open the latest email in the thread
        // In the future, this will open the thread view
        if (thread.latestEmail) {
            const email: Email = {
                id: thread.latestEmail.messageId || thread.threadId,
                uid: thread.latestEmail.uid?.toString(),
                sender: thread.latestEmail.sender,
                subject: thread.latestEmail.subject,
                preview: thread.latestEmail.preview,
                body: '<p>Loading body...</p>',
                date: new Date(thread.latestEmail.date),
                read: true
            };
            onSelectEmail(email);
        }
    };

    // Segmentation Logic for threads
    const today = new Date();
    const lastWeekStart = subDays(today, 7);
    const twoWeeksAgoStart = subDays(today, 14);

    const segmentThreads = (threadList: ThreadGroup[]) => {
        const segments = {
            today: [] as ThreadGroup[],
            yesterday: [] as ThreadGroup[],
            pastWeek: [] as ThreadGroup[],
            lastWeek: [] as ThreadGroup[],
            earlier: [] as ThreadGroup[]
        };

        threadList.forEach(thread => {
            const date = new Date(thread.latestEmail.date);
            if (isToday(date)) {
                segments.today.push(thread);
            } else if (isYesterday(date)) {
                segments.yesterday.push(thread);
            } else if (isAfter(date, lastWeekStart)) {
                segments.pastWeek.push(thread);
            } else if (isAfter(date, twoWeeksAgoStart)) {
                segments.lastWeek.push(thread);
            } else {
                segments.earlier.push(thread);
            }
        });

        return segments;
    };

    // Segmentation Logic for emails (legacy)
    const segmentEmails = (emailList: Email[]) => {
        const segments = {
            today: [] as Email[],
            yesterday: [] as Email[],
            pastWeek: [] as Email[],
            lastWeek: [] as Email[],
            earlier: [] as Email[]
        };

        emailList.forEach(email => {
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

        return segments;
    };

    const emailSegments = segmentEmails(inboxEmails);
    const threadSegments = segmentThreads(threads);

    const renderEmailSection = (title: string, items: Email[]) => {
        if (items.length === 0) return null;
        return (
            <section>
                <h3 className="text-muted" style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 'var(--space-md)'
                }}>
                    {title}
                </h3>
                <AnimatePresence mode="popLayout">
                    {items.map((email) => (
                        <InboxItem
                            key={email.id}
                            email={email}
                            isExpanded={expandedEmailId === email.id}
                            onBucket={handleBucket}
                            onDone={handleDone}
                            onClick={() => handleToggleExpand(email)}
                        />
                    ))}
                </AnimatePresence>
            </section>
        );
    };

    const renderThreadSection = (title: string, items: ThreadGroup[]) => {
        if (items.length === 0) return null;
        return (
            <section>
                <h3 className="text-muted" style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 'var(--space-md)'
                }}>
                    {title}
                </h3>
                <AnimatePresence mode="popLayout">
                    {items.map((thread) => (
                        <ThreadItem
                            key={thread.threadId}
                            thread={thread}
                            onBucket={handleThreadBucket}
                            onArchive={handleThreadArchive}
                            onReturnToBucket={thread.hasNewEmail ? handleThreadReturn : undefined}
                            onClick={() => handleThreadClick(thread)}
                        />
                    ))}
                </AnimatePresence>
            </section>
        );
    };

    const itemCount = useThreadView ? threads.length : inboxEmails.length;
    const loading = useThreadView ? threadsLoading : isLoading;

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingTop: 'var(--space-xl)', paddingBottom: '140px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-lg)' }}>
                <h2 style={{
                    fontSize: 'var(--font-size-2xl)',
                    fontWeight: 700,
                    color: 'var(--color-text-main)'
                }}>
                    Inbox
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                    {/* Thread view toggle */}
                    <button
                        onClick={() => setUseThreadView(!useThreadView)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-full)',
                            backgroundColor: useThreadView ? 'var(--color-primary)' : 'var(--color-bg-subtle)',
                            color: useThreadView ? '#fff' : 'var(--color-text-muted)',
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 500,
                            border: useThreadView ? 'none' : '1px solid var(--color-border)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <Layers size={14} />
                        Threads
                    </button>
                    <span className="text-muted" style={{ fontWeight: 500 }}>
                        {itemCount} {useThreadView ? 'threads' : 'items'}
                    </span>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                {useThreadView ? (
                    <>
                        {renderThreadSection('Today', threadSegments.today)}
                        {renderThreadSection('Yesterday', threadSegments.yesterday)}
                        {renderThreadSection('Past Week', threadSegments.pastWeek)}
                        {renderThreadSection('Last Week', threadSegments.lastWeek)}
                        {renderThreadSection('Earlier', threadSegments.earlier)}
                    </>
                ) : (
                    <>
                        {renderEmailSection('Today', emailSegments.today)}
                        {renderEmailSection('Yesterday', emailSegments.yesterday)}
                        {renderEmailSection('Past Week', emailSegments.pastWeek)}
                        {renderEmailSection('Last Week', emailSegments.lastWeek)}
                        {renderEmailSection('Earlier', emailSegments.earlier)}
                    </>
                )}

                {/* Loading / Empty States */}
                {itemCount === 0 && (
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
                        {loading ? (
                            <>
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                    style={{
                                        width: '24px',
                                        height: '24px',
                                        border: '3px solid var(--color-bg-subtle)',
                                        borderTopColor: 'var(--color-primary)',
                                        borderRadius: '50%'
                                    }}
                                />
                                <p>Loading your inbox...</p>
                            </>
                        ) : isSyncing ? (
                            <>
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                    style={{
                                        width: '24px',
                                        height: '24px',
                                        border: '3px solid var(--color-bg-subtle)',
                                        borderTopColor: 'var(--color-primary)',
                                        borderRadius: '50%'
                                    }}
                                />
                                <p>Syncing emails from server...</p>
                            </>
                        ) : (
                            <>
                                <p style={{ fontSize: 'var(--font-size-xl)', marginBottom: 'var(--space-sm)' }}>🎉</p>
                                <p>You're all caught up!</p>
                            </>
                        )}
                    </motion.div>

                )}
            </div>

            {/* Quick Look Toast */}
            <AnimatePresence>
                {lastBucketed && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, x: '-50%' }}
                        animate={{ opacity: 1, y: 0, x: '-50%' }}
                        exit={{ opacity: 0, y: 20, x: '-50%' }}
                        style={{
                            position: 'fixed',
                            bottom: '120px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            backgroundColor: '#2c3e50',
                            color: '#fff',
                            padding: '12px 24px',
                            borderRadius: 'var(--radius-full)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-md)',
                            boxShadow: 'var(--shadow-lg)',
                            zIndex: 200
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            <CheckCircle size={18} color="var(--color-success)" />
                            <span style={{ fontSize: 'var(--font-size-sm)' }}>
                                Filed to <strong>{buckets.find(b => b.id === lastBucketed.bucketId)?.label || lastBucketed.bucketId}</strong>
                            </span>
                        </div>
                        <button
                            onClick={() => onSelectEmail(lastBucketed.email)}
                            style={{
                                color: '#fff',
                                fontWeight: 600,
                                fontSize: 'var(--font-size-sm)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 8px',
                                backgroundColor: 'rgba(255,255,255,0.1)',
                                borderRadius: 'var(--radius-sm)'
                            }}
                        >
                            Open Now <ArrowRight size={14} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
};
