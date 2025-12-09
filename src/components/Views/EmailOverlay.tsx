
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Email } from '../../store/mailStore';
import { X, Check, Edit3, Clock, RotateCcw, Calendar, BookOpen } from 'lucide-react';
import { useMail } from '../../context/MailContext';
import { extractReaderContent } from '../../utils/emailUtils';
import { ShadowContainer } from './ShadowContainer';
import { sanitizeHtml } from '../../utils/sanitize';

interface EmailOverlayProps {
    email: Email | null;
    onClose: () => void;
}


const actionButtonStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 16px',
    borderRadius: 'var(--radius-full)',
    backgroundColor: '#fff',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-main)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 500,
    boxShadow: 'var(--shadow-sm)',
    cursor: 'pointer'
};

export const EmailOverlay: React.FC<EmailOverlayProps> = ({ email: propEmail, onClose }) => {
    const { emails, updateEmail, archiveEmail, unarchiveEmail, loadEmailBody, markAsRead, currentView: currentViewFromContext } = useMail();

    // Use fresh email from context if available (to get updated UID), otherwise use prop
    const email = React.useMemo(() => {
        const storeEmail = emails.find(e => e.id === propEmail?.id);
        if (storeEmail) {
            // If the prop email explicitly sets the bucket to 'inbox' (e.g. from ArchiveView restore toast),
            // we should respect that override even if the store email has no bucketId (which is standard for inbox).
            // This prevents the overlay from falling back to 'Archive Mode' (showing Restore button) just because there's no bucketId.
            if (propEmail?.bucketId === 'inbox' && !storeEmail.bucketId) {
                return { ...storeEmail, bucketId: 'inbox' };
            }
            return storeEmail;
        }
        return propEmail;
    }, [emails, propEmail]);

    const [note, setNote] = useState(email?.note || '');
    const [dueDate, setDueDate] = useState(email?.dueDate ? new Date(email.dueDate).toISOString().split('T')[0] : '');
    const [isEditingNote, setIsEditingNote] = useState(false);
    const [isSettingDate, setIsSettingDate] = useState(false);
    const dateButtonRef = React.useRef<HTMLButtonElement>(null);
    const [datePopupPosition, setDatePopupPosition] = useState<{ top: number; left: number; bottom?: number }>({ top: 0, left: 0 });
    const [showSenderEmail, setShowSenderEmail] = useState(false);
    const [localBody, setLocalBody] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<Array<{ filename: string; contentType: string; size: number }>>([]);
    const [showUI, setShowUI] = useState(true);
    const hideTimeoutRef = React.useRef<number | null>(null);
    const [isScrolledFromTop, setIsScrolledFromTop] = React.useState(false);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const headerRef = React.useRef<HTMLDivElement>(null);
    const [headerHeight, setHeaderHeight] = useState(120); // Default/minimum height
    const [zoomLevel, setZoomLevel] = useState(1.0);
    const isHoveringUIRef = React.useRef(false);
    const [readerMode, setReaderMode] = useState(false);

    const handleMouseEnterUI = () => {
        isHoveringUIRef.current = true;
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }
        setShowUI(true);
    };

    const handleMouseLeaveUI = () => {
        isHoveringUIRef.current = false;
    };

    // Scroll tracking for conditional UI hiding
    useEffect(() => {
        const contentElement = contentRef.current;
        if (!contentElement) {
            return;
        }

        const handleScroll = () => {
            const scrollTop = contentElement.scrollTop;
            const wasScrolledFromTop = isScrolledFromTop;
            const nowScrolledFromTop = scrollTop > 50; // Threshold: 50px from top

            setIsScrolledFromTop(nowScrolledFromTop);

            // If user scrolled back to top, show UI immediately
            if (wasScrolledFromTop && !nowScrolledFromTop) {
                setShowUI(true);
                if (hideTimeoutRef.current) {
                    clearTimeout(hideTimeoutRef.current);
                }
            }

            // If user scrolled down, start/restart auto-hide timer (but don't show UI)
            if (nowScrolledFromTop) {
                // Don't show UI on scroll - only mouse movement or returning to top shows it
                if (hideTimeoutRef.current) {
                    clearTimeout(hideTimeoutRef.current);
                }
                hideTimeoutRef.current = setTimeout(() => {
                    if (!isHoveringUIRef.current) {
                        setShowUI(false);
                    }
                }, 1000) as unknown as number;
            }
        };

        contentElement.addEventListener('scroll', handleScroll);
        return () => {
            contentElement.removeEventListener('scroll', handleScroll);
        };
    }, [isScrolledFromTop, email]); // Re-run when email changes to ensure ref is attached

    // Mouse activity tracking for auto-hiding UI
    useEffect(() => {
        const handleMouseMove = () => {
            // Show UI on mouse move
            setShowUI(true);

            // Clear existing timeout
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }

            // Only set timeout to hide if scrolled from top
            // If at top, UI stays visible
            if (isScrolledFromTop) {
                hideTimeoutRef.current = setTimeout(() => {
                    if (!isHoveringUIRef.current) {
                        setShowUI(false);
                    }
                }, 1000) as unknown as number;
            }
        };

        window.addEventListener('mousemove', handleMouseMove);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
        };
    }, [isScrolledFromTop]); // Add dependency so handler updates when scroll state changes

    // Reset reader mode when opening a new email
    useEffect(() => {
        setReaderMode(false);
        setZoomLevel(1.0);
    }, [email?.id]);

    // Effect 1: Reset local state when email ID changes
    useEffect(() => {
        if (email) {
            setNote(email.note || '');
            setDueDate(email.dueDate ? new Date(email.dueDate).toISOString().split('T')[0] : '');
            setIsEditingNote(false);
            setIsSettingDate(false);
            setLocalBody(null);
            setAttachments(email.attachments || []);
        }
    }, [email?.id]);

    // Measure header height when content changes
    useEffect(() => {
        if (headerRef.current && showUI) {
            const height = headerRef.current.scrollHeight;
            setHeaderHeight(Math.max(height, 80)); // Minimum 80px
        }
    }, [email?.subject, showUI, dueDate, note]);

    // Track which email has been marked as read to prevent duplicate calls
    const markedAsReadRef = React.useRef<string | null>(null);

    // Effect 2a: Mark as read (separate effect to avoid dependency issues)
    useEffect(() => {
        if (!email) return;

        // Only mark as read once per email
        if (markedAsReadRef.current !== email.id) {
            markedAsReadRef.current = email.id;

            // Always mark as read when email is opened
            if (email.uid) {
                markAsRead(email.id, email.uid);
            } else {
                markAsRead(email.id);
            }
        }
    }, [email?.id]); // Only depend on email ID, not the markAsRead function

    // Effect 2b: Load body if needed
    useEffect(() => {
        if (!email) return;

        // Load body if needed
        if ((email.body === '<p>Loading body...</p>' || !email.body) && !localBody) {
            loadEmailBody(email.id, email.uid).then(data => {
                if (data && data.html) {
                    setLocalBody(data.html);
                    setAttachments((data as any).attachments || []);
                }
            });
        }
    }, [email, loadEmailBody, localBody]);

    // Effect 3: Listen for global events (body loaded, updates) to handle bucketed emails
    // that aren't in the global context
    useEffect(() => {
        if (!email) return;

        const handleBodyLoaded = (e: any) => {
            console.log('EmailOverlay: Received emailBodyLoaded event', e.detail);
            if (e.detail && e.detail.emailId === email.id) {
                console.log('EmailOverlay: Updating local body from event', e.detail.body?.substring(0, 50));
                setLocalBody(e.detail.body);
                if (e.detail.attachments) {
                    setAttachments(e.detail.attachments);
                }
            } else {
                console.log('EmailOverlay: Event emailId mismatch', e.detail?.emailId, email.id);
            }
        };

        const handleEmailUpdated = (e: any) => {
            if (e.detail && e.detail.id === email.id) {
                const updates = e.detail.updates;
                if (updates.note !== undefined) setNote(updates.note);
                if (updates.dueDate !== undefined) setDueDate(updates.dueDate ? new Date(updates.dueDate).toISOString().split('T')[0] : '');
            }
        };

        window.addEventListener('emailBodyLoaded', handleBodyLoaded);
        window.addEventListener('emailUpdated', handleEmailUpdated);

        return () => {
            window.removeEventListener('emailBodyLoaded', handleBodyLoaded);
            window.removeEventListener('emailUpdated', handleEmailUpdated);
        };
    }, [email?.id]);

    if (!email) return null;

    const handleSaveNote = () => {
        if (email) {
            updateEmail(email.id, { note, messageId: email.messageId });
            setIsEditingNote(false);
        }
    };

    const handleArchive = () => {
        if (email) {
            archiveEmail(email.id, email.bucketId);
            onClose();
        }
    };

    return (
        <AnimatePresence>
            {email && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 200,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none'
                }}>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            backgroundColor: 'rgba(0,0,0,0.2)',
                            backdropFilter: 'blur(4px)',
                            pointerEvents: 'auto'
                        }}
                    />

                    {/* Modal */}
                    <motion.div
                        layoutId={`email - ${email.id} `}
                        style={{
                            position: 'relative',
                            width: '95%',
                            maxWidth: '1000px',
                            height: '90vh',
                            backgroundColor: readerMode ? '#1a1a1a' : '#fff',
                            borderRadius: 'var(--radius-lg)',
                            boxShadow: 'var(--shadow-floating)',
                            zIndex: 201,
                            overflow: 'hidden',
                            pointerEvents: 'auto',
                            color: readerMode ? '#e0e0e0' : 'inherit'
                        }}
                    >
                        {/* Content (Scrollable) - Full height with padding for header/footer */}
                        <div
                            ref={contentRef}
                            className={readerMode ? 'reader-scroll-container' : ''}
                            style={{
                                height: '100%',
                                overflowY: 'auto',
                                paddingTop: showUI ? `${headerHeight + 16}px` : '50px', // Dynamic based on actual header height
                                paddingBottom: '80px',
                                paddingLeft: readerMode ? '40px' : 'var(--space-lg)',
                                paddingRight: readerMode ? '40px' : 'var(--space-lg)',
                                transition: 'padding 0.3s ease'
                            }}>
                            {/* Note Editor */}
                            {isEditingNote && (
                                <div style={{ marginBottom: 'var(--space-lg)', padding: 'var(--space-md)', backgroundColor: '#fff9db', borderRadius: 'var(--radius-md)' }}>
                                    <textarea
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="Add a note..."
                                        style={{
                                            width: '100%',
                                            minHeight: '80px',
                                            border: 'none',
                                            backgroundColor: 'transparent',
                                            resize: 'none',
                                            outline: 'none',
                                            fontSize: 'var(--font-size-base)',
                                            marginBottom: 'var(--space-sm)'
                                        }}
                                        autoFocus
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                        <button onClick={() => setIsEditingNote(false)} style={{ fontSize: '12px', padding: '4px 8px' }}>Cancel</button>
                                        <button onClick={handleSaveNote} style={{ fontSize: '12px', padding: '4px 8px', backgroundColor: '#e67e22', color: '#fff', borderRadius: '4px' }}>Save Note</button>
                                    </div>
                                </div>
                            )}

                            {/* Display Note if not editing */}
                            {!readerMode && !isEditingNote && note && (
                                <div
                                    onClick={() => setIsEditingNote(true)}
                                    style={{
                                        marginBottom: 'var(--space-lg)',
                                        padding: 'var(--space-md)',
                                        backgroundColor: '#fff9db',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        border: '1px dashed transparent',
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.borderColor = '#e67e22'}
                                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                >
                                    <p style={{ fontSize: 'var(--font-size-sm)', color: '#5e4e3e', whiteSpace: 'pre-wrap' }}>{note}</p>
                                </div>
                            )}

                            {/* Thread / Body */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
                                <div style={{
                                    paddingLeft: readerMode ? '0' : 'var(--space-md)',
                                    borderLeft: readerMode ? 'none' : '2px solid var(--color-accent-secondary)',
                                    maxWidth: readerMode ? '680px' : '100%',
                                    margin: readerMode ? '0 auto' : '0'
                                }}>
                                    {!readerMode && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                                            <strong>{email.sender}</strong>
                                            <span className="text-muted">Today</span>
                                        </div>
                                    )}
                                    {/* Email Body */}
                                    {readerMode ? (
                                        // Reader mode: Show cleaned content only (subject already in header)
                                        <div
                                            className="reader-content"
                                            style={{
                                                fontSize: '18px',
                                                lineHeight: '1.7',
                                                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                                            }}
                                            dangerouslySetInnerHTML={{ __html: extractReaderContent(localBody || email.body || '') }}
                                        />
                                    ) : (
                                        // Normal mode: Show original HTML inside Shadow DOM to prevent style leakage
                                        <ShadowContainer
                                            style={{
                                                backgroundColor: '#fff',
                                                minHeight: '200px',
                                                position: 'relative',
                                                zIndex: 1
                                            }}
                                        >
                                            <div
                                                className="email-body-content"
                                                style={{
                                                    fontSize: '16px',
                                                    lineHeight: '1.6',
                                                    color: '#333',
                                                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                                                    wordWrap: 'break-word',
                                                    overflowWrap: 'break-word',
                                                    maxWidth: '100%'
                                                }}
                                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(localBody || email.body) }}
                                            />
                                        </ShadowContainer>
                                    )}

                                    {/* Attachments */}
                                    {!readerMode && attachments.length > 0 && (
                                        <div style={{
                                            marginTop: 'var(--space-lg)',
                                            paddingTop: 'var(--space-md)',
                                            borderTop: '1px solid var(--color-border)'
                                        }}>
                                            <div style={{
                                                fontSize: 'var(--font-size-sm)',
                                                fontWeight: 600,
                                                color: 'var(--color-text-muted)',
                                                marginBottom: 'var(--space-sm)'
                                            }}>
                                                Attachments ({attachments.length})
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                                                {attachments.map((attachment, idx) => (
                                                    <a
                                                        key={idx}
                                                        href={`/ api / emails / ${email.id} /attachments/${idx} `}
                                                        download={attachment.filename}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 'var(--space-sm)',
                                                            padding: 'var(--space-sm)',
                                                            backgroundColor: 'var(--color-surface)',
                                                            border: '1px solid var(--color-border)',
                                                            borderRadius: 'var(--radius-sm)',
                                                            textDecoration: 'none',
                                                            color: 'var(--color-text-main)',
                                                            fontSize: 'var(--font-size-sm)',
                                                            cursor: 'pointer',
                                                            transition: 'background-color 0.2s'
                                                        }}
                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'}
                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface)'}
                                                    >
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                            <polyline points="7 10 12 15 17 10"></polyline>
                                                            <line x1="12" y1="15" x2="12" y2="3"></line>
                                                        </svg>
                                                        <span style={{ flex: 1 }}>{attachment.filename}</span>
                                                        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
                                                            {(attachment.size / 1024).toFixed(1)} KB
                                                        </span>
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Unified Header - morphs between expanded and compact states */}
                        <motion.div
                            animate={{
                                height: showUI ? 'auto' : '50px', // Explicit height control
                                backgroundColor: readerMode ? '#1a1a1a' : '#fff'
                            }}
                            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }} // Smooth cubic bezier
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                borderBottom: readerMode ? '1px solid #333' : '1px solid var(--color-border)',
                                zIndex: 10,
                                pointerEvents: showUI ? 'auto' : 'none',
                                overflow: 'hidden', // Clip content during resize
                                color: readerMode ? '#e0e0e0' : 'inherit'
                            }}
                            onMouseEnter={handleMouseEnterUI}
                            onMouseLeave={handleMouseLeaveUI}
                        >

                            {/* Container for content to ensure proper spacing */}
                            <div ref={headerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>

                                {/* Expanded content */}
                                <motion.div
                                    animate={{
                                        opacity: showUI ? 1 : 0,
                                        y: showUI ? 0 : -10,
                                        pointerEvents: showUI ? 'auto' : 'none'
                                    }}
                                    transition={{ duration: 0.2 }}
                                    style={{
                                        padding: 'var(--space-lg)',
                                        width: '100%'
                                    }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ flex: 1 }}>
                                            <h2 style={{
                                                fontSize: 'var(--font-size-2xl)',
                                                fontWeight: 700,
                                                marginBottom: 'var(--space-xs)',
                                                color: readerMode ? '#e0e0e0' : 'var(--color-text-main)'
                                            }}>
                                                {email.subject}
                                            </h2>
                                            <div style={{ display: 'flex', gap: 'var(--space-md)', color: readerMode ? '#b0b0b0' : 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span
                                                    style={{
                                                        fontWeight: 600,
                                                        color: readerMode ? '#e0e0e0' : 'var(--color-text-main)',
                                                        cursor: email.senderAddress ? 'pointer' : 'default'
                                                    }}
                                                    onClick={() => {
                                                        if (email.senderAddress) {
                                                            setShowSenderEmail(!showSenderEmail);
                                                        }
                                                    }}>
                                                    {showSenderEmail && email.senderAddress ? email.senderAddress : email.sender}
                                                </span>
                                                <span>{email.date.toLocaleString()}</span>

                                                {dueDate && (
                                                    <span style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        backgroundColor: '#fff0f6',
                                                        color: '#c02d78',
                                                        padding: '2px 8px',
                                                        borderRadius: '4px',
                                                        fontSize: '11px',
                                                        fontWeight: 600
                                                    }}>
                                                        <Clock size={10} /> Due {new Date(dueDate + 'T12:00:00').toLocaleDateString()}
                                                    </span>
                                                )}
                                                {note && (
                                                    <span style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        backgroundColor: '#fff9db',
                                                        color: '#e67e22',
                                                        padding: '2px 8px',
                                                        borderRadius: '4px',
                                                        fontSize: '11px',
                                                        fontWeight: 600
                                                    }}>
                                                        <Edit3 size={10} /> Note
                                                    </span>
                                                )}


                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                            <button
                                                onClick={onClose}
                                                style={{
                                                    padding: '8px',
                                                    borderRadius: '50%',
                                                    backgroundColor: 'var(--color-bg-subtle)',
                                                    color: 'var(--color-text-muted)',
                                                }}>
                                                <X size={20} />
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>

                                {/* Compact content - Absolutely positioned to overlap */}
                                <motion.div
                                    animate={{
                                        opacity: showUI ? 0 : 1,
                                        y: showUI ? 10 : 0
                                    }}
                                    transition={{ duration: 0.2 }}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        right: 0,
                                        height: '50px', // Match collapsed height
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '0 var(--space-lg)',
                                        gap: 'var(--space-sm)',
                                        fontSize: 'var(--font-size-sm)',
                                        color: readerMode ? '#b0b0b0' : 'var(--color-text-muted)',
                                        pointerEvents: showUI ? 'none' : 'auto'
                                    }}>
                                    <span style={{ fontWeight: 600, color: readerMode ? '#e0e0e0' : 'var(--color-text-main)' }}>
                                        {email.sender}
                                    </span>
                                    <span style={{ opacity: 0.4 }}>•</span>
                                    <span style={{
                                        flex: 1,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        color: readerMode ? '#e0e0e0' : 'inherit'
                                    }}>
                                        {email.subject}
                                    </span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginLeft: 'auto' }}>
                                        {!readerMode && (
                                            <button
                                                onClick={onClose}
                                                style={{
                                                    padding: '6px',
                                                    borderRadius: '50%',
                                                    backgroundColor: 'var(--color-bg-subtle)',
                                                    color: 'var(--color-text-muted)',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}>
                                                <X size={16} />
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            </div>
                        </motion.div>

                        {/* Action Panel - Absolutely positioned */}
                        {!readerMode && (
                            <motion.div
                                initial={{ y: 0 }}
                                animate={{ y: showUI ? 0 : 100, opacity: showUI ? 1 : 0 }}
                                transition={{ duration: 0.3, ease: "easeInOut" }}
                                style={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    padding: 'var(--space-md) var(--space-lg)',
                                    backgroundColor: 'var(--color-bg-subtle)',
                                    borderTop: '1px solid var(--color-border)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    zIndex: 10,
                                    pointerEvents: showUI ? 'auto' : 'none'
                                }}
                                onMouseEnter={handleMouseEnterUI}
                                onMouseLeave={handleMouseLeaveUI}
                            >
                                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                    <button
                                        onClick={() => setIsEditingNote(true)}
                                        style={actionButtonStyle}
                                    >
                                        <Edit3 size={16} /> Note
                                    </button>

                                    <div style={{ position: 'relative' }}>
                                        <button
                                            ref={dateButtonRef}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!isSettingDate && !dueDate) {
                                                    setDueDate(new Date().toISOString().split('T')[0]);
                                                }

                                                // Calculate button position for fixed popup (ABOVE the button)
                                                if (dateButtonRef.current && !isSettingDate) {
                                                    const rect = dateButtonRef.current.getBoundingClientRect();
                                                    setDatePopupPosition({
                                                        top: 0, // Not used
                                                        left: rect.left,
                                                        bottom: window.innerHeight - rect.top + 8 // Position above the button
                                                    });
                                                }

                                                setIsSettingDate(!isSettingDate);
                                            }}
                                            style={actionButtonStyle}
                                            title="Set Due Date"
                                        >
                                            <Calendar size={18} /> Due
                                        </button>


                                        {isSettingDate && (
                                            <div
                                                onClick={(e) => e.stopPropagation()}
                                                style={{
                                                    position: 'fixed',
                                                    bottom: `${(datePopupPosition as any).bottom}px`,
                                                    left: `${datePopupPosition.left}px`,
                                                    backgroundColor: '#fff',
                                                    padding: '12px',
                                                    borderRadius: '8px',
                                                    boxShadow: 'var(--shadow-lg)',
                                                    zIndex: 1000,
                                                    border: '1px solid var(--color-border)',
                                                    minWidth: '200px'
                                                }}
                                            >
                                                <input
                                                    type="date"
                                                    value={dueDate}
                                                    onChange={(e) => setDueDate(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{
                                                        padding: '6px 8px',
                                                        borderRadius: '4px',
                                                        border: '1px solid #ddd',
                                                        width: '100%',
                                                        marginBottom: '8px'
                                                    }}
                                                    autoFocus
                                                />
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            updateEmail(email.id, {
                                                                dueDate: dueDate ? new Date(dueDate + 'T12:00:00') : undefined,
                                                                messageId: email.messageId
                                                            });
                                                            setIsSettingDate(false);
                                                        }}
                                                        style={{
                                                            flex: 1,
                                                            padding: '6px 12px',
                                                            borderRadius: '4px',
                                                            backgroundColor: 'var(--color-accent-secondary)',
                                                            color: '#fff',
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            border: 'none',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDueDate('');
                                                            updateEmail(email.id, {
                                                                dueDate: null as any,
                                                                messageId: email.messageId
                                                            });
                                                            setIsSettingDate(false);
                                                        }}
                                                        style={{
                                                            flex: 1,
                                                            padding: '6px 12px',
                                                            borderRadius: '4px',
                                                            backgroundColor: '#f5f5f5',
                                                            color: '#666',
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            border: '1px solid #ddd',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Clear
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {email.dateArchived || email.originalBucket || (currentViewFromContext === 'archive' && !email.bucketId) ? (
                                    <button
                                        onClick={() => {
                                            console.log('[OVERLAY] Restore clicked. Email:', email);
                                            const target = email.originalBucket || 'inbox';
                                            unarchiveEmail(email, target);
                                            onClose();
                                        }}
                                        style={{
                                            backgroundColor: '#3b82f6', // Bright Blue
                                            color: '#ffffff',
                                            padding: '8px 24px',
                                            borderRadius: 'var(--radius-full)',
                                            fontWeight: 600,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            boxShadow: 'var(--shadow-md)',
                                            transition: 'transform 0.1s'
                                        }}
                                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                        <RotateCcw size={18} strokeWidth={3} /> Restore
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleArchive}
                                        style={{
                                            backgroundColor: 'var(--color-success)',
                                            color: '#fff',
                                            padding: '8px 24px',
                                            borderRadius: 'var(--radius-full)',
                                            fontWeight: 600,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            boxShadow: 'var(--shadow-md)',
                                            transition: 'transform 0.1s'
                                        }}
                                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                        <Check size={18} strokeWidth={3} /> Archive
                                    </button>
                                )}
                            </motion.div>
                        )}

                        {/* Floating Controls Stack - Bottom Right */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{
                                opacity: showUI ? 1 : 0,
                                y: showUI ? 0 : 20,
                                pointerEvents: showUI ? 'auto' : 'none'
                            }}
                            transition={{ duration: 0.3, ease: "easeInOut", delay: showUI ? 0.05 : 0 }}
                            style={{
                                position: 'absolute',
                                bottom: '80px', // Above the footer
                                right: 'var(--space-lg)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-end',
                                gap: '8px',
                                zIndex: 20
                            }}
                            onMouseEnter={handleMouseEnterUI}
                            onMouseLeave={handleMouseLeaveUI}
                        >
                            {/* Reader Mode Toggle (Always Visible) */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setReaderMode(!readerMode);
                                }}
                                style={{
                                    backgroundColor: readerMode ? '#e0e0e0' : '#fff',
                                    color: readerMode ? '#1a1a1a' : 'var(--color-text-main)',
                                    padding: '8px 16px',
                                    borderRadius: 'var(--radius-full)',
                                    boxShadow: 'var(--shadow-floating)',
                                    border: readerMode ? 'none' : '1px solid var(--color-border)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <BookOpen size={16} />
                                {readerMode ? 'Exit Reader' : 'Reader'}
                            </button>

                            {/* Zoom Controls (Hidden in Reader Mode) */}
                            {!readerMode && (
                                <div style={{
                                    backgroundColor: '#fff',
                                    padding: '4px',
                                    borderRadius: '8px',
                                    boxShadow: 'var(--shadow-floating)',
                                    display: 'flex',
                                    gap: '2px',
                                    border: '1px solid var(--color-border)'
                                }}>
                                    {[
                                        { label: 'Aa', value: 0.9 },
                                        { label: 'Aa', value: 1.0 },
                                        { label: 'Aa', value: 1.1 },
                                        { label: 'Aa', value: 1.2 }
                                    ].map((option, idx) => (
                                        <button
                                            key={idx}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setZoomLevel(option.value);
                                            }}
                                            style={{
                                                fontSize: idx === 0 ? '11px' : idx === 1 ? '13px' : idx === 2 ? '15px' : '17px',
                                                fontWeight: 600,
                                                padding: '6px 10px',
                                                backgroundColor: zoomLevel === option.value ? 'var(--color-bg-subtle)' : 'transparent',
                                                color: zoomLevel === option.value ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                lineHeight: 1
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = zoomLevel === option.value ? 'var(--color-bg-subtle)' : 'var(--color-bg-subtle)'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = zoomLevel === option.value ? 'var(--color-bg-subtle)' : 'transparent'}
                                        >
                                            Aa
                                        </button>
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                </div>
            )
            }
        </AnimatePresence >
    );
};
