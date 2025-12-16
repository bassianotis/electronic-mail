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
import { X, Send, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
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

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: 'var(--space-sm) var(--space-md)',
        fontSize: 'var(--font-size-base)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: '#fff',
        outline: 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s'
    };

    const labelStyle: React.CSSProperties = {
        fontSize: 'var(--font-size-sm)',
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        marginBottom: 'var(--space-xs)',
        display: 'block'
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
            {/* Header */}
            <div style={{
                padding: 'var(--space-md) var(--space-lg)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--color-bg-subtle)'
            }}>
                <h3 style={{
                    fontSize: 'var(--font-size-lg)',
                    fontWeight: 600,
                    color: 'var(--color-text-main)'
                }}>
                    Reply
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    {/* Draft status */}
                    <span style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-muted)'
                    }}>
                        {draftStatus === 'saved' && '✓ Saved'}
                        {draftStatus === 'saving' && 'Saving...'}
                        {draftStatus === 'unsaved' && body.length > 0 && 'Draft'}
                    </span>
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
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Form Fields */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'var(--space-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-md)'
            }}>
                {/* To Field */}
                <div>
                    <label style={labelStyle}>To</label>
                    <input
                        type="email"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        placeholder="recipient@example.com"
                        style={inputStyle}
                        onFocus={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-accent-secondary)';
                            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(52, 152, 219, 0.1)';
                        }}
                        onBlur={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-border)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    />
                </div>

                {/* CC/BCC Toggle */}
                <button
                    onClick={() => setShowCcBcc(!showCcBcc)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-xs)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-accent-secondary)',
                        cursor: 'pointer',
                        alignSelf: 'flex-start'
                    }}
                >
                    {showCcBcc ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showCcBcc ? 'Hide CC/BCC' : 'Add CC/BCC'}
                </button>

                {/* CC/BCC Fields */}
                {showCcBcc && (
                    <>
                        <div>
                            <label style={labelStyle}>CC</label>
                            <input
                                type="email"
                                value={cc}
                                onChange={(e) => setCc(e.target.value)}
                                placeholder="cc@example.com"
                                style={inputStyle}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--color-accent-secondary)';
                                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(52, 152, 219, 0.1)';
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--color-border)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>BCC</label>
                            <input
                                type="email"
                                value={bcc}
                                onChange={(e) => setBcc(e.target.value)}
                                placeholder="bcc@example.com"
                                style={inputStyle}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--color-accent-secondary)';
                                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(52, 152, 219, 0.1)';
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--color-border)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            />
                        </div>
                    </>
                )}

                {/* Subject */}
                <div>
                    <label style={labelStyle}>Subject</label>
                    <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        style={inputStyle}
                        onFocus={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-accent-secondary)';
                            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(52, 152, 219, 0.1)';
                        }}
                        onBlur={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-border)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    />
                </div>

                {/* Body */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={labelStyle}>Message</label>
                    <textarea
                        ref={bodyRef}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Write your reply..."
                        style={{
                            ...inputStyle,
                            flex: 1,
                            minHeight: '200px',
                            resize: 'none',
                            fontFamily: 'inherit',
                            lineHeight: '1.6'
                        }}
                        onFocus={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-accent-secondary)';
                            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(52, 152, 219, 0.1)';
                        }}
                        onBlur={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-border)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    />
                </div>
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
