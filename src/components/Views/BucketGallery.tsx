import React from 'react';
import { ChevronDown } from 'lucide-react';
import { type Bucket, type Email, type ApiEmailResponse } from '../../store/mailStore';
import { EmailCard } from './EmailCard';
import { useMail } from '../../context/MailContext';
import { mapApiResponsesToEmails } from '../../utils/emailMapper';
import { useBackgroundPreviews } from '../../hooks';
import type { ThreadGroup } from '../../../shared/types/email';

interface BucketGalleryProps {
    bucket: Bucket;
    onSelectEmail: (email: Email) => void;
}

type GroupBy = 'none' | 'sender';

// Extended email with thread info
interface EmailWithThread extends Email {
    threadId?: string;
    threadCount?: number;
}

export const BucketGallery: React.FC<BucketGalleryProps> = ({ bucket, onSelectEmail }) => {
    const {
        bucketEmail,
        emails: globalEmails,
        archiveEmail,
        loadEmailBody,
        setCurrentView,
        fetchBucketThreads
    } = useMail();
    const [bucketEmails, setBucketEmails] = React.useState<EmailWithThread[]>([]);
    const [groupBy, setGroupBy] = React.useState<GroupBy>('none');
    const [showGroupMenu, setShowGroupMenu] = React.useState(false);

    // Set current view to bucket when this component mounts
    React.useEffect(() => {
        setCurrentView('bucket');
    }, [setCurrentView]);

    const handleBucketEmail = async (emailId: string, targetBucketId: string) => {
        console.log(`[BucketGallery] handleBucketEmail called with emailId=${emailId}, targetBucketId=${targetBucketId}`);
        if (targetBucketId === bucket.id) return;

        // Find the email to get its threadId if it's a thread
        const email = bucketEmails.find(e => e.id === emailId);
        console.log(`[BucketGallery] Found email:`, email ? { id: email.id, threadId: email.threadId, threadCount: email.threadCount } : 'not found');

        if (targetBucketId === 'archive') {
            // If this is a thread, archive the entire thread
            if (email?.threadId) {
                console.log(`[BucketGallery] Archiving entire thread ${email.threadId}`);
                // Optimistic update first
                setBucketEmails(prev => prev.filter(e => e.id !== emailId));
                try {
                    const response = await fetch(`/api/threads/${encodeURIComponent(email.threadId)}/archive`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (!response.ok) {
                        console.error('[BucketGallery] Failed to archive thread:', await response.text());
                    }
                } catch (err) {
                    console.error('[BucketGallery] Error archiving thread:', err);
                }
            } else {
                // Single email
                archiveEmail(emailId, bucket.id);
                setBucketEmails(prev => prev.filter(e => e.id !== emailId));
            }
        } else if (targetBucketId === 'inbox') {
            // Move back to inbox (unbucket)
            // If this is a thread, unbucket the entire thread
            if (email?.threadId) {
                console.log(`[BucketGallery] Unbucketing entire thread ${email.threadId}`);
                try {
                    const response = await fetch(`/api/threads/${encodeURIComponent(email.threadId)}/unbucket`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (!response.ok) {
                        console.error('[BucketGallery] Failed to unbucket thread:', await response.text());
                    }
                } catch (err) {
                    console.error('[BucketGallery] Error unbucketing thread:', err);
                }
            } else {
                // Single email, use regular bucket email
                bucketEmail(emailId, 'inbox');
            }
            setBucketEmails(prev => prev.filter(e => e.id !== emailId));
        } else {
            bucketEmail(emailId, targetBucketId);
            setBucketEmails(prev => prev.filter(e => e.id !== emailId));
        }
    };

    // Fetch threads for this bucket and convert to emails with thread info
    React.useEffect(() => {
        const fetchBucketData = async () => {
            try {
                // Try to fetch threads first
                if (fetchBucketThreads) {
                    const threads: ThreadGroup[] = await fetchBucketThreads(bucket.id);
                    console.log(`[BucketGallery] Fetched ${threads?.length || 0} threads for bucket ${bucket.id}`, threads);

                    if (threads && threads.length > 0) {
                        // Convert threads to emails with thread count
                        const emailsWithThreads: EmailWithThread[] = threads.map(thread => {
                            const latest = thread.latestEmail;
                            console.log(`[BucketGallery] Thread ${thread.threadId.substring(0, 20)}... count=${thread.count}`);
                            return {
                                id: latest.messageId || thread.threadId,
                                uid: latest.uid?.toString(),
                                messageId: latest.messageId,
                                sender: latest.sender,
                                senderAddress: latest.senderAddress,
                                subject: latest.subject,
                                preview: latest.preview || '',
                                body: '<p>Loading...</p>',
                                date: new Date(latest.date),
                                read: true,
                                bucketId: bucket.id,
                                threadId: thread.threadId,
                                threadCount: thread.count
                            };
                        });
                        setBucketEmails(emailsWithThreads);
                        return;
                    }
                }

                // Fallback to regular email fetch
                const res = await fetch(`/api/bucket/${bucket.id}`);
                if (res.ok) {
                    const data: ApiEmailResponse[] = await res.json();
                    const mappedEmails = mapApiResponsesToEmails(data, { bucketId: bucket.id });
                    setBucketEmails(mappedEmails as EmailWithThread[]);
                }
            } catch (err) {
                console.error('Error loading bucket data:', err);
            }
        };

        fetchBucketData();
    }, [bucket.id, fetchBucketThreads]);

    // Sync with global emails state for metadata updates
    React.useEffect(() => {
        setBucketEmails(prev => prev.map(bucketEmail => {
            const globalEmail = globalEmails.find(e => e.id === bucketEmail.id);
            if (globalEmail) {
                return {
                    ...bucketEmail,
                    note: globalEmail.note,
                    dueDate: globalEmail.dueDate,
                    body: globalEmail.body,
                    preview: globalEmail.preview
                };
            }
            return bucketEmail;
        }));
    }, [globalEmails]);

    // Listen for events
    React.useEffect(() => {
        const handleArchive = (e: any) => {
            if (e.detail && e.detail.emailId) {
                setBucketEmails(prev => prev.filter(email => email.id !== e.detail.emailId));
            }
        };

        const handleBodyLoaded = (e: any) => {
            if (e.detail && e.detail.emailId) {
                setBucketEmails(prev => prev.map(email => {
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

        const handleEmailUpdated = (e: any) => {
            if (e.detail && e.detail.id) {
                setBucketEmails(prev => prev.map(email => {
                    if (email.id === e.detail.id) {
                        return {
                            ...email,
                            ...e.detail.updates
                        };
                    }
                    return email;
                }));
            }
        };

        window.addEventListener('emailArchived', handleArchive);
        window.addEventListener('emailBodyLoaded', handleBodyLoaded);
        window.addEventListener('emailUpdated', handleEmailUpdated);

        return () => {
            window.removeEventListener('emailArchived', handleArchive);
            window.removeEventListener('emailBodyLoaded', handleBodyLoaded);
            window.removeEventListener('emailUpdated', handleEmailUpdated);
        };
    }, []);

    // Background preview loading
    useBackgroundPreviews(bucketEmails, { loadEmailBody });

    // Group emails by sender
    const groupedEmails = React.useMemo(() => {
        if (groupBy === 'sender') {
            const groups = new Map<string, EmailWithThread[]>();

            bucketEmails.forEach(email => {
                const sender = email.sender;
                if (!groups.has(sender)) {
                    groups.set(sender, []);
                }
                groups.get(sender)!.push(email);
            });

            groups.forEach((emails, sender) => {
                groups.set(sender, emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            });

            return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
        }
        return null;
    }, [bucketEmails, groupBy]);

    const renderGrouped = () => {
        if (!groupedEmails) return null;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
                {groupedEmails.map(([sender, emails]) => (
                    <div key={sender}>
                        <h3 style={{
                            fontSize: 'var(--font-size-lg)',
                            fontWeight: 600,
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
                            {emails.map((email) => (
                                <EmailCard
                                    key={email.id}
                                    email={email}
                                    onClick={() => onSelectEmail(email)}
                                    onBucket={handleBucketEmail}
                                    threadCount={email.threadCount}
                                />
                            ))}
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
                {bucketEmails.map((email) => (
                    <EmailCard
                        key={email.id}
                        email={email}
                        onClick={() => onSelectEmail(email)}
                        onBucket={handleBucketEmail}
                        threadCount={email.threadCount}
                    />
                ))}
            </div>
        );
    };

    return (
        <div style={{ paddingTop: 'var(--space-xl)', paddingBottom: '140px' }}>
            <header style={{ marginBottom: 'var(--space-xl)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 style={{
                        fontSize: 'var(--font-size-3xl)',
                        fontWeight: 800,
                        color: bucket.color,
                        marginBottom: 'var(--space-xs)'
                    }}>
                        {bucket.label}
                    </h2>
                    <p className="text-muted">
                        {bucketEmails.length} {bucketEmails.length === 1 ? 'thread' : 'threads'}
                    </p>
                </div>

                {/* Group dropdown */}
                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setShowGroupMenu(!showGroupMenu)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-xs)',
                            padding: 'var(--space-sm) var(--space-md)',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 500,
                            color: 'var(--color-text-main)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        {groupBy === 'none' ? 'Group' : 'Group: By sender'}
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
                                    backgroundColor: 'var(--color-surface)',
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-md)',
                                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
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
                                        backgroundColor: groupBy === 'none' ? 'var(--color-surface-hover)' : 'transparent',
                                        border: 'none',
                                        color: 'var(--color-text-main)',
                                        fontSize: 'var(--font-size-sm)',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = groupBy === 'none' ? 'var(--color-surface-hover)' : 'transparent'}
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
                                        backgroundColor: groupBy === 'sender' ? 'var(--color-surface-hover)' : 'transparent',
                                        border: 'none',
                                        color: 'var(--color-text-main)',
                                        fontSize: 'var(--font-size-sm)',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = groupBy === 'sender' ? 'var(--color-surface-hover)' : 'transparent'}
                                >
                                    By sender
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </header>

            {/* Email Grid or Grouped View */}
            {groupBy === 'sender' ? renderGrouped() : renderUngrouped()}
        </div>
    );
};
