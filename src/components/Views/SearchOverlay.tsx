import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Archive, Inbox, Send } from 'lucide-react';
import { type Email } from '../../store/mailStore';
import { useMail } from '../../context/MailContext';
import { api, acct, reasonFor } from '../../api/client';
import { tryAgain } from '../../api/engineWords';
import type { ViewPage } from '../../api/types';
import { cardFromThread } from '../../utils/emailMapper';
import { usePublishList, type ListKey } from '../../hooks/conversationLists';
import { formatListDate } from '../../utils/formatDate';
import { AfterDelay, SearchResultSkeleton } from '../Loading/Skeletons';
import { BucketGlyph } from '../Buckets/BucketGlyph';
import { ThreadLink } from './ThreadLink';
import { KEEP_OVER_VIEW, useEscape, useModal, Z } from '../../utils/layers';
import { DURATION, leave, tween } from '../../utils/motion';
import { formatCount } from '../../utils/format';
import { IconButton } from '../../ui/Button';
import { TextInput } from '../../ui/Field';

interface SearchOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    /** Opens a conversation, saying which list it was opened from (for previous / next). */
    onSelectEmail: (email: Email, list?: ListKey) => void;
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
    // A view, not a dialog (rule L6; board P5-fields-dialogs-end-state, row 5): it replaces a thread
    // instead of stacking on one. Like the thread view, the field takes the focus, Tab stays inside,
    // the page behind is inert, and closing goes back to the top bar's Search
    const layer = useRef<HTMLDivElement>(null);
    useModal(layer, isOpen, { keep: KEEP_OVER_VIEW });
    useEscape(isOpen, 'view', onClose); // rule L4

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
                .catch(err => { if (current) { const why = reasonFor(err); setError(why ? `Search didn't work: ${why}` : tryAgain('search')); } });
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
    usePublishList('search', results);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    ref={layer}
                    data-layer="view"
                    role="region"
                    aria-label="Search"
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20, transition: leave() }}
                    transition={tween(DURATION.mid)}
                    style={{
                        position: 'fixed',
                        top: 'var(--server-banner)',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'var(--bg-page)',
                        zIndex: Z.view.search,
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    {/* Header */}
                    <div style={{
                        padding: 'var(--space-4) var(--space-6)',
                        borderBottom: '1px solid var(--line-1)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-4)'
                    }}>
                        <Search size={16} className="text-muted" />
                        <TextInput
                            bare
                            type="text"
                            placeholder="Search all mail"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                            style={{ flex: 1, fontSize: 'var(--size-title)' }}
                        />
                        <IconButton label="Close search" icon={<X size={16} aria-hidden="true" />} onClick={onClose} />
                    </div>



                    {/* Results */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }}>
                        {error && query && (
                            <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 'var(--space-16)' }}>
                                {error}
                            </div>
                        )}

                        {page && page.result.count > results.length && (
                            <div className="text-muted" style={{ fontSize: 'var(--size-body)', marginBottom: 'var(--space-4)', fontVariantNumeric: 'tabular-nums' }}>
                                Showing the newest {formatCount(results.length)} of {formatCount(page.result.count)} threads. Add a word to narrow it down.
                            </div>
                        )}

                        {/* Waiting with nothing to show yet: skeleton results (only if the wait is noticeable) */}
                        {query.trim() && page?.q !== query.trim() && !error && results.length === 0 && (
                            <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                <AfterDelay>
                                    {[0, 1, 2, 3].map(i => <SearchResultSkeleton key={i} />)}
                                </AfterDelay>
                            </div>
                        )}

                        {results.length > 0 ? (
                            <div data-thread-list="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                {results.map(email => (
                                    <div
                                        key={email.id}
                                        data-thread-card=""
                                        onClick={() => {
                                            onSelectEmail(email, 'search');
                                            onClose();
                                        }}
                                        style={{
                                            padding: 'var(--card-padding)',
                                            backgroundColor: 'var(--surface-1)',
                                            borderRadius: 'var(--radius-3)',
                                            border: '1px solid var(--line-1)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}
                                    >
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>
                                                <ThreadLink threadId={email.threadId} onOpen={() => { onSelectEmail(email, 'search'); onClose(); }}>{email.subject}</ThreadLink>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                                                <span
                                                    className="text-muted"
                                                    style={{
                                                        fontSize: 'var(--size-body)',
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
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                                                {email.locationLabel === 'Archive' ? (
                                                    <Archive size={14} color="var(--text-3)" />
                                                ) : email.location === folders.inbox ? (
                                                    <Inbox size={14} color="var(--text-3)" />
                                                ) : email.locationLabel === 'Sent' ? (
                                                    <Send size={14} color="var(--text-3)" />
                                                ) : (() => {
                                                    // A bucket: its icon, or its emoji until it has one (a bare first letter would repeat the name)
                                                    const bucket = buckets.find(b => b.id === email.location);
                                                    return bucket?.emoji ? (
                                                        <span style={{ display: 'inline-flex', color: 'var(--text-3)' }}>
                                                            <BucketGlyph stored={bucket.emoji} label={bucket.label} size={14} fallbackStyle={{ fontSize: 'var(--size-caption)', lineHeight: 1, filter: 'grayscale(1)', opacity: 0.55 }} />
                                                        </span>
                                                    ) : null;
                                                })()}
                                                <span style={{
                                                    fontSize: 'var(--size-caption)',
                                                    color: 'var(--text-3)',
                                                    fontWeight: 500
                                                }}>
                                                    {email.locationLabel}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-muted" style={{ fontSize: 'var(--size-body)', color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
                                            {formatListDate(email.date)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            query && page && page.q === query.trim() && !error && (
                                <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 'var(--space-16)' }}>
                                    Nothing matches “{query}”
                                </div>
                            )
                        )}

                        {!query && (
                            <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 'var(--space-16)' }}>
                                Type to search across inbox, buckets, and archive
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
