import React from 'react';
import { ChevronDown } from 'lucide-react';
import { type Bucket, type Email, type ApiEmailResponse } from '../../store/mailStore';
import { EmailCard } from './EmailCard';
import { useMail } from '../../context/MailContext';
import { mapApiResponsesToEmails } from '../../utils/emailMapper';
import { useBackgroundPreviews } from '../../hooks';

interface BucketGalleryProps {
    bucket: Bucket;
    onSelectEmail: (email: Email) => void;
}

type GroupBy = 'none' | 'sender';

export const BucketGallery: React.FC<BucketGalleryProps> = ({ bucket, onSelectEmail }) => {
    const { emails: globalEmails, loadEmailBody, setCurrentView, addEmailsToInbox } = useMail();
    const [bucketEmails, setBucketEmails] = React.useState<Email[]>([]);
    const [groupBy, setGroupBy] = React.useState<GroupBy>('none');
    const [showGroupMenu, setShowGroupMenu] = React.useState(false);

    // Set current view to bucket when this component mounts
    React.useEffect(() => {
        if (!bucket) return;
        setCurrentView('bucket');
    }, [setCurrentView, bucket]);

    // Helper to normalize subject for thread matching
    const normalizeSubjectForMatch = (subject: string): string => {
        if (!subject) return '';
        return subject
            .replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    };

    // Find all emails in the same thread (by normalized subject)
    const getThreadEmails = (emailId: string): Email[] => {
        const email = bucketEmails.find(e => e.id === emailId);
        if (!email) return [];

        const normalizedSubj = normalizeSubjectForMatch(email.subject);
        if (!normalizedSubj) return [email]; // No subject, just the single email

        return bucketEmails.filter(e => normalizeSubjectForMatch(e.subject) === normalizedSubj);
    };

    // Get a "thread ID" from the first email in the thread (for API calls)
    const getThreadId = (emailId: string): string => {
        const threadEmails = getThreadEmails(emailId);
        if (threadEmails.length > 0) {
            // Use the message ID of the earliest email as thread ID
            const sorted = [...threadEmails].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            return sorted[0].id;
        }
        return emailId;
    };

    const handleBucketEmail = async (emailId: string, targetBucketId: string) => {
        if (!bucket || targetBucketId === bucket.id) return;

        // Get all emails in this thread for optimistic UI update
        const threadEmails = getThreadEmails(emailId);
        const threadEmailIds = threadEmails.map(e => e.id);
        const threadId = getThreadId(emailId);

        // Optimistic update - remove all thread emails from UI
        setBucketEmails(prev => prev.filter(e => !threadEmailIds.includes(e.id)));

        try {
            if (targetBucketId === 'archive') {
                // Use thread archive API for atomic operation
                const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/archive`, {
                    method: 'POST'
                });
                if (!res.ok) {
                    console.error('Failed to archive thread');
                    // Rollback on failure
                    setBucketEmails(prev => [...prev, ...threadEmails]);
                }
                // No refreshData - optimistic update handles UI
            } else if (targetBucketId === 'inbox') {
                // Use thread unbucket API for atomic operation
                const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/unbucket`, {
                    method: 'POST'
                });
                if (!res.ok) {
                    console.error('Failed to unbucket thread');
                    // Rollback on failure
                    setBucketEmails(prev => [...prev, ...threadEmails]);
                } else {
                    // Add to inbox state for immediate display
                    addEmailsToInbox(threadEmails);
                }
            } else {
                // Use thread bucket API for moving to another bucket
                const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/bucket`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bucketId: targetBucketId })
                });
                if (!res.ok) {
                    console.error('Failed to move thread to bucket');
                    // Rollback on failure
                    setBucketEmails(prev => [...prev, ...threadEmails]);
                }
                // No refreshData - optimistic update handles UI
            }
        } catch (err) {
            console.error('Error moving thread:', err);
            // Rollback on error
            setBucketEmails(prev => [...prev, ...threadEmails]);
        }
    };

    // Fetch emails for this bucket from the API
    React.useEffect(() => {
        if (!bucket) return;

        const fetchBucketEmails = async () => {
            try {
                const res = await fetch(`/api/bucket/${bucket.id}`);
                if (res.ok) {
                    const data: ApiEmailResponse[] = await res.json();
                    const mappedEmails = mapApiResponsesToEmails(data, { bucketId: bucket.id });
                    setBucketEmails(mappedEmails);
                }
            } catch (err) {
                console.error('Error loading bucket emails:', err);
            }
        };

        fetchBucketEmails();
    }, [bucket]);

    // Sync with global emails state for metadata updates (notes, due dates, body, preview)  
    React.useEffect(() => {
        setBucketEmails(prev => prev.map(bucketEmail => {
            // Find matching email in global state by ID
            const globalEmail = globalEmails.find(e => e.id === bucketEmail.id);
            if (globalEmail) {
                // Update metadata, body, and preview from global state
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

    // Listen for archived emails and remove them from bucket view
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

        // Create custom event listeners
        window.addEventListener('emailArchived', handleArchive);
        window.addEventListener('emailBodyLoaded', handleBodyLoaded);
        window.addEventListener('emailUpdated', handleEmailUpdated);

        return () => {
            window.removeEventListener('emailArchived', handleArchive);
            window.removeEventListener('emailBodyLoaded', handleBodyLoaded);
            window.removeEventListener('emailUpdated', handleEmailUpdated);
        };
    }, []);

    // Background preview loading for bucket emails
    useBackgroundPreviews(bucketEmails, { loadEmailBody });

    // Group emails by sender
    const groupedEmails = React.useMemo(() => {
        if (groupBy === 'sender') {
            const groups = new Map<string, Email[]>();

            bucketEmails.forEach(email => {
                const sender = email.sender;
                if (!groups.has(sender)) {
                    groups.set(sender, []);
                }
                groups.get(sender)!.push(email);
            });

            // Sort each group chronologically (newest first)
            groups.forEach((emails, sender) => {
                groups.set(sender, emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            });

            // Convert to array and sort by sender name alphabetically
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
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    // Helper to normalize subject for thread grouping
    const normalizeSubject = (subject: string): string => {
        if (!subject) return '';
        return subject
            .replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    };

    // Group emails by normalized subject (thread grouping)
    const threadedEmails = React.useMemo(() => {
        console.log('[BucketGallery] bucketEmails length:', bucketEmails.length);
        const threadMap = new Map<string, Email[]>();

        for (const email of bucketEmails) {
            const normalizedSubj = normalizeSubject(email.subject);
            const key = normalizedSubj || email.id; // Use id as fallback for empty subjects

            if (!threadMap.has(key)) {
                threadMap.set(key, []);
            }
            threadMap.get(key)!.push(email);
        }

        // For each thread, sort by date and return the latest email with thread count
        const result: Array<{ email: Email; threadCount: number }> = [];
        for (const [key, emails] of threadMap) {
            // Sort by date descending
            emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            console.log(`[BucketGallery] Thread group '${key}': ${emails.length} emails`);

            result.push({
                email: emails[0], // Latest email
                threadCount: emails.length
            });
        }

        // Sort threads by latest email date
        result.sort((a, b) => new Date(b.email.date).getTime() - new Date(a.email.date).getTime());
        console.log('[BucketGallery] threadedEmails count:', result.length);
        return result;
    }, [bucketEmails]);

    const renderUngrouped = () => {
        return (
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 'var(--space-lg)'
            }}>
                {threadedEmails.map(({ email, threadCount }) => (
                    <EmailCard
                        key={email.id}
                        email={email}
                        onClick={() => onSelectEmail(email)}
                        onBucket={handleBucketEmail}
                        threadCount={threadCount}
                    />
                ))}
            </div>
        );
    };

    // Guard against undefined bucket (can happen during re-renders after refreshData)
    if (!bucket) {
        return <div style={{ padding: 'var(--space-xl)' }}>Loading...</div>;
    }

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
                        {threadedEmails.length} {threadedEmails.length === 1 ? 'thread' : 'threads'} ({bucketEmails.length} emails)
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
