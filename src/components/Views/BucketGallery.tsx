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
    const { bucketEmail, emails: globalEmails, archiveEmail, loadEmailBody, setCurrentView } = useMail();
    const [bucketEmails, setBucketEmails] = React.useState<Email[]>([]);
    const [groupBy, setGroupBy] = React.useState<GroupBy>('none');
    const [showGroupMenu, setShowGroupMenu] = React.useState(false);

    // Set current view to bucket when this component mounts
    React.useEffect(() => {
        setCurrentView('bucket');
    }, [setCurrentView]);

    const handleBucketEmail = (emailId: string, targetBucketId: string) => {
        if (targetBucketId === bucket.id) return;

        if (targetBucketId === 'archive') {
            // Archive the email
            archiveEmail(emailId, bucket.id);
            setBucketEmails(prev => prev.filter(e => e.id !== emailId));
        } else {
            // Move to another bucket
            bucketEmail(emailId, targetBucketId);
            setBucketEmails(prev => prev.filter(e => e.id !== emailId));
        }
    };

    // Fetch emails for this bucket from the API
    React.useEffect(() => {
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
    }, [bucket.id]);

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
                        {bucketEmails.length} items
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
