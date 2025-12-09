import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Archive, Inbox } from 'lucide-react';
import { type Email, type ApiEmailResponse } from '../../store/mailStore';
import { useMail } from '../../context/MailContext';
import { mapApiResponsesToEmails } from '../../utils/emailMapper';
import { useBackgroundPreviews } from '../../hooks';

interface SearchOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectEmail: (email: Email) => void;
}

interface EmailWithLocation extends Email {
    location: string;
}

export const SearchOverlay: React.FC<SearchOverlayProps> = ({ isOpen, onClose, onSelectEmail }) => {
    const { emails, buckets, loadEmailBody } = useMail();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<EmailWithLocation[]>([]);
    const [archivedEmails, setArchivedEmails] = useState<Email[]>([]);
    const [bucketedEmails, setBucketedEmails] = useState<Email[]>([]);
    const [isLoadingArchive, setIsLoadingArchive] = useState(false);
    const [showSenderEmailMap, setShowSenderEmailMap] = useState<Record<string, boolean>>({});

    // Fetch emails from all buckets when overlay opens
    useEffect(() => {
        if (isOpen && buckets.length > 0 && bucketedEmails.length === 0) {
            const fetchAllBuckets = async () => {
                try {
                    const allBucketEmails: Email[] = [];

                    for (const bucket of buckets) {
                        const res = await fetch(`/api/bucket/${bucket.id}`);
                        if (res.ok) {
                            const data: ApiEmailResponse[] = await res.json();
                            const mappedEmails = mapApiResponsesToEmails(data, { bucketId: bucket.id, sort: false });
                            allBucketEmails.push(...mappedEmails);
                        }
                    }

                    setBucketedEmails(allBucketEmails);
                } catch (err) {
                    console.error('Error loading bucket emails for search:', err);
                }
            };
            fetchAllBuckets();
        }
    }, [isOpen, buckets, bucketedEmails.length]);

    // Fetch archived emails when overlay opens
    useEffect(() => {
        if (isOpen && archivedEmails.length === 0) {
            const fetchArchive = async () => {
                setIsLoadingArchive(true);
                try {
                    const res = await fetch('/api/archive');
                    if (res.ok) {
                        const data: ApiEmailResponse[] = await res.json();
                        const mappedEmails = mapApiResponsesToEmails(data, { sort: false });
                        setArchivedEmails(mappedEmails);
                    }
                } catch (err) {
                    console.error('Error loading archive for search:', err);
                } finally {
                    setIsLoadingArchive(false);
                }
            };
            fetchArchive();
        }
    }, [isOpen, archivedEmails.length]);

    // Combine emails for background preview loading
    const allSearchEmails = useMemo(() =>
        [...bucketedEmails, ...archivedEmails],
        [bucketedEmails, archivedEmails]
    );

    // Background preview loading for search results
    useBackgroundPreviews(allSearchEmails, { loadEmailBody, enabled: isOpen });

    // Listen for body loaded events to update previews
    useEffect(() => {
        const handleBodyLoaded = (e: any) => {
            if (e.detail && e.detail.emailId) {
                // Update bucketed emails
                setBucketedEmails(prev => prev.map(email => {
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

                // Update archived emails
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

    // Get location label for an email
    const getLocation = (email: Email, isArchived: boolean): string => {
        if (isArchived) return 'Archive';
        if (!email.bucketId) return 'Inbox';
        const bucket = buckets.find(b => b.id === email.bucketId);
        return bucket?.label || email.bucketId;
    };

    useEffect(() => {
        if (query.trim()) {
            // Combine all emails with location info
            const inboxEmails: EmailWithLocation[] = emails.map(e => ({
                ...e,
                location: getLocation(e, false)
            }));

            const bucketed: EmailWithLocation[] = bucketedEmails.map(e => ({
                ...e,
                location: getLocation(e, false)
            }));

            const archived: EmailWithLocation[] = archivedEmails.map(e => ({
                ...e,
                location: 'Archive'
            }));

            const allEmails = [...inboxEmails, ...bucketed, ...archived];

            // Search through all emails
            const filtered = allEmails.filter(e =>
                e.subject.toLowerCase().includes(query.toLowerCase()) ||
                e.sender.toLowerCase().includes(query.toLowerCase())
            );
            setResults(filtered);
        } else {
            setResults([]);
        }
    }, [query, emails, bucketedEmails, archivedEmails, buckets]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.2 }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'var(--color-bg)',
                        zIndex: 300,
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    {/* Header */}
                    <div style={{
                        padding: 'var(--space-md) var(--space-lg)',
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-md)'
                    }}>
                        <Search size={20} className="text-muted" />
                        <input
                            type="text"
                            placeholder="Search everything..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                            style={{
                                flex: 1,
                                border: 'none',
                                outline: 'none',
                                fontSize: 'var(--font-size-lg)',
                                backgroundColor: 'transparent'
                            }}
                        />
                        <button
                            onClick={onClose}
                            style={{
                                padding: '8px',
                                borderRadius: '50%',
                                backgroundColor: 'var(--color-bg-subtle)',
                                color: 'var(--color-text-muted)',
                                border: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            <X size={20} />
                        </button>
                    </div>



                    {/* Results */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-lg)' }}>
                        {isLoadingArchive && !query && (
                            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: 'var(--space-3xl)' }}>
                                Loading archive...
                            </div>
                        )}

                        {results.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                                {results.map(email => (
                                    <div
                                        key={email.id}
                                        onClick={() => {
                                            onSelectEmail(email);
                                            onClose();
                                        }}
                                        style={{
                                            padding: 'var(--space-md)',
                                            backgroundColor: '#fff',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}
                                    >
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>{email.subject}</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
                                                <span
                                                    className="text-muted"
                                                    style={{
                                                        fontSize: 'var(--font-size-sm)',
                                                        cursor: email.senderAddress ? 'pointer' : 'default'
                                                    }}
                                                    onClick={(e) => {
                                                        if (email.senderAddress) {
                                                            e.stopPropagation();
                                                            setShowSenderEmailMap(prev => ({
                                                                ...prev,
                                                                [email.id]: !prev[email.id]
                                                            }));
                                                        }
                                                    }}
                                                >
                                                    {showSenderEmailMap[email.id] && email.senderAddress ? email.senderAddress : email.sender}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                                                {email.location === 'Archive' ? (
                                                    <Archive size={14} color="var(--color-text-muted)" />
                                                ) : email.location === 'Inbox' ? (
                                                    <Inbox size={14} color="var(--color-text-muted)" />
                                                ) : null}
                                                <span style={{
                                                    fontSize: 'var(--font-size-xs)',
                                                    color: 'var(--color-text-muted)',
                                                    fontWeight: 500
                                                }}>
                                                    {email.location}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                                            {email.date.toLocaleDateString()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            query && (
                                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: 'var(--space-3xl)' }}>
                                    No results found for "{query}"
                                </div>
                            )
                        )}

                        {!query && !isLoadingArchive && (
                            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: 'var(--space-3xl)' }}>
                                Type to search across inbox, buckets, and archive...
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
