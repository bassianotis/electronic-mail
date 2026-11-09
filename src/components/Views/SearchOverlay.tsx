import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Archive, Inbox, Send } from 'lucide-react';
import { type Email } from '../../store/mailStore';
import { useMail } from '../../context/MailContext';
import { api, acct, errorText } from '../../api/client';
import type { ViewPage } from '../../api/types';
import { cardFromThread } from '../../utils/emailMapper';
import { formatListDate } from '../../utils/formatDate';
import { AfterDelay, SearchResultSkeleton } from '../Loading/Skeletons';
import { BucketGlyph } from '../Buckets/BucketGlyph';
import { DURATION, tween } from '../../utils/motion';
import { formatCount } from '../../utils/format';

interface SearchOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectEmail: (email: Email) => void;
}

/**
 * Searches sender, subject and text across the Inbox, buckets, Archive and Sent, answered by the
 * engine's index (it never waits on the mail server). One result per conversation, newest first.
 */
export const SearchOverlay: React.FC<SearchOverlayProps> = ({ isOpen, onClose, onSelectEmail }) => {
    const { activeAccountId, folders, folderLabel, buckets } = useMail();
    const [query, setQuery] = useState('');
    const [page, setPage] = useState<{ q: string; result: ViewPage } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showSenderEmailMap, setShowSenderEmailMap] = useState<Record<string, boolean>>({});

    // Clear search when account changes
    useEffect(() => {
        setPage(null);
        setQuery('');
    }, [activeAccountId]);

    // Search as you type (a short pause first, so each keystroke doesn't ask)
    useEffect(() => {
        const q = query.trim();
        if (!q || !activeAccountId) {
            setPage(null);
            setError(null);
            return;
        }
        let current = true;
        const timer = setTimeout(() => {
            api.get<ViewPage>(`${acct(activeAccountId)}/search?q=${encodeURIComponent(q)}&limit=100`)
                .then(result => {
                    if (!current) return;
                    setPage({ q, result });
                    setError(null);
                })
                .catch(err => { if (current) setError(errorText(err)); });
        }, 150);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [query, activeAccountId]);

    const results = useMemo(() => (page?.result.threads ?? []).map(t => {
        const email = cardFromThread(t);
        return { ...email, locationLabel: folderLabel(email.location, email.mailbox) };
    }), [page, folderLabel]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={tween(DURATION.mid)}
                    style={{
                        position: 'fixed',
                        top: 'var(--server-banner)',
                        left: 0,
                        right: 0,
                        bottom: 0,
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
                        <Search size={16} className="text-muted" />
                        <input
                            type="text"
                            placeholder="Search all mail"
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
                            <X size={16} />
                        </button>
                    </div>



                    {/* Results */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-lg)' }}>
                        {error && query && (
                            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: 'var(--space-3xl)' }}>
                                Search didn't work: {error}
                            </div>
                        )}

                        {page && page.result.count > results.length && (
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)', fontVariantNumeric: 'tabular-nums' }}>
                                Showing the newest {formatCount(results.length)} of {formatCount(page.result.count)} threads. Add a word to narrow it down.
                            </div>
                        )}

                        {/* Waiting with nothing to show yet: skeleton results (only if the wait is noticeable) */}
                        {query.trim() && page?.q !== query.trim() && !error && results.length === 0 && (
                            <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                                <AfterDelay>
                                    {[0, 1, 2, 3].map(i => <SearchResultSkeleton key={i} />)}
                                </AfterDelay>
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
                                            padding: 'var(--card-pad)',
                                            backgroundColor: 'var(--surface-card)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}
                                    >
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: '4px' }}>{email.subject}</div>
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
                                                {email.locationLabel === 'Archive' ? (
                                                    <Archive size={14} color="var(--color-text-muted)" />
                                                ) : email.location === folders.inbox ? (
                                                    <Inbox size={14} color="var(--color-text-muted)" />
                                                ) : email.locationLabel === 'Sent' ? (
                                                    <Send size={14} color="var(--color-text-muted)" />
                                                ) : (() => {
                                                    // A bucket: its icon, or its emoji until it has one (a bare first letter would repeat the name)
                                                    const bucket = buckets.find(b => b.id === email.location);
                                                    return bucket?.emoji ? (
                                                        <span style={{ display: 'inline-flex', color: 'var(--color-text-muted)' }}>
                                                            <BucketGlyph stored={bucket.emoji} label={bucket.label} size={14} fallbackStyle={{ fontSize: '12px', lineHeight: 1, filter: 'grayscale(1)', opacity: 0.55 }} />
                                                        </span>
                                                    ) : null;
                                                })()}
                                                <span style={{
                                                    fontSize: 'var(--font-size-xs)',
                                                    color: 'var(--color-text-muted)',
                                                    fontWeight: 500
                                                }}>
                                                    {email.locationLabel}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-faint)', fontVariantNumeric: 'var(--date-numerals)' }}>
                                            {formatListDate(email.date)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            query && page && page.q === query.trim() && !error && (
                                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: 'var(--space-3xl)' }}>
                                    No results found for "{query}"
                                </div>
                            )
                        )}

                        {!query && (
                            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: 'var(--space-3xl)' }}>
                                Type to search across inbox, buckets, and archive
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
