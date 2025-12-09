import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { InboxItem } from './InboxItem';
import { type Email } from '../../store/mailStore';
import { CheckCircle, ArrowRight } from 'lucide-react';
import { isToday, isYesterday, subDays, isAfter } from 'date-fns';
import { useMail } from '../../context/MailContext';

interface TriageInboxProps {
    onSelectEmail: (email: Email) => void;
}

export const TriageInbox: React.FC<TriageInboxProps> = ({ onSelectEmail }) => {
    const { emails, bucketEmail, archiveEmail, buckets, setCurrentView, isLoading, isSyncing } = useMail();
    const [lastBucketed, setLastBucketed] = useState<{ email: Email; bucketId: string } | null>(null);
    const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);

    // Set current view to inbox when this component mounts
    React.useEffect(() => {
        setCurrentView('inbox');
    }, [setCurrentView]);

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

    const handleDone = (emailId: string) => {
        archiveEmail(emailId);
    };

    const handleToggleExpand = (email: Email) => {
        setExpandedEmailId(prev => prev === email.id ? null : email.id);
        // We can still call onSelectEmail if the parent needs to know, but for now we handle expansion locally
        // onSelectEmail(email); 
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

    const renderSection = (title: string, items: Email[]) => {
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
                <span className="text-muted" style={{ fontWeight: 500 }}>
                    {inboxEmails.length} items
                </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                {renderSection('Today', segments.today)}
                {renderSection('Yesterday', segments.yesterday)}
                {renderSection('Past Week', segments.pastWeek)}
                {renderSection('Last Week', segments.lastWeek)}
                {renderSection('Earlier', segments.earlier)}

                {/* Loading / Empty States */}
                {inboxEmails.length === 0 && (
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
                        {isLoading ? (
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
