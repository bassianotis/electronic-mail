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
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
    const convertToEmail = useCallback((threadEmail: ThreadEmail): Email => ({
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
    }), [emailBodies, email.bucketId]);

    const isSentEmail = useCallback((mailbox?: string) => mailbox === 'Sent', []);
    const handleReply = useCallback((targetEmail?: Email) => {
        let emailToReply = targetEmail || convertToEmail(threadEmails[selectedIndex]);

        // If replying to a sent email (empty senderAddress), use the first non-sent email in thread
        if (!emailToReply.senderAddress || isSentEmail(threadEmails[selectedIndex]?.mailbox)) {
            const originalEmail = threadEmails.find(e => e.mailbox !== 'Sent' && e.senderAddress);
            if (originalEmail) {
                // Use the original email's sender as the reply recipient, but keep subject from current
                emailToReply = {
                    ...convertToEmail(originalEmail),
                    subject: emailToReply.subject // Keep the current subject
                };
            }
        }

        setReplyingToEmail(emailToReply);
    }, [threadEmails, selectedIndex, convertToEmail, isSentEmail]);

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

    // Check for existing draft once thread is loaded
    // This handles cases where we reply to a Sent email, but the draft is actually keyed to the original message
    const hasCheckedDraft = useRef(false);

    useEffect(() => {
        const checkForDraft = async () => {
            if (threadEmails.length === 0 || hasCheckedDraft.current) return;

            try {
                // 1. Candidate A: The current email (default)
                const currentEmail = threadEmails[0]; // Newest
                if (!currentEmail?.messageId) return;

                let candidates = [currentEmail];

                // 2. Candidate B: The logical reply target (if current is Sent)
                if (isSentEmail(currentEmail.mailbox)) {
                    const originalEmail = threadEmails.find(e => e.mailbox !== 'Sent' && e.senderAddress);
                    if (originalEmail && originalEmail.messageId) {
                        candidates.push(originalEmail);
                    }
                }

                console.log('[LibraryCardView] Checking drafts for candidates:', candidates.map(c => c.messageId));

                for (const candidate of candidates) {
                    const targetId = candidate.messageId;
                    if (!targetId) continue; // Safety check

                    const res = await fetch(`/api/drafts/reply/${encodeURIComponent(targetId)}`);
                    if (res.ok) {
                        const draft = await res.json();
                        if (draft && (draft.body || draft.subject)) {
                            console.log('[LibraryCardView] Found draft for:', targetId);
                            // Important: We must expand the composer with the CORRECT replyTo email
                            const emailData = convertToEmail(candidate);
                            setReplyingToEmail(emailData);
                            hasCheckedDraft.current = true;
                            return; // Stop once found
                        }
                    }
                }
            } catch (err) {
                console.error('[LibraryCardView] Error checking draft:', err);
            }
            // Removed finally block so we can retry if threadEmails updates (e.g. from 1 to full thread)
            // ensuring we find the 'original' email if we started with just a 'sent' email
        };

        checkForDraft();
    }, [threadEmails, isSentEmail, convertToEmail]);

    const handleQuickSend = async () => {
        if (!quickReplyText.trim() || !email) return;

        console.log('Sending quick reply:', quickReplyText);

        const originalText = quickReplyText;
        setQuickReplyText(''); // Clear immediately for UX

        try {
            // Fetch body if not already loaded
            let emailBody = email.body;
            console.log('[QuickSend] Current email.body:', emailBody?.substring(0, 100));

            // Check if body is a loading placeholder (could be plain text or HTML)
            const isBodyLoading = !emailBody ||
                emailBody.trim() === '' ||
                emailBody === 'Loading body...' ||
                emailBody.includes('Loading body...') ||
                emailBody.includes('>Loading body...<') ||
                emailBody.startsWith('Loading');

            if (isBodyLoading) {
                console.log('[QuickSend] Body not loaded, fetching from API...');
                try {
                    const targetId = email.messageId || email.id;
                    const bodyResponse = await fetch(`/api/emails/${encodeURIComponent(targetId)}?uid=${email.uid}`);
                    if (bodyResponse.ok) {
                        const bodyData = await bodyResponse.json();
                        emailBody = bodyData.html || bodyData.text || '';
                        console.log('[QuickSend] Body fetched successfully, length:', emailBody?.length);
                    } else {
                        console.warn('[QuickSend] Body fetch failed:', bodyResponse.status);
                    }
                } catch (fetchErr) {
                    console.warn('[QuickSend] Failed to fetch body for quote:', fetchErr);
                    emailBody = ''; // Continue without quote
                }
            } else {
                console.log('[QuickSend] Body already loaded, length:', emailBody?.length);
            }

            // Format quoted reply with thread history (Gmail-style)
            const formatQuotedReply = () => {
                // Skip if no body available
                if (!emailBody || emailBody.trim() === '') {
                    return '';
                }

                // Handle date - could be Date object or string
                const dateObj = email.date instanceof Date
                    ? email.date
                    : new Date(email.date);

                // Format date like Gmail: "Wed, Nov 5, 2025 at 1:45 PM"
                const formattedDate = dateObj.toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                }) + ' at ' + dateObj.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit'
                });

                const senderName = email.sender || email.senderAddress;
                const senderEmail = email.senderAddress;

                // Gmail-style attribution line
                const attribution = `On ${formattedDate}, ${senderName} &lt;${senderEmail}&gt; wrote:`;

                // Use blockquote with Gmail-compatible styling
                return `
<br><br>
<div class="gmail_quote">
  <div style="color:#888888;font-size:11px;margin:0 0 8px">${attribution}</div>
  <blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">
    ${emailBody}
  </blockquote>
</div>`;
            };

            // Build reply with user's text + quoted original
            const userContent = `<div>${originalText.replace(/\n/g, '<br>')}</div>`;
            const quotedReply = formatQuotedReply();
            const fullBody = userContent + quotedReply;
            const replySubject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;

            // Optimistic UI: Add the sent email to the thread immediately
            const optimisticEmail: ThreadEmail = {
                messageId: `pending-${Date.now()}`, // Temporary ID
                subject: replySubject,
                sender: 'You', // Display name for sent email
                senderAddress: '', // Will be filled by server
                date: new Date().toISOString(),
                preview: originalText.substring(0, 100),
                bodyHtml: fullBody,
                bodyText: originalText,
                mailbox: 'Sent'
            };

            // Add to front of thread (newest first) and select it
            setThreadEmails(prev => [optimisticEmail, ...prev]);
            setSelectedIndex(0);
            // Also add body to emailBodies map for immediate display
            setEmailBodies(prev => {
                const newMap = new Map(prev);
                newMap.set(optimisticEmail.messageId, fullBody);
                return newMap;
            });

            const response = await fetch('/api/emails/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: [email.senderAddress],
                    cc: [],
                    bcc: [],
                    subject: replySubject,
                    body: fullBody,
                    inReplyTo: email.messageId,
                    references: email.messageId, // Required for proper threading in Thunderbird/webmail
                    attachments: []
                })
            });

            const result = await response.json();

            if (result.success) {
                console.log('Quick reply sent successfully!');
                // Update the optimistic email with real messageId if returned
                if (result.messageId) {
                    setThreadEmails(prev => prev.map(e =>
                        e.messageId === optimisticEmail.messageId
                            ? { ...e, messageId: result.messageId }
                            : e
                    ));
                }
            } else {
                console.error('Failed to send quick reply:', result.error);
                alert(`Failed to send: ${result.error}`);
                // Remove optimistic email on failure
                setThreadEmails(prev => prev.filter(e => e.messageId !== optimisticEmail.messageId));
                setQuickReplyText(originalText); // Restore on failure
            }
        } catch (err: any) {
            console.error('Error sending quick reply:', err);
            alert(`Error sending: ${err.message}`);
            setQuickReplyText(originalText); // Restore on failure
        }
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
                <motion.div
                    layout
                    transition={{ type: "spring", duration: 0.4, bounce: 0 }}
                    style={{
                        position: 'relative',
                        width: CARD_WIDTH,
                        height: CARD_HEIGHT,
                        maxWidth: CARD_MAX_WIDTH,
                        perspective: '1200px',
                        marginTop: '-40px',
                        pointerEvents: 'auto',
                        transformStyle: 'preserve-3d'
                    }}
                >
                    {useMemo(() => [...threadEmails].reverse().map((threadEmail, reverseIdx) => {
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
                                    onReply={handleReply}
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
                    }), [threadEmails, selectedIndex, convertToEmail, isSentEmail, handleReply, onClose])}
                </motion.div>

                {/* Unified Bottom Panel and Composer */}
                <motion.div
                    layout
                    transition={{ type: "spring", duration: 0.4, bounce: 0, opacity: { duration: 0.2 } }}
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
                        pointerEvents: 'auto',
                        borderRadius: 'var(--radius-lg)',
                        backgroundColor: isComposing ? '#fff' : 'rgba(255,255,255,0.8)'
                    }}
                >
                    <motion.div
                        layout="position"
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
                        {!replyingToEmail && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
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
                                <button
                                    onClick={handleQuickSend}
                                    disabled={quickReplyText.length === 0}
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
                                        cursor: quickReplyText.length > 0 ? 'pointer' : 'default',
                                        marginLeft: '8px',
                                        opacity: quickReplyText.length > 0 ? 1 : 0,
                                        transition: 'opacity 0.15s ease'
                                    }}
                                >
                                    <Send size={14} />
                                </button>
                            </motion.div>
                        )}
                    </motion.div>

                    {replyingToEmail && (
                        <motion.div
                            layout="position"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            style={{
                                width: '100%',
                                overflow: 'hidden',
                                backgroundColor: '#fff',
                                borderRadius: 'var(--radius-lg)',
                                boxShadow: 'var(--shadow-floating)'
                            }}
                        >
                            <CompositionPanel
                                replyTo={replyingToEmail}
                                initialBody={quickReplyText}
                                onSend={(draft) => {
                                    console.log('Email sent, adding to thread');

                                    // Add sent email to thread immediately
                                    const sentEmail: ThreadEmail = {
                                        messageId: `sent-${Date.now()}`,
                                        subject: draft.subject,
                                        sender: 'You',
                                        senderAddress: '',
                                        date: new Date().toISOString(),
                                        preview: draft.body.substring(0, 100).replace(/<[^>]*>/g, ''),
                                        bodyHtml: draft.body,
                                        bodyText: draft.body.replace(/<[^>]*>/g, ''),
                                        mailbox: 'Sent'
                                    };

                                    setThreadEmails(prev => [sentEmail, ...prev]);
                                    setSelectedIndex(0);
                                    setQuickReplyText(''); // Clear quick reply input
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
