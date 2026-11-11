/**
 * The composer (Explore 2, 2b–2f): one panel for new messages, replies and forwards, showing the
 * draft held in shared app state (ComposerContext), docked or in the corner window (the same
 * fields, message and footer in both).
 * - Header (docked): the subject (or "New message", muted, until one is typed), and Move to the
 *   corner. The corner window has its own header.
 * - Rows: From, To (with the reply-type button in its gutter), Cc / Bcc, Subject. A reply starts
 *   with only To; clicking To shows the rest, clicking into the message hides it again.
 * - The message (plain text; the quote is added when saving and sending, never shown).
 * - Attachments as chips (upload progress under each; trouble shown on the chip), then Attach,
 *   Discard, the save status and Send. Files dropped anywhere on the composer are attached.
 * - From: a menu of your accounts (those without sending set up greyed out); changing it moves the
 *   draft to that account and sends from there.
 * ⌘↩ (Ctrl+Enter) sends. Keys pressed inside never reach the conversation's own keys (arrows flip
 * cards, Escape closes).
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CornerUpLeft, File as FileIcon, Forward, Minimize2, Paperclip, Reply, ReplyAll, Send, Trash2, X } from 'lucide-react';
import { useComposer } from '../../context/ComposerContext';
import { useMail } from '../../context/MailContext';
import { composerTitle, isUploading, type ReplyType } from '../../utils/replyDraft';
import { RecipientField } from './RecipientField';
import { fieldLabel, fieldRow } from './styles';
import { formatSize } from '../../utils/format';
import { formatDate } from '../../utils/formatDate';

const TYPES: { type: ReplyType; label: string; Icon: typeof Reply }[] = [
    { type: 'reply', label: 'Reply', Icon: Reply },
    { type: 'replyAll', label: 'Reply all', Icon: ReplyAll },
    { type: 'forward', label: 'Forward', Icon: Forward },
];

const linkButton: React.CSSProperties = {
    border: 0,
    background: 'transparent',
    padding: '4px 8px',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-muted)',
    cursor: 'pointer'
};

const roundButton: React.CSSProperties = {
    width: '32px',
    height: '32px',
    flexShrink: 0,
    borderRadius: 'var(--radius-full)',
    border: 0,
    background: 'transparent',
    color: 'var(--color-text-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
};

const menu: React.CSSProperties = {
    position: 'absolute',
    zIndex: 25,
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-menu)',
    padding: '4px'
};

const menuItem = (on: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px',
    border: 0,
    borderRadius: 'max(4px, calc(var(--radius-md) - 4px))',
    background: on ? 'var(--color-bg-subtle)' : 'transparent',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-main)',
    textAlign: 'left',
    cursor: 'pointer'
});


export const Composer: React.FC<{
    place?: 'docked' | 'corner';
    /** Docked in its conversation: "Replying to Theo Park, Oct 28" shows that message in the band. */
    onShowTarget?: () => void;
}> = ({ place = 'docked', onShowTarget }) => {
    const { draft, status, sending, waiting, keptLocally, myAddresses, update, changeType, changeFrom, discard, send, retrySave, addFiles, removeAttachment } = useComposer();
    const { accounts } = useMail();
    const [typeOpen, setTypeOpen] = useState(false);
    const [fromOpen, setFromOpen] = useState(false);
    const fromMenuRef = useRef<HTMLDivElement>(null);
    // ⌘↩ presses Send once a typed address has become a chip (so Send sees it)
    const sendButtonRef = useRef<HTMLButtonElement>(null);
    const [dragging, setDragging] = useState(false);
    // Why Send didn't go: shown (where "Saved" sits) only after Send is pressed, until it's fixed.
    const [problem, setProblem] = useState<'invalid' | 'nobody' | null>(null);
    const sectionRef = useRef<HTMLElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const typeMenuRef = useRef<HTMLDivElement>(null);
    const draftId = draft?.id;

    // The message box opens ready to type, the cursor at the end.
    useEffect(() => {
        const box = bodyRef.current;
        if (!box) return;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
    }, [draftId]);

    // The message box grows with what's typed (the panel scrolls), so the signature follows the text.
    // Measuring collapses it for a moment, which would pull the panel's scroll (and the line being
    // typed) to the bottom, so the panel keeps its place.
    useLayoutEffect(() => {
        const box = bodyRef.current;
        const panel = box?.parentElement;
        if (!box || !panel) return;
        const top = panel.scrollTop;
        box.style.height = 'auto';
        box.style.height = `${box.scrollHeight}px`;
        panel.scrollTo({ top, behavior: 'instant' });
    }, [draft?.body, draftId]);

    // The reply-type and From menus close on a click anywhere else.
    useEffect(() => {
        if (!typeOpen && !fromOpen) return;
        const away = (e: MouseEvent) => {
            if (!typeMenuRef.current?.contains(e.target as Node)) setTypeOpen(false);
            if (!fromMenuRef.current?.contains(e.target as Node)) setFromOpen(false);
        };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [typeOpen, fromOpen]);

    if (!draft) return null;

    const isReply = !!draft.type;
    // The message it answers (reading-navigation-spec.md §6): a button that shows it in the band
    const answered = draft.original?.email;
    const targetLink = onShowTarget && isReply && answered ? (
        <button type="button" className="em-target-link" onClick={onShowTarget} title="Show it above">
            <CornerUpLeft size={13} strokeWidth={1.5} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {draft.type === 'forward' ? 'Forwarding' : 'Replying to'} {answered.mailbox === 'Sent' || myAddresses.includes((answered.senderAddress ?? '').toLowerCase()) ? 'Me' : answered.sender}, {formatDate(answered.date)}
            </span>
        </button>
    ) : null;
    const gutter = isReply ? 34 : 0;
    const from = accounts.find(a => a.id === draft.fromAccountId);
    const uploading = draft.attachments.some(isUploading);
    const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
    const current = TYPES.find(t => t.type === draft.type) ?? TYPES[0];
    const title = composerTitle(draft);
    const placeholder = draft.type === 'forward' ? 'Add a note' : isReply ? 'Write a reply' : 'Write a message';
    const expand = () => { if (!draft.expanded) update({ expanded: true }, false); };

    const everyone = [...draft.to, ...draft.cc, ...draft.bcc];
    const problemText = problem === 'invalid' && everyone.some(r => r.invalid) ? 'An address is marked in red: fix or remove it'
        : problem === 'nobody' && !everyone.length ? 'Add someone to send it to'
            : null;
    const handleSend = () => {
        if (uploading || sending || waiting) return;
        const why = everyone.some(r => r.invalid) ? 'invalid' : !everyone.length ? 'nobody' : null;
        setProblem(why);
        if (!why) {
            void send();
            return;
        }
        // Straight to what needs fixing: the red chip, or the To field.
        const target = why === 'invalid'
            ? sectionRef.current?.querySelector<HTMLElement>('[data-invalid-recipient]')
            : sectionRef.current?.querySelector<HTMLElement>('input[aria-label="To"]');
        target?.focus();
    };

    const statusText = uploading ? 'Send waits for the upload'
        : status === 'saving' ? 'Saving…'
            : status === 'saved' ? 'Saved'
                : keptLocally ? 'Kept on this computer'
                    : '';
    // Send can't be pressed again while it's going, uploading, or waiting for the server
    const sendOff = uploading || sending || waiting;

    return (
        <section
            ref={sectionRef}
            aria-label={isReply ? 'Reply' : 'New message'}
            onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    setTimeout(() => sendButtonRef.current?.click());
                }
            }}
            onDragOver={e => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                if (!dragging) setDragging(true);
            }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={e => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                setDragging(false);
                addFiles(Array.from(e.dataTransfer.files));
            }}
            style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                boxSizing: 'border-box',
                background: 'var(--surface-raised)',
                outline: dragging ? '2px dashed var(--color-action)' : 'none',
                outlineOffset: '-4px'
            }}
        >
            {place === 'docked' && <header style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '48px', padding: '0 8px 0 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
                <h2 style={{
                    margin: 0,
                    flex: 1,
                    minWidth: 0,
                    fontSize: 'var(--font-size-base)',
                    fontWeight: 'var(--weight-bold)',
                    color: !isReply && !draft.subject ? 'var(--color-text-muted)' : 'var(--color-text-main)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    {title}
                </h2>
                <button
                    type="button"
                    title="Move to the corner and keep using the app"
                    aria-label="Move to the corner"
                    onClick={() => update({ place: 'corner' }, false)}
                    className="em-icon-button"
                    style={roundButton}
                >
                    <Minimize2 size={16} aria-hidden="true" />
                </button>
            </header>}

            <div style={{ position: 'relative', padding: '0 20px', fontSize: 'var(--font-size-sm)', flexShrink: 0 }}>
                {draft.expanded && (
                    <div style={fieldRow}>
                        <span style={{ flex: `0 0 ${gutter}px` }} />
                        <span style={fieldLabel}>From</span>
                        <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={fromOpen}
                            onClick={() => { setFromOpen(open => !open); setTypeOpen(false); }}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '4px 8px',
                                marginLeft: '-8px',
                                border: 0,
                                borderRadius: 'var(--radius-control)',
                                background: fromOpen ? 'var(--color-bg-subtle)' : 'transparent',
                                fontFamily: 'inherit',
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-main)',
                                cursor: 'pointer'
                            }}
                        >
                            {from?.displayName && <>{from.displayName} </>}<span style={{ color: 'var(--color-text-muted)' }}>{from?.email}</span>
                            <ChevronDown size={14} aria-hidden="true" />
                        </button>
                    </div>
                )}

                <RecipientField
                    label="To"
                    recipients={draft.to}
                    onChange={to => update({ to })}
                    gutter={gutter}
                    gutterContent={isReply && draft.original?.email ? (
                        <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={typeOpen}
                            title={`${current.label}: change to Reply, Reply all or Forward`}
                            aria-label={`${current.label}, change`}
                            onClick={() => setTypeOpen(open => !open)}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '2px',
                                height: '28px',
                                padding: '0 4px 0 8px',
                                marginLeft: '-8px',
                                border: 0,
                                borderRadius: 'var(--radius-control)',
                                background: typeOpen ? 'var(--color-bg-subtle)' : 'transparent',
                                color: 'var(--color-text-muted)',
                                cursor: 'pointer'
                            }}
                        >
                            <current.Icon size={16} aria-hidden="true" />
                            <ChevronDown size={14} aria-hidden="true" />
                        </button>
                    ) : null}
                    onActivate={isReply ? expand : undefined}
                    placeholder="Add people"
                    trailing={(draft.expanded && (!draft.showCc || !draft.showBcc)) || targetLink ? (
                        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', minWidth: 0 }}>
                            {targetLink}
                            {draft.expanded && !draft.showCc && <button type="button" style={linkButton} onClick={() => update({ showCc: true }, false)}>Cc</button>}
                            {draft.expanded && !draft.showBcc && <button type="button" style={linkButton} onClick={() => update({ showBcc: true }, false)}>Bcc</button>}
                        </span>
                    ) : null}
                />

                {(draft.showCc || draft.cc.length > 0) && (
                    <RecipientField label="Cc" recipients={draft.cc} onChange={cc => update({ cc })} gutter={gutter} />
                )}
                {(draft.showBcc || draft.bcc.length > 0) && (
                    <RecipientField label="Bcc" recipients={draft.bcc} onChange={bcc => update({ bcc })} gutter={gutter} />
                )}

                {draft.expanded && (
                    <div style={fieldRow}>
                        <span style={{ flex: `0 0 ${gutter}px` }} />
                        <label htmlFor={`subject-${draft.id}`} style={fieldLabel}>Subject</label>
                        <input
                            id={`subject-${draft.id}`}
                            type="text"
                            value={draft.subject}
                            onChange={e => update({ subject: e.target.value, subjectEdited: true })}
                            style={{
                                flex: 1,
                                minWidth: '120px',
                                border: 0,
                                outline: 'none',
                                background: 'transparent',
                                fontFamily: 'inherit',
                                fontSize: 'var(--font-size-sm)',
                                fontWeight: 'var(--weight-semibold)',
                                color: 'var(--color-text-main)',
                                padding: '4px 0'
                            }}
                        />
                    </div>
                )}

                {fromOpen && (
                    <div ref={fromMenuRef} role="menu" aria-label="Send from" style={{ ...menu, left: `${gutter + 70}px`, top: '40px', width: '300px' }}
                        onKeyDown={e => { if (e.key === 'Escape') setFromOpen(false); }}>
                        {accounts.map(a => (
                            <button
                                key={a.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={a.id === draft.fromAccountId}
                                disabled={!a.hasSmtp}
                                title={a.hasSmtp ? undefined : 'Sending isn’t set up for this account (Settings → Name and sending)'}
                                onClick={() => {
                                    setFromOpen(false);
                                    void changeFrom(a.id);
                                }}
                                style={{ ...menuItem(a.id === draft.fromAccountId), opacity: a.hasSmtp ? 1 : 0.45, cursor: a.hasSmtp ? 'pointer' : 'default' }}
                            >
                                <span style={{ width: '16px', color: 'var(--color-action)', display: 'flex' }}>
                                    {a.id === draft.fromAccountId && <Check size={16} aria-hidden="true" />}
                                </span>
                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {a.displayName && <>{a.displayName} </>}<span style={{ color: 'var(--color-text-muted)' }}>{a.email}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {typeOpen && (
                    <div ref={typeMenuRef} role="menu" aria-label="Reply type" style={{ ...menu, left: '16px', top: '40px', width: '200px' }}
                        onKeyDown={e => { if (e.key === 'Escape') setTypeOpen(false); }}>
                        {TYPES.map(t => (
                            <button
                                key={t.type}
                                type="button"
                                role="menuitemradio"
                                aria-checked={draft.type === t.type}
                                onClick={() => {
                                    setTypeOpen(false);
                                    void changeType(t.type);
                                }}
                                style={menuItem(draft.type === t.type)}
                            >
                                <span style={{ width: '16px', color: 'var(--color-action)', display: 'flex' }}>
                                    {draft.type === t.type && <Check size={16} aria-hidden="true" />}
                                </span>
                                <span style={{ display: 'flex', color: 'var(--color-text-muted)' }}><t.Icon size={16} aria-hidden="true" /></span>
                                <span>{t.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* The message: clicking anywhere here types into it */}
            <div onClick={() => bodyRef.current?.focus()} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 28px 16px', cursor: 'text' }}>
                <textarea
                    ref={bodyRef}
                    value={draft.body}
                    rows={2}
                    aria-label={placeholder}
                    placeholder={placeholder}
                    onChange={e => update({ body: e.target.value })}
                    onFocus={() => { if (isReply && draft.expanded) update({ expanded: false }, false); }}
                    style={{
                        display: 'block',
                        width: '100%',
                        boxSizing: 'border-box',
                        border: 0,
                        outline: 'none',
                        resize: 'none',
                        overflow: 'hidden',
                        padding: 0,
                        background: 'transparent',
                        fontFamily: 'inherit',
                        fontSize: 'var(--font-size-lg)',
                        lineHeight: 1.65,
                        color: 'var(--message-text)'
                    }}
                />
                {/* The From account's signature: added when saving and sending, changed in Settings */}
                {from?.signature && (
                    <p title="Your signature: change it in Settings" style={{ margin: '4px 0 0', whiteSpace: 'pre-line', fontSize: 'var(--font-size-base)', lineHeight: 1.6, color: 'var(--color-text-faint)', cursor: 'default' }}>
                        {'—\n'}{from.signature}
                    </p>
                )}
            </div>

            {draft.attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 16px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
                    {draft.attachments.map(file => (
                        <span
                            key={file.key}
                            title={file.error ? `${file.filename}: ${file.error}` : file.id ? file.filename : `Attaching ${file.filename}…`}
                            style={{
                                position: 'relative',
                                overflow: 'hidden',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '4px 8px 4px 12px',
                                border: file.error ? '1px solid var(--color-danger)' : '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-control)',
                                background: file.error ? 'var(--error-bg)' : 'var(--color-bg-subtle)',
                                fontSize: 'var(--font-size-sm)'
                            }}
                        >
                            <FileIcon size={14} aria-hidden="true" />
                            <span style={{ fontWeight: 'var(--weight-semibold)' }}>{file.filename}</span>
                            {file.error
                                ? <span style={{ color: 'var(--error-text)', fontSize: 'var(--font-size-xs)' }}>{file.error}</span>
                                : <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>{formatSize(file.size)}</span>}
                            <button type="button" aria-label={`Remove ${file.filename}`} onClick={() => removeAttachment(file.key)} className="em-icon-button"
                                style={{ ...roundButton, width: '20px', height: '20px', padding: 0 }}>
                                <X size={14} aria-hidden="true" />
                            </button>
                            {isUploading(file) && (
                                // Upload progress; a forwarded file being copied has none to report.
                                <span aria-hidden="true" className={file.progress === undefined ? 'skeleton-bone' : undefined} style={{
                                    position: 'absolute', left: 0, bottom: 0, height: '2px', width: '100%', transformOrigin: 'left',
                                    transform: `scaleX(${file.progress === undefined ? 1 : file.progress})`,
                                    background: 'var(--color-action)', transition: 'transform var(--dur-mid) var(--ease)'
                                }} />
                            )}
                        </span>
                    ))}
                </div>
            )}

            <footer style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
                <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={e => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = ''; // the same file can be picked again
                }} />
                <button
                    type="button"
                    title="Attach file"
                    onClick={() => fileInputRef.current?.click()}
                    className="em-pill-button"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        height: '32px',
                        padding: '0 12px',
                        borderRadius: 'var(--radius-pill)',
                        border: 'var(--attach-border)',
                        background: 'var(--attach-bg)',
                        color: 'var(--color-text-muted)',
                        fontFamily: 'inherit',
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'pointer'
                    }}
                >
                    <Paperclip size={16} aria-hidden="true" />Attach
                </button>
                <button type="button" title="Discard draft" aria-label="Discard draft" onClick={() => void discard()} className="em-icon-button" style={roundButton}>
                    <Trash2 size={16} aria-hidden="true" />
                </button>
                {problemText ? (
                    <span role="alert" style={{ marginLeft: '4px', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-danger)' }}>{problemText}</span>
                ) : status === 'failed' && !uploading && !keptLocally ? (
                    <span style={{ marginLeft: '4px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-danger)', whiteSpace: 'nowrap' }}>
                        Not saved
                        <button type="button" onClick={retrySave} style={{
                            fontFamily: 'inherit',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 'var(--weight-semibold)',
                            color: 'var(--color-text-main)',
                            background: 'var(--surface-raised)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: 'var(--radius-pill)',
                            padding: '2px 12px',
                            cursor: 'pointer'
                        }}>
                            Try again
                        </button>
                    </span>
                ) : (
                    <span style={{ marginLeft: '4px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{statusText}</span>
                )}
                <button
                    ref={sendButtonRef}
                    type="button"
                    onClick={handleSend}
                    disabled={sendOff}
                    title={uploading ? 'Send waits for the upload' : waiting ? 'It sends when the server answers' : undefined}
                    style={{
                        marginLeft: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        height: '40px',
                        padding: '0 20px',
                        border: 0,
                        borderRadius: 'var(--radius-pill)',
                        background: sendOff ? 'var(--send-disabled)' : 'var(--color-action)',
                        boxShadow: sendOff ? 'none' : 'var(--shadow-send)',
                        color: sendOff ? 'var(--send-disabled-text)' : 'var(--color-on-action)',
                        fontFamily: 'inherit',
                        fontWeight: 'var(--weight-semibold)',
                        fontSize: 'var(--font-size-sm)',
                        cursor: sendOff ? 'default' : 'pointer'
                    }}
                >
                    {waiting ? 'Waits for the server' : <>Send<Send size={16} aria-hidden="true" /></>}
                </button>
            </footer>
        </section>
    );
};
