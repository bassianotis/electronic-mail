/**
 * LibraryCardView - Static Stack Thread View
 * 
 * Cards are stacked on top of each other (like physical cards):
 * - OLDEST at back (top of visual stack)
 * - NEWEST at front (bottom of visual stack, closest to viewer)
 * - All cards are FULL SIZE, just overlapping
 * - Click a card behind → front card tilts forward to reveal it
 * - The revealed card was "there all along" - just had something in front of it
 * 
 * Uses EmailOverlay with embedded=true for full email functionality
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Email } from '../../store/mailStore';
import { EmailOverlay } from './EmailOverlay';
import { CompositionPanel } from '../Compose/CompositionPanel';
import { useMail } from '../../context/MailContext';
import { ChevronUp, ChevronDown, Send, Reply, ReplyAll, Forward } from 'lucide-react';

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
    note?: string;
    dueDate?: string;
}

interface LibraryCardViewProps {
    email: Email;
    onClose: () => void;
}

// Layout constants - using percentage with maxWidth like archive popup
const CARD_WIDTH = '95%';
const CARD_MAX_WIDTH = 1000;
const CARD_HEIGHT = 'calc(60vh)';

export const LibraryCardView: React.FC<LibraryCardViewProps> = ({
    email,
    onClose
}) => {
    const { loadEmailBody, markAsRead } = useMail();
    const [threadEmails, setThreadEmails] = useState<ThreadEmail[]>([]);
    const [emailBodies, setEmailBodies] = useState<Map<string, string>>(new Map());
    const [selectedIndex, setSelectedIndex] = useState<number>(0); // Start with newest selected
    const [replyingToEmail, setReplyingToEmail] = useState<Email | null>(null);
    const [quickReplyText, setQuickReplyText] = useState('');
    const isComposing = !!replyingToEmail;

    // Note and due date editing state (controlled by top bar, rendered in EmailOverlay)

    // Check for existing draft on mount and auto-expand if found
    useEffect(() => {
        const checkForDraft = async () => {
            try {
                const res = await fetch(`/api/drafts/reply/${encodeURIComponent(email.id)}`);
                if (res.ok) {
                    const draft = await res.json();
                    if (draft && draft.body) {
                        // Draft exists - auto-expand the composer
                        setReplyingToEmail(email);
                    }
                }
            } catch (err) {
                // Ignore errors, just don't auto-expand
            }
        };
        checkForDraft();
    }, [email.id]);

    // Mark email as read
    useEffect(() => {
        if (email && email.uid) {
            markAsRead(email.id, email.uid);
        } else if (email) {
            markAsRead(email.id);
        }
    }, [email?.id]);


    // Keyboard navigation for thread
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Check if user is typing in an input or textarea
            const target = e.target as HTMLElement;
            const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (isTyping) return; // Allow typing in composer
            // isComposing check removed to allow browsing while composer is open

            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                // Go to older email (higher index)
                setSelectedIndex(prev => Math.min(prev + 1, threadEmails.length - 1));
                e.preventDefault();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                // Go to newer email (lower index)
                setSelectedIndex(prev => Math.max(prev - 1, 0));
                e.preventDefault();
            } else if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [threadEmails.length, isComposing, onClose]);

    // Initialize and fetch thread
    useEffect(() => {
        const initialEmail: ThreadEmail = {
            messageId: email.messageId || email.id,
            uid: email.uid,
            subject: email.subject,
            sender: email.sender,
            senderAddress: email.senderAddress,
            date: email.date?.toISOString() || new Date().toISOString(),
            bodyHtml: email.body,
            mailbox: email.bucketId ? 'INBOX' : undefined,
            note: email.note,
            dueDate: email.dueDate
                ? (email.dueDate instanceof Date
                    ? email.dueDate.toISOString().split('T')[0]
                    : new Date(email.dueDate).toISOString().split('T')[0])
                : undefined
        };

        setThreadEmails([initialEmail]);

        if (email.body && email.body !== '<p>Loading body...</p>') {
            setEmailBodies(new Map([[initialEmail.messageId, email.body]]));
        }

        // Fetch full thread
        const fetchThread = async () => {
            try {
                const threadId = email.threadId || email.messageId || email.id;
                const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/emails`, {
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.emails && data.emails.length > 0) {
                        // Sort: newest first (index 0 = newest)
                        const sorted = data.emails.sort((a: ThreadEmail, b: ThreadEmail) =>
                            new Date(b.date).getTime() - new Date(a.date).getTime()
                        );
                        setThreadEmails(sorted);

                        const newBodies = new Map(emailBodies);
                        sorted.forEach((e: ThreadEmail) => {
                            if (e.bodyHtml) newBodies.set(e.messageId, e.bodyHtml);
                        });
                        setEmailBodies(newBodies);
                    }
                }
            } catch {
                console.log('Thread API not available');
            }
        };
        fetchThread();
    }, [email]);

    // Load bodies for emails that need them
    useEffect(() => {
        const loadBodies = async () => {
            for (const e of threadEmails) {
                if (!emailBodies.has(e.messageId) && e.uid) {
                    try {
                        const body = await loadEmailBody(e.messageId, e.uid);
                        if (body?.html) {
                            setEmailBodies(prev => new Map(prev).set(e.messageId, body.html));
                        }
                    } catch {
                        // Ignore errors
                    }
                }
            }
        };
        if (threadEmails.length > 0) loadBodies();
    }, [threadEmails]);

    // Convert ThreadEmail to Email type for EmailOverlay
    const convertToEmail = (threadEmail: ThreadEmail): Email => ({
        id: threadEmail.messageId,
        messageId: threadEmail.messageId,
        uid: threadEmail.uid,
        sender: threadEmail.sender,
        senderAddress: threadEmail.senderAddress,
        subject: threadEmail.subject,
        preview: threadEmail.preview || '',
        date: new Date(threadEmail.date),
        body: emailBodies.get(threadEmail.messageId) || threadEmail.bodyHtml || '',
        note: threadEmail.note,
        dueDate: threadEmail.dueDate ? new Date(threadEmail.dueDate) : undefined,
        bucketId: email.bucketId,
        read: true
    });

    const isSentEmail = (mailbox?: string) => mailbox === 'Sent';
    const handleReply = (targetEmail?: Email) => {
        const emailToReply = targetEmail || convertToEmail(threadEmails[selectedIndex]);
        setReplyingToEmail(emailToReply);
    };

    const handleQuickReplyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const text = e.target.value;
        setQuickReplyText(text);
        if (text.length >= 30) {
            handleReply();
        }
    };

    const handleQuickReplyKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleReply();
        }
    };

    const handleQuickSend = () => {
        console.log('Sending quick reply:', quickReplyText);
        setQuickReplyText('');
        // Add actual send logic here if needed, or assume purely UI demo for now
    };

    // Cards are stacked: oldest at back (highest visual position), newest at front
    // threadEmails[0] = newest (front), threadEmails[length-1] = oldest (back)

    // Scroll chaining navigation
    const lastWheelTime = useRef(0);
    const isScrollStreamTainted = useRef(false); // If true, the current "swipe" has touched content and is disqualified from navigation

    const handleWheel = (e: React.WheelEvent) => {
        const now = Date.now();

        // 1. Stream Detection
        // If there's been a gap (e.g. >100ms), assume this is a NEW gesture/stream.
        // Reset the "tainted" flag.
        if (now > lastWheelTime.current + 100) {
            isScrollStreamTainted.current = false;
        }

        // Resetting Debounce:
        // If we are currently blocked, any new scroll event extends the block.
        // This ensures the user must STOP scrolling (momentum ends) before we trigger again.
        if (now < lastWheelTime.current) {
            lastWheelTime.current = Math.max(lastWheelTime.current, now + 40); // Extend block by 40ms (shorter silence required)
            return;
        }

        // Check if event target (or parents) is scrollable and not at edge
        let target = e.target as HTMLElement;
        let isScrollingContent = false;

        // Increased depth to ensure we find the container (e.g. shadowed/nested elements)
        for (let i = 0; i < 15; i++) {
            if (!target || target === e.currentTarget) break;

            const style = window.getComputedStyle(target);
            const overflowY = style.overflowY;
            const isScrollContainer = overflowY === 'auto' || overflowY === 'scroll';

            if (isScrollContainer && target.scrollHeight > target.clientHeight) {
                // Direction Inverted per user request:
                // Scroll DOWN (Delta > 0) -> Moving "Forward" to NEWER emails (Index - 1)
                // Scroll UP (Delta < 0) -> Moving "Backward" to OLDER emails (Index + 1)

                // If scrolling down (positive) and not at bottom
                if (e.deltaY > 0 && Math.abs(target.scrollHeight - target.clientHeight - target.scrollTop) > 2) {
                    isScrollingContent = true;
                }
                // If scrolling up (negative) and not at top
                if (e.deltaY < 0 && target.scrollTop > 0) {
                    isScrollingContent = true;
                }
            }
            if (isScrollingContent) break;
            target = target.parentElement as HTMLElement;
        }

        if (isScrollingContent) {
            // Mark this stream as tainted. It has moved content, so it should never trigger navigation.
            isScrollStreamTainted.current = true;
            lastWheelTime.current = now + 40; // Keep the debounce alive tracking this stream
            return; // Allow native scroll
        }

        // Guard: Prevent "Overflow" flips
        // If this stream is tainted (it scrolled content earlier), BLOCK navigation.
        // User must stop (break the stream) to clear the flag.
        if (isScrollStreamTainted.current) {
            return;
        }

        // Trigger Navigation (Inverted)
        if (e.deltaY > 0) {
            // Scroll DOWN -> Go Newer (Index - 1)
            if (selectedIndex > 0) {
                setSelectedIndex(prev => prev - 1);
                lastWheelTime.current = now + 250; // Triggered! Initial block 250ms (Slower pacing)
            }
        } else if (e.deltaY < 0) {
            // Scroll UP -> Go Older (Index + 1)
            if (selectedIndex < threadEmails.length - 1) {
                setSelectedIndex(prev => prev + 1);
                lastWheelTime.current = now + 250; // Triggered! Initial block 250ms (Slower pacing)
            }
        }
    };

    return (
        <AnimatePresence>
            <div
                onWheel={handleWheel}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 200,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    perspective: '1500px',
                    perspectiveOrigin: 'center 60%'
                }}
            >
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
                        backgroundColor: 'rgba(0,0,0,0.4)',
                        backdropFilter: 'blur(8px)',
                        pointerEvents: 'auto'
                    }}
                />



                {/* Card Stack - all cards same size, overlapping */}
                <div
                    style={{
                        position: 'relative',
                        width: CARD_WIDTH,
                        maxWidth: CARD_MAX_WIDTH,
                        height: CARD_HEIGHT,
                        pointerEvents: 'auto',
                        transformStyle: 'preserve-3d'
                    }}
                >
                    {/* Render from back (oldest) to front (newest) for proper z-order */}
                    {[...threadEmails].reverse().map((threadEmail, reverseIdx) => {
                        const dataIdx = threadEmails.length - 1 - reverseIdx; // Original index
                        const isSelected = selectedIndex === dataIdx;
                        const emailData = convertToEmail(threadEmail);

                        // Is this card IN FRONT of the selected one?
                        // (Lower dataIdx = newer = in front)
                        const isInFrontOfSelected = dataIdx < selectedIndex;

                        // Cards behind (older) sit HIGHER so they're visible and clickable
                        // Each card behind the selected one is offset upward
                        const distanceBehind = isSelected ? 0 :
                            (dataIdx > selectedIndex ? dataIdx - selectedIndex : 0);

                        // How many cards are in front of selected? (for stacking tilted cards)
                        const distanceInFront = isSelected ? 0 :
                            (dataIdx < selectedIndex ? selectedIndex - dataIdx : 0);

                        // Calculate transforms
                        let rotateX = 0;
                        let translateY = 0;
                        let scale = 1;
                        let opacity = 1;
                        let zIndex = 50;

                        if (isSelected) {
                            // Selected card: flat, full visibility, on top
                            zIndex = 100;
                            scale = 1;
                            opacity = 1;
                            translateY = 0;
                        } else if (isInFrontOfSelected) {
                            // Cards IN FRONT of selected: tilt forward AND slide DOWN
                            // This moves them out of the way so you can see the selected card
                            rotateX = -55;
                            scale = 0.85 - (distanceInFront * 0.03); // Shrink more for further cards
                            scale = Math.max(scale, 0.6); // Don't shrink too much
                            opacity = 0; // Hidden completely
                            // Slide DOWN - further cards go further down, stacking at bottom
                            translateY = 200 + (distanceInFront * 40); // Stack at bottom
                            translateY = Math.min(translateY, 400); // Cap for 10+ emails
                            zIndex = 200 - dataIdx;
                        } else {
                            // Cards BEHIND selected: sit HIGHER so body is visible
                            // Clamp offset for large threads
                            const clampedDistance = Math.min(distanceBehind, 5); // Max 5 cards worth of offset
                            translateY = -(clampedDistance * 40); // Move UP
                            scale = 1 - (clampedDistance * 0.015);
                            opacity = 1; // Full opacity for stacked cards
                            zIndex = 50 - distanceBehind;
                        }

                        return (
                            <motion.div
                                key={threadEmail.messageId}
                                onClick={() => setSelectedIndex(dataIdx)}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    backgroundColor: isSentEmail(threadEmail.mailbox) ? '#f8fff8' : '#fff',
                                    borderRadius: '16px',
                                    boxShadow: isSelected
                                        ? '0 25px 80px rgba(0,0,0,0.3)'
                                        : '0 8px 30px rgba(0,0,0,0.12)',
                                    overflow: 'hidden',
                                    cursor: isSelected ? 'default' : 'pointer',
                                    transformStyle: 'preserve-3d',
                                    transformOrigin: 'center bottom',
                                    backfaceVisibility: 'hidden',
                                    transform: `translateY(${translateY}px) rotateX(${rotateX}deg) scale(${scale})`,
                                    opacity: opacity,
                                    zIndex: zIndex,
                                    pointerEvents: isInFrontOfSelected ? 'none' : 'auto',
                                    transition: 'transform 0.25s ease-out, opacity 0.2s ease-out, box-shadow 0.2s ease-out'
                                }}
                            >
                                {/* Always render EmailOverlay - it was "there all along" */}
                                <EmailOverlay
                                    email={emailData}
                                    onClose={onClose}
                                    embedded={true}
                                    bucketView={true}
                                    isActive={dataIdx === selectedIndex}
                                    onReply={(e) => handleReply(e)}
                                />

                                {/* Click overlay for non-selected cards */}
                                {!isSelected && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            right: 0,
                                            bottom: 0,
                                            background: isInFrontOfSelected
                                                ? 'linear-gradient(to bottom, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%)'
                                                : 'linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, transparent 15%)',
                                            cursor: 'pointer',
                                            opacity: isInFrontOfSelected ? 0 : 1,
                                            pointerEvents: isInFrontOfSelected ? 'none' : 'auto'
                                        }}
                                    />
                                )}
                            </motion.div>
                        );
                    })}
                </div>

                {/* Unified Bottom Panel and Composer */}
                <motion.div
                    layout
                    animate={{
                        borderRadius: isComposing ? 'var(--radius-lg)' : 'var(--radius-lg)',
                        backgroundColor: isComposing ? '#fff' : 'rgba(255,255,255,0.8)'
                    }}
                    style={{
                        position: 'relative',
                        width: CARD_WIDTH,
                        maxWidth: CARD_MAX_WIDTH,
                        marginTop: '24px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                        border: '1px solid rgba(255,255,255,0.4)',
                        backdropFilter: 'blur(20px)',
                        zIndex: 300,
                        overflow: 'hidden',
                        pointerEvents: 'auto'
                    }}
                >
                    <div
                        style={{
                            padding: '12px 20px',
                            display: 'flex',
                            flexDirection: 'column',
                            width: '100%'
                        }}
                    >
                        {/* Top Row: Subject & Counter */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            width: '100%',
                            marginBottom: !replyingToEmail ? '12px' : '0'
                        }}>
                            {/* Subject */}
                            <h2 style={{
                                fontSize: 'var(--font-size-md)',
                                fontWeight: 600,
                                color: 'var(--color-text-main)',
                                margin: 0,
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {email.subject}
                            </h2>

                            {/* Thread counter with navigation */}
                            {threadEmails.length > 1 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    backgroundColor: 'var(--color-bg-subtle)',
                                    borderRadius: 'var(--radius-full)',
                                    padding: '2px 4px 2px 8px',
                                    marginLeft: 'var(--space-sm)',
                                    flexShrink: 0
                                }}>
                                    <span style={{
                                        fontSize: 'var(--font-size-sm)',
                                        color: 'var(--color-text-muted)',
                                        fontWeight: 600
                                    }}>
                                        {selectedIndex + 1}/{threadEmails.length}
                                    </span>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                        <button
                                            onClick={() => setSelectedIndex(prev => Math.min(prev + 1, threadEmails.length - 1))}
                                            disabled={selectedIndex === threadEmails.length - 1}
                                            style={{
                                                border: 'none',
                                                background: 'transparent',
                                                cursor: selectedIndex === threadEmails.length - 1 ? 'default' : 'pointer',
                                                padding: '4px',
                                                borderRadius: '50%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                color: selectedIndex === threadEmails.length - 1 ? 'var(--color-border)' : 'var(--color-text-main)',
                                                transition: 'background-color 0.2s'
                                            }}
                                            title="Older"
                                            onMouseEnter={(e) => {
                                                if (selectedIndex !== threadEmails.length - 1) e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            <ChevronUp size={14} />
                                        </button>
                                        <button
                                            onClick={() => setSelectedIndex(prev => Math.max(0, prev - 1))}
                                            disabled={selectedIndex === 0}
                                            style={{
                                                border: 'none',
                                                background: 'transparent',
                                                cursor: selectedIndex === 0 ? 'default' : 'pointer',
                                                padding: '4px',
                                                borderRadius: '50%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                color: selectedIndex === 0 ? 'var(--color-border)' : 'var(--color-text-main)',
                                                transition: 'background-color 0.2s'
                                            }}
                                            title="Newer"
                                            onMouseEnter={(e) => {
                                                if (selectedIndex !== 0) e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            <ChevronDown size={14} />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Persistent Action Icons */}
                            <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto', paddingLeft: '12px' }}>
                                <button
                                    onClick={() => handleReply()}
                                    title="Reply"
                                    style={{
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                        padding: '6px',
                                        borderRadius: '50%',
                                        color: 'var(--color-text-muted)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        transition: 'background-color 0.2s',
                                        backgroundColor: replyingToEmail ? 'var(--color-bg-subtle)' : 'transparent'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = replyingToEmail ? 'var(--color-bg-subtle)' : 'transparent'}
                                >
                                    <Reply size={16} />
                                </button>
                                <button
                                    title="Reply All"
                                    onClick={() => handleReply()}
                                    style={{
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                        padding: '6px',
                                        borderRadius: '50%',
                                        color: 'var(--color-text-muted)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        transition: 'background-color 0.2s'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <ReplyAll size={16} />
                                </button>
                                <button
                                    title="Forward"
                                    onClick={() => handleReply()}
                                    style={{
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                        padding: '6px',
                                        borderRadius: '50%',
                                        color: 'var(--color-text-muted)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        transition: 'background-color 0.2s'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <Forward size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Bottom Row: Quick Reply Field */}
                        {!replyingToEmail ? (
                            <motion.div
                                layoutId="composer"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    backgroundColor: 'var(--color-bg-subtle)',
                                    borderRadius: '12px',
                                    padding: '8px 12px',
                                    width: '100%'
                                }}
                            >
                                <input
                                    type="text"
                                    value={quickReplyText}
                                    onChange={handleQuickReplyChange}
                                    onKeyDown={handleQuickReplyKeyDown}
                                    placeholder="Reply..."
                                    style={{
                                        border: 'none',
                                        background: 'transparent',
                                        outline: 'none',
                                        fontSize: 'var(--font-size-md)',
                                        width: '100%',
                                        color: 'var(--color-text-main)'
                                    }}
                                />
                                {quickReplyText.length > 0 && (
                                    <button
                                        onClick={handleQuickSend}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '50%',
                                            backgroundColor: 'var(--color-accent-secondary)',
                                            color: '#fff',
                                            border: 'none',
                                            cursor: 'pointer',
                                            marginLeft: '8px'
                                        }}
                                    >
                                        <Send size={14} />
                                    </button>
                                )}
                            </motion.div>
                        ) : null}
                    </div>

                    {replyingToEmail && (
                        <motion.div
                            layoutId="composer"
                            initial={{ height: 40, opacity: 0 }}
                            animate={{ height: 280, opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                            style={{
                                width: '100%',
                                overflow: 'hidden',
                                backgroundColor: '#fff', // Ensure background for layout
                                borderRadius: 'var(--radius-lg)',
                                boxShadow: 'var(--shadow-floating)'
                            }}
                        >
                            <CompositionPanel
                                replyTo={replyingToEmail}
                                initialBody={quickReplyText}
                                onSend={() => {
                                    console.log('Sending reply');
                                    setReplyingToEmail(null);
                                }}
                                onDiscard={() => {
                                    setReplyingToEmail(null);
                                    setQuickReplyText('');
                                }}
                            />
                        </motion.div>
                    )}
                </motion.div>


            </div>
        </AnimatePresence >
    );
};
