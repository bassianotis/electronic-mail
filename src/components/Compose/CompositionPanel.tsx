/**
 * CompositionPanel - Email composition panel for replies
 * 
 * A panel component that handles email composition with:
 * - Recipient fields (To, CC, BCC)
 * - Subject line (pre-populated for replies)
 * - Plain text body
 * - Draft status indicator
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Send, Trash2 } from 'lucide-react';
import type { Email } from '../../store/mailStore';

interface CompositionPanelProps {
    replyTo: Email;
    onSend: (draft: DraftEmail) => void;
    onDiscard: () => void;
    onClose: () => void;
}

export interface DraftEmail {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    inReplyTo?: string;
    threadId?: string;
}

export const CompositionPanel: React.FC<CompositionPanelProps> = ({
    replyTo,
    onSend,
    onDiscard,
    onClose
}) => {
    // Recipient fields
    const [to, setTo] = useState<string>(replyTo.senderAddress || '');
    const [cc, setCc] = useState<string>('');
    const [bcc, setBcc] = useState<string>('');
    const [showCcBcc, setShowCcBcc] = useState(false);

    // Content fields
    const [subject, setSubject] = useState<string>(() => {
        const originalSubject = replyTo.subject || '';
        if (originalSubject.toLowerCase().startsWith('re:')) {
            return originalSubject;
        }
        return `Re: ${originalSubject}`;
    });
    const [body, setBody] = useState<string>('');

    // Draft status
    const [draftStatus, setDraftStatus] = useState<'unsaved' | 'saving' | 'saved'>('unsaved');
    const [isSending, setIsSending] = useState(false);

    const bodyRef = useRef<HTMLTextAreaElement>(null);

    // Focus body on mount
    useEffect(() => {
        if (bodyRef.current) {
            bodyRef.current.focus();
        }
    }, []);

    // Simple draft status indicator (visual only for now)
    useEffect(() => {
        if (body.length > 0 || to !== replyTo.senderAddress) {
            setDraftStatus('unsaved');
        }
    }, [body, to, cc, bcc, subject, replyTo.senderAddress]);

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
            inReplyTo: replyTo.messageId
        };

        try {
            await onSend(draft);
        } finally {
            setIsSending(false);
        }
    };

    const handleDiscard = () => {
        if (body.trim() && !window.confirm('Discard this draft?')) {
            return;
        }
        onDiscard();
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
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
            {/* Header - Matches email card header structure exactly */}
            <div style={{
                padding: 'var(--space-md) var(--space-lg)',
                borderBottom: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-bg-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start'
            }}>
                <div style={{ flex: 1 }}>
                    {/* Row 1: Recipient name + draft badge */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        marginBottom: '4px'
                    }}>
                        <span style={{
                            fontWeight: 600,
                            color: 'var(--color-text-main)',
                            fontSize: 'var(--font-size-sm)'
                        }}>
                            To: {to || 'recipient'}
                        </span>
                        {draftStatus === 'unsaved' && body.length > 0 && (
                            <span style={{
                                backgroundColor: '#f0f0f0',
                                color: '#666',
                                fontSize: '10px',
                                padding: '2px 6px',
                                borderRadius: 'var(--radius-full)',
                                fontWeight: 600
                            }}>
                                Draft
                            </span>
                        )}
                    </div>
                    {/* Row 2: Subject preview + expand arrow */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        flexWrap: 'wrap'
                    }}>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                            {subject}
                        </span>
                        <button
                            onClick={() => setShowCcBcc(!showCcBcc)}
                            style={{
                                padding: '2px 6px',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--color-text-muted)',
                                fontSize: '10px',
                                transition: 'background-color 0.2s',
                                marginLeft: '4px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-border)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            {showCcBcc ? '▲' : '▼'}
                        </button>
                    </div>
                </div>
                {/* Close button only on right */}
                <button
                    onClick={onClose}
                    style={{
                        padding: 'var(--space-xs)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--color-text-muted)',
                        transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-border)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <X size={16} />
                </button>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#999', minWidth: '50px' }}>Subject:</span>
                        <input
                            type="text"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            style={{
                                flex: 1,
                                border: 'none',
                                outline: 'none',
                                fontSize: '12px',
                                color: '#666',
                                backgroundColor: 'transparent'
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Body - Clean Writing Area */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                padding: 'var(--space-lg)'
            }}>
                <textarea
                    ref={bodyRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write your reply..."
                    style={{
                        flex: 1,
                        width: '100%',
                        minHeight: '200px',
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

            {/* Action Bar */}
            <div style={{
                padding: 'var(--space-md) var(--space-lg)',
                borderTop: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--color-bg-subtle)'
            }}>
                <button
                    onClick={handleDiscard}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-xs)',
                        padding: 'var(--space-sm) var(--space-md)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-muted)',
                        borderRadius: 'var(--radius-sm)',
                        transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                        e.currentTarget.style.color = 'var(--color-danger)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--color-text-muted)';
                    }}
                >
                    <Trash2 size={16} />
                    Discard
                </button>

                <button
                    onClick={handleSend}
                    disabled={!to.trim() || isSending}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-xs)',
                        padding: 'var(--space-sm) var(--space-lg)',
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 600,
                        color: '#fff',
                        backgroundColor: !to.trim() || isSending ? 'var(--color-text-muted)' : 'var(--color-accent-secondary)',
                        borderRadius: 'var(--radius-full)',
                        transition: 'all 0.2s',
                        cursor: !to.trim() || isSending ? 'not-allowed' : 'pointer',
                        boxShadow: 'var(--shadow-sm)'
                    }}
                    onMouseEnter={(e) => {
                        if (to.trim() && !isSending) {
                            e.currentTarget.style.transform = 'translateY(-1px)';
                            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                    }}
                >
                    <Send size={16} />
                    {isSending ? 'Sending...' : 'Send'}
                </button>
            </div>
        </motion.div>
    );
};

export default CompositionPanel;
