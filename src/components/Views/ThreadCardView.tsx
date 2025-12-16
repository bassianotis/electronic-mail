/**
 * ThreadCardView - Multi-modal horizontal thread viewer with full features
 * 
 * Each email in the thread is its own floating modal with:
 * - Notes and due dates
 * - Text size adjustment and reader mode
 * - Reply button that inserts composer after that email
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Reply, Edit3, Calendar, BookOpen, Check, Clock } from 'lucide-react';
import type { Email } from '../../store/mailStore';
import { CompositionPanel, type DraftEmail } from '../Compose/CompositionPanel';
import { useMail } from '../../context/MailContext';
import { ShadowContainer } from './ShadowContainer';
import { sanitizeHtml } from '../../utils/sanitize';
import { extractReaderContent } from '../../utils/emailUtils';

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

interface ThreadCardViewProps {
    email: Email;
    onClose: () => void;
}

const CARD_WIDTH = 520;
const CARD_GAP = 24;
const COMPOSER_WIDTH = 500;

// Helper to get tomorrow's date in YYYY-MM-DD format
const getTomorrow = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
};

// Helper to split email content into original and quoted parts
// Detects common reply patterns like "On ... wrote:", Gmail's gmail_quote class, etc.
const splitQuotedContent = (html: string): { original: string; quoted: string | null } => {
    if (!html) return { original: '', quoted: null };

    // Create a temporary element to parse HTML
    const div = document.createElement('div');
    div.innerHTML = html;

    // Common patterns for quoted content
    const quoteSelectors = [
        '.gmail_quote',           // Gmail
        '.gmail_extra',           // Gmail extra content
        'blockquote[type="cite"]', // Apple Mail
        '.yahoo_quoted',          // Yahoo
        '.moz-cite-prefix',       // Thunderbird
        '.OutlookMessageHeader',  // Outlook
        '#divRplyFwdMsg',         // Outlook web
        '.ms-outlook-hide-in-thread', // Outlook threads
    ];

    // Try to find quoted content by class/element
    for (const selector of quoteSelectors) {
        const quoteEl = div.querySelector(selector);
        if (quoteEl) {
            const quoted = quoteEl.outerHTML;
            quoteEl.remove();
            const original = div.innerHTML.trim();
            if (original) {
                return { original, quoted };
            }
        }
    }

    // Fallback: Look for "On ... wrote:" pattern
    const onWrotePattern = /(<div[^>]*>|<p[^>]*>|<br\s*\/?>)*On\s+.{10,100}\s+wrote:\s*(<br\s*\/?>|<\/div>|<\/p>)?/i;
    const match = html.match(onWrotePattern);
    if (match && match.index !== undefined && match.index > 50) {
        // Only split if there's meaningful content before the quote
        const original = html.substring(0, match.index).trim();
        const quoted = html.substring(match.index).trim();
        if (original && quoted) {
            return { original, quoted };
        }
    }

    // Look for "---Original Message---" pattern
    const originalMsgPattern = /(<div[^>]*>|<p[^>]*>)?-{2,}[\s]*(Original Message|Forwarded Message)[\s]*-{2,}/i;
    const origMatch = html.match(originalMsgPattern);
    if (origMatch && origMatch.index !== undefined && origMatch.index > 50) {
        const original = html.substring(0, origMatch.index).trim();
        const quoted = html.substring(origMatch.index).trim();
        if (original && quoted) {
            return { original, quoted };
        }
    }

    // No quoted content detected
    return { original: html, quoted: null };
};

export const ThreadCardView: React.FC<ThreadCardViewProps> = ({
    email,
    onClose
}) => {
    const { loadEmailBody, markAsRead, updateEmail } = useMail();
    const [threadEmails, setThreadEmails] = useState<ThreadEmail[]>([]);
    const [isLoadingThread, setIsLoadingThread] = useState(true);
    const [emailBodies, setEmailBodies] = useState<Map<string, string>>(new Map());
    // replyAfterIndex: index of email after which to insert composer, or -1 if not replying
    const [replyAfterIndex, setReplyAfterIndex] = useState<number>(-1);
    const [scrollPosition, setScrollPosition] = useState(0);
    const scrollBarRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Reading settings (shared across cards)
    const [zoomLevel, setZoomLevel] = useState(1.0);
    const [readerMode, setReaderMode] = useState(false);

    // Track which emails have their quoted content expanded
    const [expandedQuotes, setExpandedQuotes] = useState<Set<string>>(new Set());

    // Note editing state per card
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [noteValue, setNoteValue] = useState('');
    // Notes stored per email (keyed by messageId)
    const [emailNotes, setEmailNotes] = useState<Map<string, string>>(new Map());

    // Due date editing state per card
    const [editingDateId, setEditingDateId] = useState<string | null>(null);
    const [dateValue, setDateValue] = useState('');
    // Due dates stored per email (keyed by messageId)
    const [emailDates, setEmailDates] = useState<Map<string, string>>(new Map());

    // User display name for sent emails
    const [userDisplayName, setUserDisplayName] = useState<string>('You');

    // Mark email as read
    useEffect(() => {
        if (email && email.uid) {
            markAsRead(email.id, email.uid);
        } else if (email) {
            markAsRead(email.id);
        }
    }, [email?.id]);

    // Fetch user display name for sent emails
    useEffect(() => {
        const fetchUserDisplayName = async () => {
            try {
                const response = await fetch('/api/setup/sync-settings', { credentials: 'include' });
                if (response.ok) {
                    const data = await response.json();
                    if (data.displayName) {
                        setUserDisplayName(data.displayName);
                    }
                }
            } catch (err) {
                console.log('Could not fetch display name, using default');
            }
        };
        fetchUserDisplayName();
    }, []);

    // Initialize with the current email and fetch thread
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
        setIsLoadingThread(false);

        if (email.body && email.body !== '<p>Loading body...</p>') {
            setEmailBodies(new Map([[initialEmail.messageId, email.body]]));
        }

        // Pre-populate note if exists
        if (email.note) {
            setEmailNotes(new Map([[initialEmail.messageId, email.note]]));
        }

        // Pre-populate due date if exists
        if (email.dueDate) {
            const dueDateStr = email.dueDate instanceof Date
                ? email.dueDate.toISOString().split('T')[0]
                : new Date(email.dueDate).toISOString().split('T')[0];
            setEmailDates(new Map([[initialEmail.messageId, dueDateStr]]));
        }

        const fetchThreadEmails = async () => {
            try {
                const threadId = email.threadId || email.messageId || email.id;
                const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/emails`, {
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.emails && data.emails.length > 0) {
                        setThreadEmails(data.emails);

                        // Pre-populate bodies, notes, and dates from API response
                        const newBodies = new Map(emailBodies);
                        const newNotes = new Map<string, string>();
                        const newDates = new Map<string, string>();

                        data.emails.forEach((e: ThreadEmail) => {
                            if (e.bodyHtml) {
                                newBodies.set(e.messageId, e.bodyHtml);
                            }
                            if (e.note) {
                                newNotes.set(e.messageId, e.note);
                            }
                            if (e.dueDate) {
                                // Handle both Date objects and strings
                                const dateStr = typeof e.dueDate === 'string'
                                    ? e.dueDate.split('T')[0]
                                    : new Date(e.dueDate).toISOString().split('T')[0];
                                newDates.set(e.messageId, dateStr);
                            }
                        });

                        setEmailBodies(newBodies);
                        setEmailNotes(prev => new Map([...prev, ...newNotes]));
                        setEmailDates(prev => new Map([...prev, ...newDates]));
                        setScrollPosition(Math.max(0, data.emails.length - 2));
                    }
                }
            } catch (err) {
                console.log('Thread API not available, using single email view');
            }
        };

        fetchThreadEmails();
    }, [email]);

    // Load bodies for all emails
    useEffect(() => {
        const loadAllBodies = async () => {
            for (const e of threadEmails) {
                if (!emailBodies.has(e.messageId)) {
                    if (e.bodyHtml) {
                        setEmailBodies(prev => new Map(prev).set(e.messageId, e.bodyHtml!));
                    } else if (e.uid) {
                        try {
                            const body = await loadEmailBody(e.messageId, e.uid);
                            if (body?.html) {
                                setEmailBodies(prev => new Map(prev).set(e.messageId, body.html));
                            }
                        } catch (err) {
                            console.error(`Error loading body for ${e.messageId}:`, err);
                        }
                    }
                }
            }
        };

        if (threadEmails.length > 0) {
            loadAllBodies();
        }
    }, [threadEmails, emailBodies, loadEmailBody]);

    // Build display order: emails interleaved with composer if replying
    const displayItems: Array<{ type: 'email' | 'composer'; index: number; email?: ThreadEmail }> = [];
    threadEmails.forEach((e, idx) => {
        displayItems.push({ type: 'email', index: idx, email: e });
        if (replyAfterIndex === idx) {
            displayItems.push({ type: 'composer', index: idx });
        }
    });

    const totalCards = displayItems.length;

    // Calculate how many email slots are visible (excluding composer)
    // In reply mode: 1 email slot + composer
    // In normal mode with small threads: all emails visible
    // In normal mode with large threads: 2 email slots visible
    const emailOnlyItems = displayItems.filter(item => item.type === 'email').length;
    const visibleSlots = replyAfterIndex >= 0 ? 1 : Math.min(emailOnlyItems, 2);

    // maxScroll: when at max, the last email should be at the rightmost visible position
    // scrollPosition 0 = first email at left
    // scrollPosition maxScroll = last email at right visible slot
    const maxScroll = Math.max(0, emailOnlyItems - visibleSlots);

    // Scroll bar handling
    const handleScrollBarMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        handleScrollBarDrag(e);
    };

    const handleScrollBarDrag = (e: React.MouseEvent | MouseEvent) => {
        if (scrollBarRef.current) {
            const rect = scrollBarRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const progress = Math.max(0, Math.min(1, x / rect.width));
            setScrollPosition(progress * maxScroll);
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) handleScrollBarDrag(e);
        };
        const handleMouseUp = () => setIsDragging(false);

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, maxScroll]);

    // Touchpad/mouse wheel scrolling - ONLY for horizontal scrolling
    const handleWheel = (e: WheelEvent) => {
        // Only capture horizontal scroll (deltaX) for card navigation
        // Let vertical scroll (deltaY) pass through for email body scrolling
        const isHorizontalScroll = Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 5;

        if (isHorizontalScroll) {
            e.preventDefault();
            // Convert pixel delta to scroll position delta
            // Adjust sensitivity: ~200px scroll = 1 card position
            const scrollDelta = e.deltaX / 200;
            setScrollPosition(prev => Math.max(0, Math.min(maxScroll, prev + scrollDelta)));
        }
        // Vertical scroll passes through to email body
    };

    // Attach wheel listener to the container
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            container.addEventListener('wheel', handleWheel, { passive: false });
            return () => container.removeEventListener('wheel', handleWheel);
        }
    }, [maxScroll]);

    // Scroll to composer when replying, snap to latest when closing draft
    useEffect(() => {
        if (replyAfterIndex >= 0) {
            // Entering reply mode: position replied-to email at position 0 (left of composer)
            const repliedEmailDisplayIdx = displayItems.findIndex(
                item => item.type === 'email' && item.index === replyAfterIndex
            );
            if (repliedEmailDisplayIdx >= 0) {
                setScrollPosition(repliedEmailDisplayIdx);
            }
        } else {
            // Exiting reply mode: snap to latest email on the right
            // maxScroll puts the newest email at the rightmost visible position
            const normalMaxScroll = Math.max(0, emailOnlyItems - Math.min(emailOnlyItems, 2));
            setScrollPosition(normalMaxScroll);
        }
    }, [replyAfterIndex]);

    const handleSend = async (draft: DraftEmail) => {
        console.log('Sending email:', draft);
        await new Promise(resolve => setTimeout(resolve, 500));
        alert('Email sent! (This is a stub - email was not actually sent)');
        setReplyAfterIndex(-1);
    };

    const handleDiscard = () => {
        setReplyAfterIndex(-1);
    };

    const handleSaveNote = (messageId: string) => {
        // If note is empty or just whitespace, clear it
        const trimmedNote = noteValue.trim();
        const noteToSave = trimmedNote || null;
        updateEmail(messageId, { note: noteToSave as any, messageId });

        // Use empty string '' to indicate explicitly cleared (vs undefined = not set)
        setEmailNotes(prev => new Map(prev).set(messageId, trimmedNote || ''));

        // Also update threadEmails state for immediate UI feedback
        setThreadEmails(prev => prev.map(e =>
            e.messageId === messageId ? { ...e, note: trimmedNote || undefined } : e
        ));

        setEditingNoteId(null);
    };

    const handleStartEditNote = (messageId: string, existingNote?: string) => {
        setNoteValue(existingNote || '');
        setEditingNoteId(messageId);
    };

    const handleSaveDate = (messageId: string) => {
        updateEmail(messageId, {
            dueDate: dateValue ? new Date(dateValue + 'T12:00:00') : null as any,
            messageId
        });
        setEmailDates(prev => new Map(prev).set(messageId, dateValue));
        setEditingDateId(null);
    };

    // Determine how many cards to show based on thread size and mode
    const emailCount = threadEmails.length;
    const isReplying = replyAfterIndex >= 0;

    // Calculate total visible width for centering
    const getVisibleWidth = () => {
        if (isReplying) {
            // Show replied-to email + composer
            return CARD_WIDTH + CARD_GAP + COMPOSER_WIDTH;
        } else if (emailCount === 1) {
            return CARD_WIDTH;
        } else {
            // Show up to 2 emails side by side
            const visibleCount = Math.min(emailCount, 2);
            return (visibleCount * CARD_WIDTH) + ((visibleCount - 1) * CARD_GAP);
        }
    };

    // Calculate card positions - adaptive based on thread size and reply mode
    const getCardStyle = (displayIndex: number, itemType: 'email' | 'composer') => {
        if (isReplying) {
            // In reply mode with scrolling support
            // Composer stays fixed at right position, emails scroll behind it

            if (itemType === 'composer') {
                // Composer stays fixed at right side with elevated shadow
                return {
                    x: CARD_WIDTH + CARD_GAP,
                    zIndex: 200, // Higher z-index so emails go behind it
                    opacity: 1,
                    scale: 1
                };
            } else {
                // Emails scroll based on scrollPosition
                const offset = displayIndex - scrollPosition;
                const baseX = offset * (CARD_WIDTH + CARD_GAP);

                // The replied-to email sits at position 0 (baseX = 0)
                // Emails to the LEFT (baseX < 0) are older emails - keep fully visible
                // Emails to the RIGHT (baseX > 0) have scrolled past - apply fade/scale

                let scale = 1;
                let opacity = 1;

                // Only apply fade/scale to emails that have moved RIGHT of position 0
                // These are emails that have "scrolled past" the replied-to email
                if (baseX > 0) {
                    // Email is to the right of the replied-to position
                    // Calculate how close it is to the composer
                    const composerLeftEdge = CARD_WIDTH + CARD_GAP;
                    const emailLeftEdge = baseX;

                    // Distance from email's left edge to composer's left edge
                    const distanceToComposer = composerLeftEdge - emailLeftEdge;

                    if (distanceToComposer <= 0) {
                        // Email has reached or passed the composer - hide it
                        opacity = 0;
                        scale = 0.9;
                    } else if (distanceToComposer < CARD_WIDTH) {
                        // Email is in the transition zone (moving towards composer)
                        const proximity = 1 - (distanceToComposer / CARD_WIDTH);
                        scale = 1 - (proximity * 0.1); // Scale down to 0.9
                        opacity = 1 - (proximity * 0.5); // Dim to 0.5
                    }
                }

                // Hide emails too far to the left
                if (offset < -2.5) {
                    opacity = 0;
                }

                return {
                    x: baseX,
                    zIndex: 100 + displayIndex, // Lower than composer
                    opacity,
                    scale
                };
            }
        } else {
            // Normal viewing mode
            if (emailCount <= 2) {
                // Small thread: show all emails, no scrolling needed
                // Position from left edge of container
                const baseX = displayIndex * (CARD_WIDTH + CARD_GAP);
                return {
                    x: baseX,
                    zIndex: 100 + displayIndex,
                    opacity: 1,
                    scale: 1
                };
            } else {
                // Larger thread: scroll-based positioning
                // Start showing the latest 2 emails
                const offset = displayIndex - scrollPosition;
                const baseX = offset * (CARD_WIDTH + CARD_GAP);
                return {
                    x: baseX,
                    zIndex: 100 + displayIndex,
                    opacity: Math.abs(offset) > 2.5 ? 0 : 1,
                    scale: 1
                };
            }
        }
    };

    const scrollProgressPercent = maxScroll > 0 ? (scrollPosition / maxScroll) * 100 : 0;

    // Calculate container left offset - center visible cards
    const getContainerStyle = () => {
        const visibleWidth = getVisibleWidth();
        return {
            left: `calc(50% - ${visibleWidth / 2}px)`,
            marginLeft: 0
        };
    };

    const containerStyle = getContainerStyle();

    return (
        <AnimatePresence>
            <div
                ref={containerRef}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 200,
                    pointerEvents: 'none'
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
                        backgroundColor: readerMode ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.3)',
                        backdropFilter: 'blur(4px)',
                        pointerEvents: 'auto'
                    }}
                />

                {/* Floating Navigation Bar */}
                <div style={{
                    position: 'absolute',
                    top: '20px',
                    left: 0,
                    right: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    zIndex: 500,
                    pointerEvents: 'none'
                }}>
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                            backgroundColor: 'rgba(255,255,255,0.95)',
                            backdropFilter: 'blur(10px)',
                            borderRadius: 'var(--radius-full)',
                            padding: '10px 20px',
                            boxShadow: 'var(--shadow-floating)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-md)',
                            pointerEvents: 'auto'
                        }}
                    >
                        {/* Subject */}
                        <div style={{
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 600,
                            color: 'var(--color-text-main)',
                            maxWidth: '180px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}>
                            {email.subject}
                        </div>

                        <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--color-border)' }} />

                        {/* Scroll Bar */}
                        {totalCards > 1 && (
                            <div
                                ref={scrollBarRef}
                                onMouseDown={handleScrollBarMouseDown}
                                style={{
                                    width: '160px',
                                    height: '6px',
                                    backgroundColor: 'var(--color-border)',
                                    borderRadius: '3px',
                                    cursor: 'pointer',
                                    position: 'relative'
                                }}
                            >
                                <div
                                    style={{
                                        position: 'absolute',
                                        left: `${scrollProgressPercent}%`,
                                        transform: 'translateX(-50%)',
                                        width: '20px',
                                        height: '100%',
                                        backgroundColor: isDragging ? 'var(--color-accent-secondary)' : 'var(--color-text-muted)',
                                        borderRadius: '3px',
                                        cursor: 'grab'
                                    }}
                                />
                            </div>
                        )}

                        {/* Reading Controls */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {/* Zoom buttons */}
                            {[0.9, 1.0, 1.1, 1.2].map((z, i) => (
                                <button
                                    key={z}
                                    onClick={() => setZoomLevel(z)}
                                    style={{
                                        fontSize: 10 + i * 2,
                                        fontWeight: 600,
                                        padding: '4px 6px',
                                        backgroundColor: zoomLevel === z ? 'var(--color-bg-subtle)' : 'transparent',
                                        color: zoomLevel === z ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                                        borderRadius: '4px',
                                        border: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Aa
                                </button>
                            ))}

                            {/* Reader mode */}
                            <button
                                onClick={() => setReaderMode(!readerMode)}
                                style={{
                                    padding: '4px 8px',
                                    backgroundColor: readerMode ? 'var(--color-accent-secondary)' : 'transparent',
                                    color: readerMode ? '#fff' : 'var(--color-text-muted)',
                                    borderRadius: '4px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '11px',
                                    fontWeight: 600
                                }}
                            >
                                <BookOpen size={12} />
                            </button>
                        </div>

                        <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--color-border)' }} />

                        {/* Close */}
                        <button
                            onClick={onClose}
                            style={{
                                padding: '4px',
                                borderRadius: '50%',
                                backgroundColor: 'transparent',
                                border: 'none',
                                color: 'var(--color-text-muted)',
                                cursor: 'pointer',
                                display: 'flex'
                            }}
                        >
                            <X size={16} />
                        </button>
                    </motion.div>
                </div>

                {/* Cards Container */}
                <div style={{
                    position: 'absolute',
                    top: '80px',
                    left: containerStyle.left,
                    marginLeft: containerStyle.marginLeft,
                    height: 'calc(100vh - 120px)',
                    pointerEvents: 'none',
                    transition: 'left 0.3s ease, margin-left 0.3s ease'
                }}>
                    {isLoadingThread ? (
                        <div style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            color: '#fff',
                            fontSize: '18px'
                        }}>
                            Loading...
                        </div>
                    ) : (
                        displayItems.map((item, displayIdx) => {
                            const cardStyle = getCardStyle(displayIdx, item.type);

                            if (item.type === 'composer') {
                                return (
                                    <motion.div
                                        key="composer"
                                        initial={{ opacity: 0, x: 100 }}
                                        animate={{ opacity: cardStyle.opacity, x: cardStyle.x }}
                                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: `${CARD_WIDTH}px`,
                                            height: '100%',
                                            zIndex: cardStyle.zIndex,
                                            pointerEvents: 'auto',
                                            // Elevated shadow to show composer floats above emails
                                            filter: 'drop-shadow(-10px 0 30px rgba(0, 0, 0, 0.15))'
                                        }}
                                    >
                                        <CompositionPanel
                                            replyTo={email}
                                            onSend={handleSend}
                                            onDiscard={handleDiscard}
                                            onClose={handleDiscard}
                                        />
                                    </motion.div>
                                );
                            }

                            const e = item.email!;
                            const body = emailBodies.get(e.messageId);
                            const isLatest = item.index === threadEmails.length - 1 && !isReplying;
                            const isSent = e.mailbox === 'Sent';
                            const isEditingNote = editingNoteId === e.messageId;
                            const isEditingDate = editingDateId === e.messageId;

                            return (
                                <motion.div
                                    key={e.messageId}
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{
                                        opacity: cardStyle.opacity,
                                        scale: cardStyle.scale || 1,
                                        x: cardStyle.x
                                    }}
                                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: `${CARD_WIDTH}px`,
                                        height: '100%',
                                        backgroundColor: readerMode ? '#1a1a1a' : '#fff',
                                        borderRadius: 'var(--radius-lg)',
                                        boxShadow: 'var(--shadow-floating)',
                                        overflow: 'hidden',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        zIndex: cardStyle.zIndex,
                                        pointerEvents: 'auto',
                                        color: readerMode ? '#e0e0e0' : 'inherit'
                                    }}
                                >
                                    {/* Card Header */}
                                    <div style={{
                                        padding: 'var(--space-md) var(--space-lg)',
                                        borderBottom: readerMode ? '1px solid #333' : '1px solid var(--color-border)',
                                        backgroundColor: isSent
                                            ? (readerMode ? 'rgba(46, 204, 113, 0.1)' : 'rgba(46, 204, 113, 0.05)')
                                            : (readerMode ? '#222' : 'var(--color-bg-subtle)'),
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start'
                                    }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 'var(--space-sm)',
                                                marginBottom: '4px'
                                            }}>
                                                <span style={{
                                                    fontWeight: 600,
                                                    color: readerMode ? '#e0e0e0' : 'var(--color-text-main)',
                                                    fontSize: 'var(--font-size-sm)'
                                                }}>
                                                    {isSent ? userDisplayName : e.sender}
                                                </span>
                                                {isSent && (
                                                    <span style={{
                                                        backgroundColor: '#2ecc71',
                                                        color: '#fff',
                                                        fontSize: '10px',
                                                        padding: '2px 6px',
                                                        borderRadius: 'var(--radius-full)',
                                                        fontWeight: 600
                                                    }}>
                                                        Sent
                                                    </span>
                                                )}
                                                {isLatest && (
                                                    <span style={{
                                                        backgroundColor: 'var(--color-accent-secondary)',
                                                        color: '#fff',
                                                        fontSize: '10px',
                                                        padding: '2px 6px',
                                                        borderRadius: 'var(--radius-full)',
                                                        fontWeight: 600
                                                    }}>
                                                        Latest
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 'var(--space-sm)',
                                                flexWrap: 'wrap'
                                            }}>
                                                <span style={{ fontSize: '11px', color: readerMode ? '#888' : 'var(--color-text-muted)' }}>
                                                    {new Date(e.date).toLocaleString()}
                                                </span>

                                                {/* Due date badge - only show if date exists and not explicitly cleared */}
                                                {(() => {
                                                    // If explicitly set/cleared in map, use that; otherwise fall back to e.dueDate
                                                    const dateVal = emailDates.has(e.messageId)
                                                        ? emailDates.get(e.messageId)
                                                        : e.dueDate;
                                                    if (!dateVal) return null;
                                                    return (
                                                        <span style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '3px',
                                                            backgroundColor: '#fff0f6',
                                                            color: '#c02d78',
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            fontSize: '10px',
                                                            fontWeight: 600
                                                        }}>
                                                            <Clock size={10} />
                                                            Due {new Date(dateVal + 'T12:00:00').toLocaleDateString()}
                                                        </span>
                                                    );
                                                })()}

                                                {/* Note indicator - only show if note exists and not explicitly cleared */}
                                                {(() => {
                                                    // If explicitly set/cleared in map, use that; otherwise fall back to e.note
                                                    const noteVal = emailNotes.has(e.messageId)
                                                        ? emailNotes.get(e.messageId)
                                                        : e.note;
                                                    if (!noteVal) return null;
                                                    return (
                                                        <span style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '3px',
                                                            backgroundColor: '#fff9db',
                                                            color: '#e67e22',
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            fontSize: '10px',
                                                            fontWeight: 600
                                                        }}>
                                                            <Edit3 size={10} />
                                                            Note
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                        </div>

                                        {/* Header Actions */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            {/* Note button */}
                                            <button
                                                onClick={() => handleStartEditNote(e.messageId, emailNotes.get(e.messageId) || e.note)}
                                                style={{
                                                    padding: '4px',
                                                    borderRadius: '4px',
                                                    backgroundColor: (emailNotes.get(e.messageId) || e.note) ? '#fff9db' : 'transparent',
                                                    border: 'none',
                                                    color: readerMode ? '#888' : 'var(--color-text-muted)',
                                                    cursor: 'pointer'
                                                }}
                                                title={emailNotes.get(e.messageId) || e.note ? "Edit note" : "Add note"}
                                            >
                                                <Edit3 size={14} />
                                            </button>

                                            {/* Due date button */}
                                            <button
                                                onClick={() => {
                                                    const existingDate = emailDates.get(e.messageId) || e.dueDate;
                                                    setEditingDateId(e.messageId);
                                                    // Default to tomorrow if no existing date
                                                    setDateValue(existingDate || getTomorrow());
                                                }}
                                                style={{
                                                    padding: '4px',
                                                    borderRadius: '4px',
                                                    backgroundColor: (emailDates.get(e.messageId) || e.dueDate) ? '#fff0f6' : 'transparent',
                                                    border: 'none',
                                                    color: (emailDates.get(e.messageId) || e.dueDate) ? '#c02d78' : (readerMode ? '#888' : 'var(--color-text-muted)'),
                                                    cursor: 'pointer'
                                                }}
                                                title={emailDates.get(e.messageId) || e.dueDate ? "Edit due date" : "Set due date"}
                                            >
                                                <Calendar size={14} />
                                            </button>

                                            {/* Reply button */}
                                            {email.bucketId && email.bucketId !== 'inbox' && (
                                                <button
                                                    onClick={() => setReplyAfterIndex(item.index)}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        padding: '4px 10px',
                                                        borderRadius: 'var(--radius-full)',
                                                        backgroundColor: 'var(--color-accent-secondary)',
                                                        border: 'none',
                                                        color: '#fff',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <Reply size={12} />
                                                    Reply
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Display existing note (when not editing) */}
                                    {(() => {
                                        if (readerMode || isEditingNote) return null;
                                        // If explicitly set/cleared in map, use that; otherwise fall back to e.note
                                        const noteVal = emailNotes.has(e.messageId)
                                            ? emailNotes.get(e.messageId)
                                            : e.note;
                                        if (!noteVal) return null;
                                        return (
                                            <div
                                                onClick={() => handleStartEditNote(e.messageId, noteVal)}
                                                style={{
                                                    padding: 'var(--space-sm) var(--space-lg)',
                                                    backgroundColor: '#fff9db',
                                                    cursor: 'pointer',
                                                    borderBottom: '1px solid #f0e6b8'
                                                }}
                                                onMouseEnter={(ev) => ev.currentTarget.style.backgroundColor = '#fff4c4'}
                                                onMouseLeave={(ev) => ev.currentTarget.style.backgroundColor = '#fff9db'}
                                            >
                                                <p style={{
                                                    fontSize: '12px',
                                                    color: '#5e4e3e',
                                                    whiteSpace: 'pre-wrap',
                                                    margin: 0
                                                }}>
                                                    {noteVal}
                                                </p>
                                            </div>
                                        );
                                    })()}

                                    {/* Note Editor */}
                                    {isEditingNote && (
                                        <div style={{
                                            padding: 'var(--space-sm) var(--space-lg)',
                                            backgroundColor: '#fff9db',
                                            borderBottom: '1px solid #f0e6b8'
                                        }}>
                                            <textarea
                                                value={noteValue}
                                                onChange={(ev) => setNoteValue(ev.target.value)}
                                                placeholder="Add a note..."
                                                style={{
                                                    width: '100%',
                                                    minHeight: '60px',
                                                    border: 'none',
                                                    backgroundColor: 'transparent',
                                                    resize: 'none',
                                                    outline: 'none',
                                                    fontSize: '13px'
                                                }}
                                                autoFocus
                                            />
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                                <button
                                                    onClick={() => setEditingNoteId(null)}
                                                    style={{
                                                        padding: '4px 10px',
                                                        fontSize: '11px',
                                                        backgroundColor: '#f5f5f5',
                                                        border: '1px solid #ddd',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={() => handleSaveNote(e.messageId)}
                                                    style={{
                                                        padding: '4px 10px',
                                                        fontSize: '11px',
                                                        backgroundColor: 'var(--color-accent-secondary)',
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}
                                                >
                                                    <Check size={12} /> Save
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Due Date Editor */}
                                    {isEditingDate && (
                                        <div style={{
                                            padding: 'var(--space-sm) var(--space-lg)',
                                            backgroundColor: '#e8f4fd',
                                            borderBottom: '1px solid #c8dff0',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <Calendar size={14} />
                                            <input
                                                type="date"
                                                value={dateValue}
                                                onChange={(ev) => setDateValue(ev.target.value)}
                                                style={{
                                                    flex: 1,
                                                    padding: '6px',
                                                    border: '1px solid #ddd',
                                                    borderRadius: '4px',
                                                    fontSize: '13px'
                                                }}
                                            />
                                            <button
                                                onClick={() => {
                                                    // Clear the date
                                                    updateEmail(e.messageId, { dueDate: null as any, messageId: e.messageId });

                                                    // Use empty string '' to indicate explicitly cleared
                                                    setEmailDates(prev => new Map(prev).set(e.messageId, ''));

                                                    // Also update threadEmails state for immediate UI feedback
                                                    setThreadEmails(prev => prev.map(te =>
                                                        te.messageId === e.messageId ? { ...te, dueDate: undefined } : te
                                                    ));

                                                    setEditingDateId(null);
                                                }}
                                                style={{
                                                    padding: '4px 10px',
                                                    fontSize: '11px',
                                                    backgroundColor: '#fee2e2',
                                                    border: '1px solid #fecaca',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    color: '#dc2626'
                                                }}
                                            >
                                                Clear
                                            </button>
                                            <button
                                                onClick={() => handleSaveDate(e.messageId)}
                                                style={{
                                                    padding: '4px 10px',
                                                    fontSize: '11px',
                                                    backgroundColor: 'var(--color-accent-secondary)',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    )}

                                    {/* Card Body */}
                                    <div style={{
                                        flex: 1,
                                        overflowY: 'auto',
                                        padding: readerMode ? '24px 32px' : 'var(--space-lg)'
                                    }}>
                                        {body ? (
                                            readerMode ? (
                                                // Reader mode: Use extractReaderContent for clean, clutter-free reading
                                                <div
                                                    className="reader-content"
                                                    style={{
                                                        fontSize: `${18 * zoomLevel}px`,
                                                        lineHeight: '1.7',
                                                        color: '#e0e0e0',
                                                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                                                        maxWidth: '650px',
                                                        margin: '0 auto'
                                                    }}
                                                    dangerouslySetInnerHTML={{ __html: extractReaderContent(body) }}
                                                />
                                            ) : (() => {
                                                // Normal mode: Split quoted content and show original only
                                                const { original, quoted } = splitQuotedContent(body);
                                                const isExpanded = expandedQuotes.has(e.messageId);

                                                const toggleExpanded = () => {
                                                    setExpandedQuotes(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(e.messageId)) {
                                                            next.delete(e.messageId);
                                                        } else {
                                                            next.add(e.messageId);
                                                        }
                                                        return next;
                                                    });
                                                };

                                                return (
                                                    <ShadowContainer>
                                                        <div
                                                            className="email-body-content"
                                                            style={{
                                                                fontSize: `${14 * zoomLevel}px`,
                                                                lineHeight: '1.6',
                                                                color: '#333',
                                                                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
                                                            }}
                                                        >
                                                            {/* Original content */}
                                                            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(original) }} />

                                                            {/* Quoted content with expand button */}
                                                            {quoted && (
                                                                <>
                                                                    <button
                                                                        onClick={toggleExpanded}
                                                                        style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px',
                                                                            padding: '6px 10px',
                                                                            margin: '12px 0',
                                                                            backgroundColor: '#f5f5f5',
                                                                            border: '1px solid #e0e0e0',
                                                                            borderRadius: '4px',
                                                                            cursor: 'pointer',
                                                                            fontSize: '12px',
                                                                            color: '#666',
                                                                            fontWeight: 500
                                                                        }}
                                                                    >
                                                                        <span style={{ fontSize: '14px' }}>
                                                                            {isExpanded ? '▼' : '•••'}
                                                                        </span>
                                                                        {isExpanded ? 'Hide previous messages' : 'Show previous messages'}
                                                                    </button>

                                                                    {isExpanded && (
                                                                        <div
                                                                            style={{
                                                                                borderLeft: '3px solid #e0e0e0',
                                                                                paddingLeft: '12px',
                                                                                opacity: 0.8
                                                                            }}
                                                                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(quoted) }}
                                                                        />
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </ShadowContainer>
                                                );
                                            })()
                                        ) : (
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                height: '100%',
                                                color: readerMode ? '#888' : 'var(--color-text-muted)'
                                            }}>
                                                Loading...
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })
                    )}
                </div>
            </div>
        </AnimatePresence>
    );
};

export default ThreadCardView;
