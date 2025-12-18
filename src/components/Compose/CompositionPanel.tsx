import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Trash2, Reply, Paperclip, X, File as FileIcon } from 'lucide-react';
import type { Email } from '../../store/mailStore';
import { useEmails } from '../../hooks/useEmails';

interface CompositionPanelProps {
    replyTo: Email;
    initialBody?: string;
    onSend: (draft: DraftEmail) => void;
    onDiscard: () => void;
}

export interface DraftEmail {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    inReplyTo?: string;
    threadId?: string;
    attachments: File[];
}

export const CompositionPanel: React.FC<CompositionPanelProps> = ({
    replyTo,
    initialBody,
    onSend,
    onDiscard
}) => {
    const { saveDraft, loadDraftForReply } = useEmails();

    // Recipient fields
    const [to, setTo] = useState<string>(replyTo.senderAddress || '');
    const [cc, setCc] = useState<string>('');
    const [bcc, setBcc] = useState<string>('');
    const [showCcBcc, setShowCcBcc] = useState(false);

    // Content fields
    const [subject] = useState<string>(() => {
        const originalSubject = replyTo.subject || '';
        if (originalSubject.toLowerCase().startsWith('re:')) {
            return originalSubject;
        }
        return `Re: ${originalSubject}`;
    });
    const [body, setBody] = useState<string>(initialBody || '');

    // Attachments
    const [attachments, setAttachments] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Draft status
    const [draftStatus, setDraftStatus] = useState<'unsaved' | 'saving' | 'saved'>('unsaved');
    const [isSending, setIsSending] = useState(false);
    const [draftId, setDraftId] = useState<string | null>(null);
    const [draftLoaded, setDraftLoaded] = useState(false);

    const bodyRef = useRef<HTMLTextAreaElement>(null);

    // Load existing draft on mount
    useEffect(() => {
        const loadExistingDraft = async () => {
            if (draftLoaded) return;
            setDraftLoaded(true);

            const existingDraft = await loadDraftForReply(replyTo.id);
            if (existingDraft) {
                // Pre-populate form with existing draft
                setDraftId(existingDraft.id);
                if (existingDraft.to) setTo(existingDraft.to.join(', '));
                if (existingDraft.cc) setCc(existingDraft.cc.join(', '));
                if (existingDraft.bcc) setBcc(existingDraft.bcc.join(', '));
                // Strip the quoted reply portion to show only user's text
                // (The quoted reply will be re-added when saving)
                const bodyWithoutQuote = (existingDraft.body || '').split('<br><br>\n<div class="gmail_quote">')[0];
                // Convert <br> back to newlines for textarea
                const plainBody = bodyWithoutQuote.replace(/<br>/g, '\n');
                setBody(plainBody);
                currentDraftIdRef.current = existingDraft.id;
                setDraftStatus('saved');
            }
        };
        loadExistingDraft();
    }, [replyTo.id, loadDraftForReply, draftLoaded]);

    // Focus body on mount and set cursor to end (after draft loads)
    useEffect(() => {
        if (bodyRef.current && draftLoaded) {
            bodyRef.current.focus();
            // Move cursor to end of text (fluid typing experience)
            const length = bodyRef.current.value.length;
            bodyRef.current.setSelectionRange(length, length);
        }
    }, [draftLoaded]);

    // Refs for serialization
    const isSavingRef = useRef(false);
    const hasPendingSaveRef = useRef(false);

    // Initialize ID on client side if not provided
    // This guarantees all parallel requests from this instance use the same ID
    const initialId = useRef(draftId || crypto.randomUUID());
    const currentDraftIdRef = useRef(initialId.current);

    // Data ref excludes draftId now
    const draftDataRef = useRef({ to, cc, bcc, subject, body, attachments });

    // Sync draftId ref with state (when state catches up)
    useEffect(() => {
        if (draftId) currentDraftIdRef.current = draftId;
    }, [draftId]);

    // Keep draftDataRef up to date
    useEffect(() => {
        draftDataRef.current = { to, cc, bcc, subject, body, attachments };
    }, [to, cc, bcc, subject, body, attachments]);

    // Serialized Save Function
    const saveContent = async () => {
        if (isSavingRef.current) {
            hasPendingSaveRef.current = true;
            return;
        }

        isSavingRef.current = true;
        setDraftStatus('saving');

        try {
            const { to, cc, bcc, subject, body, attachments } = draftDataRef.current;
            // Always read the latest ID from the ref
            const activeDraftId = currentDraftIdRef.current;

            // Validate minimal content
            if (!body && !subject && to === replyTo.senderAddress && attachments.length === 0) {
                setDraftStatus('saved');
                return;
            }

            // Build full body with quoted reply (Gmail/Outlook compatible format)
            const formatQuotedReply = () => {
                if (!replyTo.body) return '';

                // Handle date - could be Date object or string
                const dateObj = replyTo.date instanceof Date
                    ? replyTo.date
                    : new Date(replyTo.date);

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

                const senderName = replyTo.sender || replyTo.senderAddress;
                const senderEmail = replyTo.senderAddress;

                // Gmail-style attribution line
                const attribution = `On ${formattedDate}, ${senderName} &lt;${senderEmail}&gt; wrote:`;

                // Use blockquote with Gmail-compatible styling
                return `
<br><br>
<div class="gmail_quote">
  <div style="color:#888888;font-size:11px;margin:0 0 8px">${attribution}</div>
  <blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">
    ${replyTo.body}
  </blockquote>
</div>`;
            };

            // Convert plain text newlines to HTML <br> tags for proper display
            const htmlBody = body.replace(/\n/g, '<br>');
            const fullBody = htmlBody + formatQuotedReply();

            // Convert File objects to base64 for backend
            const convertToBase64 = (file: File): Promise<string> => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const base64 = (reader.result as string).split(',')[1]; // Remove data URL prefix
                        resolve(base64);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            };

            // Build attachment data with content
            const attachmentData = await Promise.all(
                attachments.map(async (file) => ({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    content: await convertToBase64(file)
                }))
            );

            const draft: any = {
                id: activeDraftId,
                to: to.split(',').map(e => e.trim()).filter(Boolean),
                cc: cc.split(',').map(e => e.trim()).filter(Boolean),
                bcc: bcc.split(',').map(e => e.trim()).filter(Boolean),
                subject,
                body: fullBody,
                attachments: attachmentData,
                inReplyTo: replyTo.id
            };

            const savedId = await saveDraft(draft);
            if (savedId) {
                // Update both state and ref immediately
                if (savedId !== activeDraftId) {
                    setDraftId(savedId);
                    currentDraftIdRef.current = savedId;
                }
                setDraftStatus('saved');
            }
        } catch (err) {
            console.error('Auto-save failed:', err);
            setDraftStatus('unsaved');
        } finally {
            isSavingRef.current = false;
            // If pending changes, trigger recursion
            if (hasPendingSaveRef.current) {
                hasPendingSaveRef.current = false;
                saveContent();
            }
        }
    };

    // Debounced Auto-Save triggering the serialized saver
    useEffect(() => {
        // Skip initial mount or empty
        if (!body && !subject && to === replyTo.senderAddress && attachments.length === 0) return;

        const handler = setTimeout(() => {
            saveContent();
        }, 1000);

        return () => clearTimeout(handler);
    }, [body, to, cc, bcc, subject, attachments]); // Removed draftId from deps to avoid loop? No, draftId change shouldn't trigger save.
    // Actually, if draftId changes (because we saved), we don't want to trigger another save immediately.
    // Removing draftId from dependencies is correct.
    // But verify: 'to' change triggers effect -> timeout -> saveContent().

    // Legacy simple draft status indicator REMOVED (logic moved to saveContent status updates)
    // The previous useEffect at line 108:
    // useEffect(() => {
    //    if (...) setDraftStatus('unsaved');
    // }, [...]);
    // We should keep the "Unsaved" indicator while typing!

    useEffect(() => {
        if (body.length > 0 || to !== replyTo.senderAddress || attachments.length > 0) {
            // Only set to unsaved if we are not currently saving? 
            // Actually, if user types, we want to show '...' or just wait for 'Saving...'?
            // User wants to see "Saving..." when it starts. 
            // "Unsaved" state is good feedback before the debounce kicks in? 
            // Lets just leave it or integrate it. 
            // If I type, I want to know its dirty? 
            // The prompt says "Ideally this would save...".
            // Let's keep the dirty indicator but maybe just use the debounce.
            // If I type, setDraftStatus('unsaved')? 
            // Yes.
            if (!isSavingRef.current) {
                setDraftStatus('unsaved');
            }
        }
    }, [body, to, cc, bcc, subject, attachments]);

    // Handle File Selection (Max 25MB Total)
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const newFiles = Array.from(e.target.files);

            // Calculate total size
            const currentSize = attachments.reduce((acc, file) => acc + file.size, 0);
            const newSize = newFiles.reduce((acc, file) => acc + file.size, 0);
            const totalSizeMB = (currentSize + newSize) / (1024 * 1024);

            if (totalSizeMB > 25) {
                alert(`Attachments exceed 25MB limit. Current total: ${totalSizeMB.toFixed(1)}MB`);
                return;
            }

            setAttachments(prev => [...prev, ...newFiles]);
        }
        // Reset input so same file can be selected again if needed
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const removeAttachment = (indexToRemove: number) => {
        setAttachments(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    const handleSend = async () => {
        if (!to.trim()) {
            return;
        }

        setIsSending(true);

        const draft: DraftEmail = {
            to: to.split(',').map(e => e.trim()).filter(Boolean),
            cc: cc.split(',').map(e => e.trim()).filter(Boolean),
            bcc: bcc.split(',').map(e => e.trim()).filter(Boolean),
            subject,
            body,
            inReplyTo: replyTo.messageId,
            attachments // Include attachments
        };

        try {
            await onSend(draft);
            // Cleanup draft if exists
            if (draftId) {
                await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
                // Dispatch event for real-time draft indicator removal
                window.dispatchEvent(new CustomEvent('draftDeleted', {
                    detail: { draftId, inReplyTo: replyTo.id }
                }));
            }
        } finally {
            setIsSending(false);
        }
    };

    const handleDiscard = async () => {
        if (draftId) {
            await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
            // Dispatch event for real-time draft indicator removal
            window.dispatchEvent(new CustomEvent('draftDeleted', {
                detail: { draftId, inReplyTo: replyTo.id }
            }));
        }
        onDiscard();
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: '#fff',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-floating)',
                overflow: 'hidden'
            }}
        >
            {/* Header - Minimal with To field and small actions */}
            <div style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-bg-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden' }}>
                    <span style={{
                        fontWeight: 600,
                        color: 'var(--color-text-main)',
                        fontSize: 'var(--font-size-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0
                    }}>
                        <Reply size={14} />
                        To: {to || 'recipient'}
                    </span>

                    {/* Attachment Pills - Subtle, Scrolling if many */}
                    {attachments.length > 0 && (
                        <div style={{
                            display: 'flex',
                            gap: '6px',
                            overflowX: 'auto',
                            flex: 1,
                            marginLeft: '12px',
                            alignItems: 'center',
                            scrollbarWidth: 'none'  // Hide scrollbar
                        }}>
                            <AnimatePresence>
                                {attachments.map((file, idx) => (
                                    <motion.div
                                        key={`${file.name}-${idx}`}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.9 }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            padding: '2px 8px',
                                            backgroundColor: '#fff',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-full)',
                                            fontSize: '11px',
                                            color: 'var(--color-text-muted)',
                                            whiteSpace: 'nowrap',
                                            flexShrink: 0
                                        }}
                                    >
                                        <FileIcon size={10} />
                                        <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {file.name}
                                        </span>
                                        <button
                                            onClick={() => removeAttachment(idx)}
                                            style={{
                                                border: 'none',
                                                background: 'transparent',
                                                padding: '2px',
                                                cursor: 'pointer',
                                                color: 'var(--color-text-muted)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                marginLeft: '2px'
                                            }}
                                        >
                                            <X size={10} />
                                        </button>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    {draftStatus !== 'unsaved' && (
                        <span style={{
                            backgroundColor: '#f0f0f0',
                            color: '#666',
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-full)',
                            fontWeight: 600,
                            minWidth: '40px',
                            textAlign: 'center'
                        }}>
                            {draftStatus === 'saving' ? 'Saving...' : 'Saved'}
                        </span>
                    )}

                    <button
                        onClick={() => setShowCcBcc(!showCcBcc)}
                        style={{
                            padding: '4px',
                            color: 'var(--color-text-muted)',
                            fontSize: '10px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        {showCcBcc ? '▲' : '▼'}
                    </button>
                </div>
            </div>

            {/* Expandable To/CC/BCC/Subject section */}
            {showCcBcc && (
                <div style={{
                    padding: 'var(--space-sm) var(--space-lg)',
                    backgroundColor: '#fafafa',
                    borderBottom: '1px solid #f0f0f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '12px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#999', minWidth: '50px' }}>To:</span>
                        <input
                            type="email"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            style={{
                                flex: 1,
                                border: 'none',
                                outline: 'none',
                                fontSize: '12px',
                                color: 'var(--color-text-main)',
                                backgroundColor: 'transparent'
                            }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#999', minWidth: '50px' }}>Cc:</span>
                        <input
                            type="email"
                            value={cc}
                            onChange={(e) => setCc(e.target.value)}
                            placeholder="Add Cc..."
                            style={{
                                flex: 1,
                                border: 'none',
                                outline: 'none',
                                fontSize: '12px',
                                color: 'var(--color-text-main)',
                                backgroundColor: 'transparent'
                            }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#999', minWidth: '50px' }}>Bcc:</span>
                        <input
                            type="email"
                            value={bcc}
                            onChange={(e) => setBcc(e.target.value)}
                            placeholder="Add Bcc..."
                            style={{
                                flex: 1,
                                border: 'none',
                                outline: 'none',
                                fontSize: '12px',
                                color: 'var(--color-text-main)',
                                backgroundColor: 'transparent'
                            }}
                        />
                    </div>

                </div>
            )}

            {/* Body - Clean Writing Area with Floating Send Button */}
            <div style={{
                flex: 1,
                position: 'relative',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                padding: 'var(--space-lg)',
                paddingBottom: '80px' // Space for floating buttons
            }}>
                <textarea
                    ref={bodyRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write your reply..."
                    style={{
                        flex: 1,
                        width: '100%',
                        minHeight: '120px',
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        fontSize: '15px',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                        lineHeight: '1.7',
                        color: '#333',
                        backgroundColor: 'transparent'
                    }}
                />


            </div>


            {/* Fixed Action Buttons */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.2 }}
                style={{
                    position: 'absolute',
                    bottom: '20px',
                    left: '20px',
                    right: '20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    pointerEvents: 'none' // Let clicks pass through container
                }}>

                {/* Left Side: Discard & Attach */}
                <div style={{ display: 'flex', gap: '8px', pointerEvents: 'auto' }}>

                    {/* Discard */}
                    <button
                        onClick={handleDiscard}
                        title="Discard Draft"
                        style={{
                            padding: '8px',
                            color: 'var(--color-text-muted)',
                            backgroundColor: 'rgba(255,255,255,0.8)',
                            backdropFilter: 'blur(4px)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '50%',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: 0.7,
                            transition: 'opacity 0.2s',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.backgroundColor = '#fff';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '0.7';
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.8)';
                        }}
                    >
                        <Trash2 size={16} />
                    </button>

                    {/* Attach File */}
                    <input
                        type="file"
                        multiple
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileSelect}
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach File"
                        style={{
                            padding: '8px',
                            color: 'var(--color-text-muted)',
                            backgroundColor: 'rgba(255,255,255,0.8)',
                            backdropFilter: 'blur(4px)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '50%',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: 0.7,
                            transition: 'opacity 0.2s',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.backgroundColor = '#fff';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '0.7';
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.8)';
                        }}
                    >
                        <Paperclip size={16} />
                    </button>
                </div>

                {/* Subtle Floating Send Button */}
                <button
                    onClick={handleSend}
                    disabled={!to.trim() || isSending}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#fff',
                        backgroundColor: !to.trim() || isSending ? '#ccc' : '#222', // Subtle black/gray
                        borderRadius: '100px',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        cursor: !to.trim() || isSending ? 'not-allowed' : 'pointer',
                        border: 'none',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        pointerEvents: 'auto' // Re-enable clicks
                    }}
                    onMouseEnter={(e) => {
                        if (to.trim() && !isSending) {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.15)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                    }}
                >
                    {isSending ? 'Sending...' : 'Send'}
                    {!isSending && <Send size={13} strokeWidth={2.5} />}
                </button>
            </motion.div>
        </motion.div >
    );
};

export default CompositionPanel;
