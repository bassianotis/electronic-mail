/**
 * ThreadViewWithComposer - Multi-column email thread + composition view
 * 
 * Displays all emails in the thread as horizontally scrollable columns on the left,
 * with the composition panel on the right.
 * Features a draggable scroll bar at the top for navigating through thread emails.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import type { Email } from '../../store/mailStore';
import { CompositionPanel, type DraftEmail } from './CompositionPanel';
import { useMail } from '../../context/MailContext';
import { ShadowContainer } from '../Views/ShadowContainer';
import { sanitizeHtml } from '../../utils/sanitize';

interface ThreadEmail {
    messageId: string;
    uid?: string;
    subject: string;
    sender: string;
    senderAddress?: string;
    date: string;
    preview?: string;
    bodyHtml?: string;
    bodyText?: string;
    mailbox?: string;
}

interface ThreadViewWithComposerProps {
    replyToEmail: Email;
    threadId: string;
    onClose: () => void;
    onSent?: (draft: DraftEmail) => void;
}

export const ThreadViewWithComposer: React.FC<ThreadViewWithComposerProps> = ({
    replyToEmail,
    threadId,
    onClose,
    onSent
}) => {
    const { loadEmailBody } = useMail();
    const [threadEmails, setThreadEmails] = useState<ThreadEmail[]>([]);
    const [isLoadingThread, setIsLoadingThread] = useState(true);
    const [emailBodies, setEmailBodies] = useState<Map<string, string>>(new Map());
    const threadScrollRef = useRef<HTMLDivElement>(null);
    const scrollBarRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [scrollProgress, setScrollProgress] = useState(0);

    // Initialize with the replyToEmail data immediately (fallback if thread API fails)
    useEffect(() => {
        // Create a ThreadEmail from the replyToEmail
        const initialEmail: ThreadEmail = {
            messageId: replyToEmail.messageId || replyToEmail.id,
            uid: replyToEmail.uid,
            subject: replyToEmail.subject,
            sender: replyToEmail.sender,
            senderAddress: replyToEmail.senderAddress,
            date: replyToEmail.date?.toISOString() || new Date().toISOString(),
            bodyHtml: replyToEmail.body,
            mailbox: replyToEmail.bucketId ? 'INBOX' : undefined
        };

        // Set initial state with the reply email
        setThreadEmails([initialEmail]);
        setIsLoadingThread(false);

        // Pre-populate the body if available
        if (replyToEmail.body && replyToEmail.body !== '<p>Loading body...</p>') {
            setEmailBodies(new Map([[initialEmail.messageId, replyToEmail.body]]));
        }

        // Optionally try to fetch the full thread for multi-email threads
        const fetchThreadEmails = async () => {
            try {
                const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/emails`, {
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.emails && data.emails.length > 0) {
                        setThreadEmails(data.emails);
                        // Pre-populate any bodies that came with the response
                        const newBodies = new Map(emailBodies);
                        data.emails.forEach((email: ThreadEmail) => {
                            if (email.bodyHtml) {
                                newBodies.set(email.messageId, email.bodyHtml);
                            }
                        });
                        setEmailBodies(newBodies);
                    }
                }
            } catch (err) {
                // Thread API failed - that's okay, we already have the initial email
                console.log('Thread API not available, using single email view');
            }
        };

        fetchThreadEmails();
    }, [threadId, replyToEmail]);

    // Load email bodies for all visible emails
    useEffect(() => {
        const loadAllBodies = async () => {
            for (const email of threadEmails) {
                if (!emailBodies.has(email.messageId)) {
                    if (email.bodyHtml) {
                        setEmailBodies(prev => new Map(prev).set(email.messageId, email.bodyHtml!));
                    } else if (email.uid) {
                        try {
                            const body = await loadEmailBody(email.messageId, email.uid?.toString());
                            if (body?.html) {
                                setEmailBodies(prev => new Map(prev).set(email.messageId, body.html));
                            }
                        } catch (err) {
                            console.error(`Error loading body for ${email.messageId}:`, err);
                        }
                    }
                }
            }
        };

        if (threadEmails.length > 0) {
            loadAllBodies();
        }
    }, [threadEmails, emailBodies, loadEmailBody]);

    // Handle scroll synchronization
    const handleThreadScroll = () => {
        if (threadScrollRef.current && !isDragging) {
            const { scrollLeft, scrollWidth, clientWidth } = threadScrollRef.current;
            const maxScroll = scrollWidth - clientWidth;
            setScrollProgress(maxScroll > 0 ? scrollLeft / maxScroll : 0);
        }
    };

    // Handle scroll bar drag
    const handleScrollBarMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        handleScrollBarDrag(e);
    };

    const handleScrollBarDrag = (e: React.MouseEvent | MouseEvent) => {
        if (scrollBarRef.current && threadScrollRef.current) {
            const rect = scrollBarRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const progress = Math.max(0, Math.min(1, x / rect.width));
            setScrollProgress(progress);

            const { scrollWidth, clientWidth } = threadScrollRef.current;
            const maxScroll = scrollWidth - clientWidth;
            threadScrollRef.current.scrollLeft = progress * maxScroll;
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                handleScrollBarDrag(e);
            }
        };
        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    const handleSend = async (draft: DraftEmail) => {
        console.log('Sending email:', draft);
        await new Promise(resolve => setTimeout(resolve, 500));
        alert('Email sent! (This is a stub - email was not actually sent)');
        if (onSent) {
            onSent(draft);
        }
        onClose();
    };

    const handleDiscard = () => {
        onClose();
    };

    const isSingleEmail = threadEmails.length <= 1;
    const showScrollBar = threadEmails.length > 1;

    return (
        <AnimatePresence>
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

                {/* Main Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    style={{
                        position: 'relative',
                        width: '95%',
                        maxWidth: '1600px',
                        height: '90vh',
                        display: 'flex',
                        gap: 'var(--space-lg)',
                        zIndex: 201,
                        pointerEvents: 'auto'
                    }}
                >
                    {/* Thread Emails Panel - Horizontally Scrollable */}
                    <motion.div
                        layout
                        style={{
                            flex: isSingleEmail ? 1.2 : 1.5,
                            height: '100%',
                            backgroundColor: '#fff',
                            borderRadius: 'var(--radius-lg)',
                            boxShadow: 'var(--shadow-floating)',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        {/* Thread Header with Scroll Bar */}
                        <div style={{
                            padding: 'var(--space-md) var(--space-lg)',
                            borderBottom: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg-subtle)'
                        }}>
                            <h2 style={{
                                fontSize: 'var(--font-size-lg)',
                                fontWeight: 700,
                                color: 'var(--color-text-main)',
                                marginBottom: showScrollBar ? 'var(--space-md)' : 0
                            }}>
                                {replyToEmail.subject}
                                {threadEmails.length > 1 && (
                                    <span style={{
                                        marginLeft: 'var(--space-sm)',
                                        fontSize: 'var(--font-size-sm)',
                                        fontWeight: 500,
                                        color: 'var(--color-text-muted)'
                                    }}>
                                        ({threadEmails.length} emails in thread)
                                    </span>
                                )}
                            </h2>

                            {/* Draggable Scroll Bar */}
                            {showScrollBar && (
                                <div
                                    ref={scrollBarRef}
                                    onMouseDown={handleScrollBarMouseDown}
                                    style={{
                                        height: '8px',
                                        backgroundColor: 'var(--color-border)',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        position: 'relative'
                                    }}
                                >
                                    {/* Scroll Handle */}
                                    <div
                                        style={{
                                            position: 'absolute',
                                            left: `${scrollProgress * 80}%`,
                                            width: '20%',
                                            height: '100%',
                                            backgroundColor: isDragging ? 'var(--color-accent-secondary)' : 'var(--color-text-muted)',
                                            borderRadius: '4px',
                                            transition: isDragging ? 'none' : 'left 0.1s ease',
                                            cursor: 'grab'
                                        }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Email Columns - Horizontally Scrollable */}
                        <div
                            ref={threadScrollRef}
                            onScroll={handleThreadScroll}
                            style={{
                                flex: 1,
                                display: 'flex',
                                overflowX: 'auto',
                                overflowY: 'hidden',
                                scrollBehavior: 'smooth',
                                scrollbarWidth: 'thin'
                            }}
                        >
                            {isLoadingThread ? (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '100%',
                                    color: 'var(--color-text-muted)'
                                }}>
                                    Loading thread...
                                </div>
                            ) : (
                                threadEmails.map((email, idx) => {
                                    const body = emailBodies.get(email.messageId);
                                    const isNewest = idx === threadEmails.length - 1;

                                    return (
                                        <div
                                            key={email.messageId}
                                            style={{
                                                minWidth: isSingleEmail ? '100%' : '400px',
                                                maxWidth: isSingleEmail ? '100%' : '500px',
                                                height: '100%',
                                                flexShrink: 0,
                                                borderRight: idx < threadEmails.length - 1 ? '1px solid var(--color-border)' : 'none',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                backgroundColor: isNewest ? '#fafbfc' : '#fff'
                                            }}
                                        >
                                            {/* Email Header */}
                                            <div style={{
                                                padding: 'var(--space-md)',
                                                borderBottom: '1px solid var(--color-border)',
                                                backgroundColor: email.mailbox === 'Sent' ? 'rgba(46, 204, 113, 0.05)' : 'transparent'
                                            }}>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 'var(--space-sm)',
                                                    marginBottom: 'var(--space-xs)'
                                                }}>
                                                    <span style={{
                                                        fontWeight: 600,
                                                        color: 'var(--color-text-main)',
                                                        fontSize: 'var(--font-size-sm)'
                                                    }}>
                                                        {email.sender}
                                                    </span>
                                                    {email.mailbox === 'Sent' && (
                                                        <span style={{
                                                            backgroundColor: 'var(--color-accent-primary)',
                                                            color: '#fff',
                                                            fontSize: '10px',
                                                            padding: '1px 6px',
                                                            borderRadius: 'var(--radius-full)',
                                                            fontWeight: 600
                                                        }}>
                                                            Sent
                                                        </span>
                                                    )}
                                                    {isNewest && (
                                                        <span style={{
                                                            backgroundColor: 'var(--color-accent-secondary)',
                                                            color: '#fff',
                                                            fontSize: '10px',
                                                            padding: '1px 6px',
                                                            borderRadius: 'var(--radius-full)',
                                                            fontWeight: 600
                                                        }}>
                                                            Latest
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{
                                                    fontSize: 'var(--font-size-xs)',
                                                    color: 'var(--color-text-muted)'
                                                }}>
                                                    {new Date(email.date).toLocaleString()}
                                                </div>
                                            </div>

                                            {/* Email Body */}
                                            <div style={{
                                                flex: 1,
                                                overflowY: 'auto',
                                                padding: 'var(--space-md)'
                                            }}>
                                                {body ? (
                                                    <ShadowContainer style={{ minHeight: '100px' }}>
                                                        <div
                                                            className="email-body-content"
                                                            style={{
                                                                fontSize: '14px',
                                                                lineHeight: '1.5',
                                                                color: '#333',
                                                                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
                                                            }}
                                                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }}
                                                        />
                                                    </ShadowContainer>
                                                ) : (
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        height: '100%',
                                                        color: 'var(--color-text-muted)',
                                                        fontSize: 'var(--font-size-sm)'
                                                    }}>
                                                        Loading...
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </motion.div>

                    {/* Composition Panel */}
                    <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1, type: 'spring', damping: 25, stiffness: 300 }}
                        style={{
                            flex: 1,
                            height: '100%',
                            minWidth: '400px'
                        }}
                    >
                        <CompositionPanel
                            replyTo={replyToEmail}
                            onSend={handleSend}
                            onDiscard={handleDiscard}
                        />
                    </motion.div>

                    {/* Close button */}
                    <button
                        onClick={onClose}
                        style={{
                            position: 'absolute',
                            top: 'var(--space-xs)',
                            right: 'var(--space-xs)',
                            padding: 'var(--space-sm)',
                            borderRadius: 'var(--radius-full)',
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            color: '#fff',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            zIndex: 10,
                            border: 'none'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.7)';
                            e.currentTarget.style.transform = 'scale(1.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.5)';
                            e.currentTarget.style.transform = 'scale(1)';
                        }}
                    >
                        <X size={20} />
                    </button>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default ThreadViewWithComposer;
