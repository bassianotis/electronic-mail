import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Archive, Edit3, CheckCircle, ArrowRight } from 'lucide-react';
import { type Email, type ArchivedEmail, type ApiEmailResponse } from '../../store/mailStore';
import { useMail } from '../../context/MailContext';
import { useDragDrop } from '../../context/DragDropContext';
import { mapApiResponsesToArchivedEmails } from '../../utils/emailMapper';
import { useBackgroundPreviews } from '../../hooks';
import type { ThreadGroup } from '../../../shared/types/email';

// Extended type to include thread info
interface ArchivedEmailWithThread extends ArchivedEmail {
    threadId?: string;
    threadCount?: number;
}

interface ArchiveViewProps {
    onSelectEmail: (email: Email) => void;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({ onSelectEmail }) => {
    const { buckets, unarchiveEmail, loadEmailBody, setCurrentView, fetchArchiveThreads } = useMail();
    const [archivedEmails, setArchivedEmails] = useState<ArchivedEmailWithThread[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [lastRestored, setLastRestored] = useState<{ email: Email; target: string } | null>(null);

    // Set current view to archive when this component mounts
    useEffect(() => {
        setCurrentView('archive');
    }, [setCurrentView]);

    // Listen for email restored events (triggered from Overlay)
    useEffect(() => {
        const handleEmailRestored = (e: any) => {
            if (e.detail && e.detail.email) {
                const { email, targetLocation } = e.detail;
                // Remove from local list immediately
                setArchivedEmails(prev => prev.filter(item => item.id !== email.id));

                // Show toast
                setLastRestored({ email, target: targetLocation });

                // Auto-hide toast
                setTimeout(() => {
                    setLastRestored(prev => (prev?.email.id === email.id ? null : prev));
                }, 4000);
            }
        };

        window.addEventListener('emailRestored', handleEmailRestored);
        return () => window.removeEventListener('emailRestored', handleEmailRestored);
    }, []);

    useEffect(() => {
        const fetchArchive = async () => {
            setIsLoading(true);
            try {
                let emailsWithThreads: ArchivedEmailWithThread[] = [];

                // Try fetching threads first
                if (fetchArchiveThreads) {
                    const threads: ThreadGroup[] = await fetchArchiveThreads();
                    console.log(`[ArchiveView] Fetched ${threads.length} archive threads`);

                    if (threads && threads.length > 0) {
                        // Convert threads to archived emails with thread info
                        emailsWithThreads = threads.map(thread => {
                            const latest = thread.latestEmail;
                            return {
                                id: latest.messageId || thread.threadId,
                                uid: (latest as any).uid?.toString(),
                                messageId: latest.messageId,
                                sender: latest.sender || 'Unknown',
                                senderAddress: latest.senderAddress || '',
                                subject: latest.subject || '(No Subject)',
                                preview: latest.preview || '',
                                body: '<p>Loading...</p>',
                                date: new Date(latest.date),
                                read: true,
                                dateArchived: new Date().toISOString() as any,
                                originalBucket: thread.originalBucketId,
                                threadId: thread.threadId,
                                threadCount: thread.count
                            };
                        });

                        // When we have threads, use ONLY threads (don't fetch individual emails)
                        // Sort by date descending
                        emailsWithThreads.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                        setArchivedEmails(emailsWithThreads);
                        setIsLoading(false);
                        return;
                    }
                }

                // Fallback: Only fetch individual emails if no threads returned
                const res = await fetch('/api/archive');
                if (res.ok) {
                    const data: ApiEmailResponse[] = await res.json();
                    const mappedEmails = mapApiResponsesToArchivedEmails(data);
                    console.log(`[ArchiveView] Fallback: Fetched ${mappedEmails.length} individual archived emails`);

                    emailsWithThreads = mappedEmails.map(email => ({
                        ...email,
                        threadCount: 1
                    }));
                }

                // Sort by date descending
                emailsWithThreads.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                setArchivedEmails(emailsWithThreads);
            } catch (err) {
                console.error('Error loading archive:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchArchive();
    }, [fetchArchiveThreads]);

    // Background preview loading for archived emails
    useBackgroundPreviews(archivedEmails, { loadEmailBody });

    // Listen for body loaded events
    useEffect(() => {
        const handleBodyLoaded = (e: any) => {
            if (e.detail && e.detail.emailId) {
                setArchivedEmails(prev => prev.map(email => {
                    if (email.id === e.detail.emailId) {
                        return {
                            ...email,
                            body: e.detail.body,
                            preview: e.detail.preview,
                            attachments: e.detail.attachments
                        };
                    }
                    return email;
                }));
            }
        };

        window.addEventListener('emailBodyLoaded', handleBodyLoaded);
        return () => window.removeEventListener('emailBodyLoaded', handleBodyLoaded);
    }, []);

    const getBucketLabel = (bucketId?: string) => {
        if (!bucketId) return 'Inbox';
        const bucket = buckets.find(b => b.id === bucketId);
        return bucket?.label || bucketId;
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingTop: 'var(--space-xl)', paddingBottom: '140px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                    <Archive size={28} color="var(--color-text-muted)" />
                    <h2 style={{
                        fontSize: 'var(--font-size-2xl)',
                        fontWeight: 700,
                        color: 'var(--color-text-main)'
                    }}>
                        Archive
                    </h2>
                </div>
                <span className="text-muted" style={{ fontWeight: 500 }}>
                    {archivedEmails.length} items
                </span>
            </div>

            {isLoading ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-3xl)', color: 'var(--color-text-muted)' }}>
                    Loading archive...
                </div>
            ) : archivedEmails.length === 0 ? (
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <AnimatePresence>
                        {archivedEmails.map((email) => (
                            <ArchiveItem
                                key={email.id}
                                email={email}
                                onClick={() => onSelectEmail(email)}
                                onUnarchive={async (email, targetLocation) => {
                                    // Cast to get thread info - Archive items may have threadId and threadCount
                                    const emailWithThread = email as any;

                                    // Optimistic update - remove from UI immediately
                                    setArchivedEmails(prev => prev.filter(e => e.id !== email.id));

                                    // If this is a thread (threadCount > 1), use thread unarchive API
                                    if (emailWithThread.threadId && emailWithThread.threadCount && emailWithThread.threadCount > 1) {
                                        console.log(`[ArchiveView] Unarchiving thread ${emailWithThread.threadId} to ${targetLocation}`);
                                        fetch(`/api/threads/${encodeURIComponent(emailWithThread.threadId)}/unarchive`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ targetLocation })
                                        }).catch(err => {
                                            console.error('[ArchiveView] Error unarchiving thread:', err);
                                            // TODO: Rollback by re-adding email to state
                                        });
                                    } else {
                                        // Single email - use existing unarchive
                                        unarchiveEmail(email, targetLocation);
                                    }
                                }}
                                getBucketLabel={getBucketLabel}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}

            {/* Restore Toast */}
            <AnimatePresence>
                {lastRestored && (
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
                                Restored to <strong>{
                                    lastRestored.target === 'inbox'
                                        ? 'Inbox'
                                        : (buckets.find(b => b.id === lastRestored.target)?.label || lastRestored.target)
                                }</strong>
                            </span>
                        </div>
                        <button
                            onClick={() => {
                                // "View Now" should show the email as it exists in the destination (not archived)
                                const cleanEmail = {
                                    ...lastRestored.email,
                                    dateArchived: undefined,
                                    originalBucket: undefined,
                                    bucketId: lastRestored.target === 'inbox' ? 'inbox' : lastRestored.target
                                };
                                onSelectEmail(cleanEmail as any);
                            }}
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
        </div>
    );
};

interface ArchiveItemProps {
    email: ArchivedEmailWithThread;
    onClick: () => void;
    onUnarchive: (email: Email, targetLocation: string) => void;
    getBucketLabel: (bucketId?: string) => string;
}

const ArchiveItem: React.FC<ArchiveItemProps> = ({ email, onClick, onUnarchive, getBucketLabel }) => {
    const { setHoveredBucketId, setIsDragging } = useDragDrop();
    const { buckets } = useMail();
    const [showSenderEmail, setShowSenderEmail] = useState(false);
    const isDraggingRef = React.useRef(false);

    const handleDragStart = () => {
        isDraggingRef.current = true;
        setIsDragging(true);
    };

    const handleDrag = (_event: any, info: any) => {
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
                return;
            }
        }

        // Check buckets
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
                    foundTarget = bucket.id;
                    break;
                }
            }
        }
        setHoveredBucketId(foundTarget);
    };

    const handleDragEnd = (_event: any, info: any) => {
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
                if (element) {
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

        if (targetLocation) {
            onUnarchive(email, targetLocation);
        }

        setTimeout(() => {
            isDraggingRef.current = false;
        }, 100);
    };

    const handleClick = () => {
        if (!isDraggingRef.current) {
            onClick();
        }
    };

    const hasStack = email.threadCount && email.threadCount > 1;

    return (
        <motion.div
            layoutId={`email-${email.id}`}
            drag
            dragSnapToOrigin
            dragElastic={0.1}
            dragMomentum={false}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            whileDrag={{
                scale: 0.6,
                opacity: 0.9,
                borderRadius: '24px',
                zIndex: 300,
                boxShadow: 'var(--shadow-floating)',
                cursor: 'grabbing'
            }}
            onClick={handleClick}
            whileHover={{ y: -2, boxShadow: '0 6px 16px rgba(0,0,0,0.1)' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            style={{
                position: 'relative',
                cursor: 'grab',
                isolation: 'isolate'
            }}
        >
            {/* Stacked card effect for threads */}
            {hasStack && (
                <>
                    {email.threadCount! > 2 && (
                        <div
                            style={{
                                position: 'absolute',
                                top: '4px',
                                left: '6px',
                                right: '-6px',
                                bottom: '-4px',
                                backgroundColor: '#ebebeb',
                                borderRadius: '12px',
                                border: '1px solid #d5d5d5',
                                transform: 'rotate(-1deg)',
                                zIndex: 1
                            }}
                        />
                    )}
                    <div
                        style={{
                            position: 'absolute',
                            top: '2px',
                            left: '4px',
                            right: '-4px',
                            bottom: '-2px',
                            backgroundColor: '#f5f5f5',
                            borderRadius: '12px',
                            border: '1px solid #e0e0e0',
                            transform: 'rotate(1deg)',
                            zIndex: 2
                        }}
                    />
                </>
            )}

            {/* Main card content */}
            <div style={{
                backgroundColor: '#fff',
                border: '1px solid var(--color-border)',
                borderRadius: '12px',
                padding: 'var(--space-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-sm)',
                position: 'relative',
                zIndex: 3
            }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
                            <span
                                style={{
                                    fontWeight: 600,
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
                            {email.threadCount && email.threadCount > 1 && (
                                <span style={{
                                    backgroundColor: '#3b82f6',
                                    color: '#fff',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    padding: '2px 6px',
                                    borderRadius: '10px',
                                    minWidth: '18px',
                                    textAlign: 'center',
                                    display: 'inline-block'
                                }}>
                                    {email.threadCount}
                                </span>
                            )}
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                                •
                            </span>
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                                from {getBucketLabel(email.originalBucket)}
                            </span>
                        </div>
                        <h3 style={{
                            fontSize: 'var(--font-size-md)',
                            fontWeight: 600,
                            color: 'var(--color-text-main)',
                            margin: '4px 0'
                        }}>
                            {email.subject}
                        </h3>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', minWidth: '120px' }}>
                        {email.dateArchived && (
                            <div>Archived {new Date(email.dateArchived).toLocaleDateString()}</div>
                        )}
                        <div>Received {email.date.toLocaleDateString()}</div>
                    </div>
                </div>

                {email.note && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '6px',
                        backgroundColor: '#fff9db',
                        color: '#e67e22',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600
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
                    </div>
                )}
            </div>
        </motion.div>
    );
};
