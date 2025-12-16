/**
 * ThreadViewWithComposer - Side-by-side email + composition view
 * 
 * Displays the email thread on the left and composition panel on the right.
 * For multi-email threads, allows horizontal scrolling through past emails.
 * Overlays the bucket gallery similar to EmailOverlay.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Email } from '../../store/mailStore';
import { CompositionPanel, type DraftEmail } from './CompositionPanel';
import { useMail } from '../../context/MailContext';
import { ShadowContainer } from '../Views/ShadowContainer';
import { sanitizeHtml } from '../../utils/sanitize';

interface ThreadEmail {
    messageId: string;
    uid?: number;
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
    const [currentEmailIndex, setCurrentEmailIndex] = useState(0);
    const [emailBodies, setEmailBodies] = useState<Map<string, string>>(new Map());
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Fetch all emails in the thread
    useEffect(() => {
        const fetchThreadEmails = async () => {
            setIsLoadingThread(true);
            try {
                const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/emails`, {
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    setThreadEmails(data.emails || []);
                    // Set current email to the one being replied to
                    const replyIndex = data.emails.findIndex(
                        (e: ThreadEmail) => e.messageId === replyToEmail.messageId || e.messageId === replyToEmail.id
                    );
                    setCurrentEmailIndex(replyIndex >= 0 ? replyIndex : data.emails.length - 1);
                }
            } catch (err) {
                console.error('Error fetching thread emails:', err);
            } finally {
                setIsLoadingThread(false);
            }
        };

        fetchThreadEmails();
    }, [threadId, replyToEmail.messageId, replyToEmail.id]);

    // Load email body for visible emails
    useEffect(() => {
        const loadVisibleBodies = async () => {
            // Load current email and neighbors
            const indicesToLoad = [currentEmailIndex - 1, currentEmailIndex, currentEmailIndex + 1]
                .filter(i => i >= 0 && i < threadEmails.length);

            for (const idx of indicesToLoad) {
                const email = threadEmails[idx];
                if (email && !emailBodies.has(email.messageId)) {
                    if (email.bodyHtml) {
                        // Already have body from thread fetch
                        setEmailBodies(prev => new Map(prev).set(email.messageId, email.bodyHtml!));
                    } else {
                        // Need to fetch body
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
            loadVisibleBodies();
        }
    }, [threadEmails, currentEmailIndex, emailBodies, loadEmailBody]);

    const handleSend = async (draft: DraftEmail) => {
        // For now, just log and show success (stub implementation)
        console.log('Sending email:', draft);

        // Simulate send delay
        await new Promise(resolve => setTimeout(resolve, 500));

        // Show toast or notification would go here
        alert('Email sent! (This is a stub - email was not actually sent)');

        if (onSent) {
            onSent(draft);
        }
        onClose();
    };

    const handleDiscard = () => {
        onClose();
    };

    const handlePrevEmail = () => {
        if (currentEmailIndex > 0) {
            setCurrentEmailIndex(prev => prev - 1);
        }
    };

    const handleNextEmail = () => {
        if (currentEmailIndex < threadEmails.length - 1) {
            setCurrentEmailIndex(prev => prev + 1);
        }
    };

    const currentEmail = threadEmails[currentEmailIndex];
    const currentBody = currentEmail ? emailBodies.get(currentEmail.messageId) : null;
    const isSingleEmail = threadEmails.length <= 1;

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
                        maxWidth: '1400px',
                        height: '90vh',
                        display: 'flex',
                        gap: 'var(--space-lg)',
                        zIndex: 201,
                        pointerEvents: 'auto'
                    }}
                >
                    {/* Email View Panel */}
                    <motion.div
                        layout
                        style={{
                            flex: isSingleEmail ? 1.2 : 1,
                            height: '100%',
                            backgroundColor: '#fff',
                            borderRadius: 'var(--radius-lg)',
                            boxShadow: 'var(--shadow-floating)',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        {/* Email Header */}
                        <div style={{
                            padding: 'var(--space-md) var(--space-lg)',
                            borderBottom: '1px solid var(--color-border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            backgroundColor: 'var(--color-bg-subtle)'
                        }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h2 style={{
                                    fontSize: 'var(--font-size-lg)',
                                    fontWeight: 700,
                                    color: 'var(--color-text-main)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {currentEmail?.subject || replyToEmail.subject}
                                </h2>
                                <div style={{
                                    fontSize: 'var(--font-size-sm)',
                                    color: 'var(--color-text-muted)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-sm)'
                                }}>
                                    <span style={{ fontWeight: 600 }}>
                                        {currentEmail?.sender || replyToEmail.sender}
                                    </span>
                                    <span>•</span>
                                    <span>
                                        {currentEmail?.date
                                            ? new Date(currentEmail.date).toLocaleString()
                                            : replyToEmail.date?.toLocaleString()
                                        }
                                    </span>
                                    {currentEmail?.mailbox === 'Sent' && (
                                        <span style={{
                                            backgroundColor: 'var(--color-accent-primary)',
                                            color: '#fff',
                                            fontSize: '11px',
                                            padding: '2px 6px',
                                            borderRadius: 'var(--radius-full)',
                                            fontWeight: 600
                                        }}>
                                            Sent
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Thread Navigation */}
                            {threadEmails.length > 1 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-sm)'
                                }}>
                                    <button
                                        onClick={handlePrevEmail}
                                        disabled={currentEmailIndex === 0}
                                        style={{
                                            padding: 'var(--space-xs)',
                                            borderRadius: 'var(--radius-sm)',
                                            color: currentEmailIndex === 0 ? 'var(--color-border)' : 'var(--color-text-muted)',
                                            cursor: currentEmailIndex === 0 ? 'not-allowed' : 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                    <span style={{
                                        fontSize: 'var(--font-size-sm)',
                                        color: 'var(--color-text-muted)',
                                        minWidth: '60px',
                                        textAlign: 'center'
                                    }}>
                                        {currentEmailIndex + 1} of {threadEmails.length}
                                    </span>
                                    <button
                                        onClick={handleNextEmail}
                                        disabled={currentEmailIndex >= threadEmails.length - 1}
                                        style={{
                                            padding: 'var(--space-xs)',
                                            borderRadius: 'var(--radius-sm)',
                                            color: currentEmailIndex >= threadEmails.length - 1 ? 'var(--color-border)' : 'var(--color-text-muted)',
                                            cursor: currentEmailIndex >= threadEmails.length - 1 ? 'not-allowed' : 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <ChevronRight size={18} />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Email Body */}
                        <div
                            ref={scrollContainerRef}
                            style={{
                                flex: 1,
                                overflowY: 'auto',
                                padding: 'var(--space-lg)'
                            }}
                        >
                            {isLoadingThread ? (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '100%',
                                    color: 'var(--color-text-muted)'
                                }}>
                                    Loading thread...
                                </div>
                            ) : currentBody ? (
                                <ShadowContainer style={{ minHeight: '200px' }}>
                                    <div
                                        className="email-body-content"
                                        style={{
                                            fontSize: '16px',
                                            lineHeight: '1.6',
                                            color: '#333',
                                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
                                        }}
                                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentBody) }}
                                    />
                                </ShadowContainer>
                            ) : (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '100%',
                                    color: 'var(--color-text-muted)'
                                }}>
                                    Loading email body...
                                </div>
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
                            height: '100%'
                        }}
                    >
                        <CompositionPanel
                            replyTo={replyToEmail}
                            onSend={handleSend}
                            onDiscard={handleDiscard}
                            onClose={onClose}
                        />
                    </motion.div>

                    {/* Close button (top right of whole container) */}
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
                            zIndex: 10
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
