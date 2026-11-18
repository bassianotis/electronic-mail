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
 * cards), except Esc (rule L4): it closes a menu in it, else the composer, keeping the draft.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CornerUpLeft, File as FileIcon, Forward, Minimize2, Paperclip, Reply, ReplyAll, Send, Trash2, X } from 'lucide-react';
import { useComposer } from '../../context/ComposerContext';
import { useMail } from '../../context/MailContext';
import { composerTitle, isUploading, type ReplyType } from '../../utils/replyDraft';
import { RecipientField } from './RecipientField';
import { fieldLabel, fieldRow } from './styles';
import { formatSize } from '../../utils/format';
import { formatDate } from '../../utils/formatDate';
import { Menu, MenuItem } from '../../ui/Menu';
import { Button, IconButton } from '../../ui/Button';
import { TextArea, TextInput } from '../../ui/Field';
import { Tooltip } from '../../ui/Tooltip';

const TYPES: { type: ReplyType; label: string; Icon: typeof Reply }[] = [
    { type: 'reply', label: 'Reply', Icon: Reply },
    { type: 'replyAll', label: 'Reply all', Icon: ReplyAll },
    { type: 'forward', label: 'Forward', Icon: Forward },
];

// The reply-type and From menus (the shared Menu), placed inside the composer
const menuPlace: React.CSSProperties = { position: 'absolute', zIndex: 25 /* layer: popover, local (inside the composer) */ };

export const Composer: React.FC<{
    place?: 'docked' | 'corner';
    /** Docked in its conversation: "Replying to Theo Park, Oct 28" shows that message in the band. */
    onShowTarget?: () => void;
}> = ({ place = 'docked', onShowTarget }) => {
    const { draft, status, sending, waiting, keptLocally, myAddresses, update, changeType, changeFrom, discard, send, retrySave, addFiles, removeAttachment } = useComposer();
    const { accounts } = useMail();
    const [typeOpen, setTypeOpen] = useState(false);
    const [fromOpen, setFromOpen] = useState(false);
    const typeButtonRef = useRef<HTMLButtonElement>(null);
    const fromButtonRef = useRef<HTMLButtonElement>(null);
    // ⌘↩ presses Send once a typed address has become a chip (so Send sees it)
    const sendButtonRef = useRef<HTMLButtonElement>(null);
    const [dragging, setDragging] = useState(false);
    // Why Send didn't go: shown (where "Saved" sits) only after Send is pressed, until it's fixed.
    const [problem, setProblem] = useState<'invalid' | 'nobody' | null>(null);
    const sectionRef = useRef<HTMLElement>(null);
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
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

    // The reply-type and From menus: Esc closes the open one only (rule L4) and the focus goes back to
    // its button; arrows move; Tab leaves; a click anywhere else closes it (the shared Menu)

    if (!draft) return null;

    const isReply = !!draft.type;
    // The message it answers (reading-navigation-spec.md §6): a button that shows it in the band
    const answered = draft.original?.email;
    const targetLink = onShowTarget && isReply && answered ? (
        <Button kind="link" className="em-target-link" onClick={onShowTarget} title="Show it above" style={{ flexShrink: 1, minWidth: 0 }}
            icon={<CornerUpLeft size={13} aria-hidden="true" style={{ flexShrink: 0 }} />}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {draft.type === 'forward' ? 'Forwarding' : 'Replying to'} {answered.mailbox === 'Sent' || myAddresses.includes((answered.senderAddress ?? '').toLowerCase()) ? 'Me' : answered.sender}, {formatDate(answered.date)}
            </span>
        </Button>
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

    return (
        <section
            ref={sectionRef}
            aria-label={isReply ? 'Reply' : 'New message'}
            onKeyDown={e => {
                if (e.key !== 'Escape') e.stopPropagation();
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
                outline: dragging ? '2px dashed var(--action)' : 'none',
                outlineOffset: '-4px'
            }}
        >
            {place === 'docked' && <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', height: '48px', padding: '0 var(--space-2) 0 var(--space-5)', borderBottom: '1px solid var(--line-1)', flexShrink: 0 }}>
                <h2 style={{
                    margin: 0,
                    flex: 1,
                    minWidth: 0,
                    fontSize: 'var(--size-large)',
                    fontWeight: 'var(--weight-medium)',
                    color: !isReply && !draft.subject ? 'var(--text-3)' : 'var(--text-1)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    {title}
                </h2>
                <IconButton label="Move to the corner" icon={<Minimize2 size={16} aria-hidden="true" />} onClick={() => update({ place: 'corner' }, false)} />
            </header>}

            <div style={{ position: 'relative', padding: '0 var(--space-5)', fontSize: 'var(--size-body)', flexShrink: 0 }}>
                {draft.expanded && (
                    <div style={fieldRow}>
                        <span style={{ flex: `0 0 ${gutter}px` }} />
                        <span style={fieldLabel}>From</span>
                        {/* The shared Button's picker kind (board P5-1, row 10): the current choice, its chevron */}
                        <Button
                            ref={fromButtonRef}
                            kind="picker"
                            aria-haspopup="menu"
                            aria-expanded={fromOpen}
                            onClick={() => { setFromOpen(open => !open); setTypeOpen(false); }}
                            onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setFromOpen(true); setTypeOpen(false); } }}
                            style={{ marginLeft: '-8px' }}
                        >
                            {from?.displayName && <>{from.displayName} </>}<span style={{ color: 'var(--text-3)' }}>{from?.email}</span>
                        </Button>
                    </div>
                )}

                <RecipientField
                    label="To"
                    recipients={draft.to}
                    onChange={to => update({ to })}
                    gutter={gutter}
                    gutterContent={isReply && draft.original?.email ? (
                        <Tooltip content={`${current.label}: change to Reply, Reply all or Forward`}>
                            <Button
                                ref={typeButtonRef}
                                kind="picker"
                                aria-haspopup="menu"
                                aria-expanded={typeOpen}
                                aria-label={`${current.label}, change`}
                                onClick={() => setTypeOpen(open => !open)}
                                onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setTypeOpen(true); } }}
                                style={{ marginLeft: '-8px' }}
                            >
                                <current.Icon size={16} aria-hidden="true" />
                            </Button>
                        </Tooltip>
                    ) : null}
                    onActivate={isReply ? expand : undefined}
                    placeholder="Add people"
                    trailing={(draft.expanded && (!draft.showCc || !draft.showBcc)) || targetLink ? (
                        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minWidth: 0 }}>
                            {targetLink}
                            {draft.expanded && !draft.showCc && <Button kind="text" onClick={() => update({ showCc: true }, false)}>Cc</Button>}
                            {draft.expanded && !draft.showBcc && <Button kind="text" onClick={() => update({ showBcc: true }, false)}>Bcc</Button>}
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
                        <TextInput
                            bare
                            id={`subject-${draft.id}`}
                            type="text"
                            value={draft.subject}
                            onChange={e => update({ subject: e.target.value, subjectEdited: true })}
                            style={{ flex: 1, minWidth: '120px', fontWeight: 'var(--weight-medium)', padding: 'var(--space-1) 0' }}
                        />
                    </div>
                )}

                {fromOpen && (
                    <Menu label="Send from" anchor={fromButtonRef} onClose={() => setFromOpen(false)} returnFocus={() => fromButtonRef.current}
                        style={{ ...menuPlace, left: `${gutter + 70}px`, top: '40px', width: '300px' }}>
                        {accounts.map(a => (
                            <MenuItem key={a.id} checked={a.id === draft.fromAccountId} disabled={!a.hasSmtp}
                                title={a.hasSmtp ? undefined : 'Sending isn’t set up for this account. Add its sending server in Settings, under Password and servers'}
                                onSelect={() => {
                                    setFromOpen(false);
                                    void changeFrom(a.id);
                                }}>
                                {a.displayName && <>{a.displayName} </>}<span style={{ color: 'var(--text-3)' }}>{a.email}</span>
                            </MenuItem>
                        ))}
                    </Menu>
                )}

                {typeOpen && (
                    <Menu label="Reply type" anchor={typeButtonRef} onClose={() => setTypeOpen(false)} returnFocus={() => typeButtonRef.current}
                        style={{ ...menuPlace, left: '16px', top: '40px', width: '200px' }}>
                        {TYPES.map(t => (
                            <MenuItem key={t.type} checked={draft.type === t.type} icon={<t.Icon size={16} aria-hidden="true" />}
                                onSelect={() => {
                                    setTypeOpen(false);
                                    void changeType(t.type);
                                }}>
                                {t.label}
                            </MenuItem>
                        ))}
                    </Menu>
                )}
            </div>

            {/* The message: clicking anywhere here types into it. A writing surface: no ring and no box,
                only the caret (rule K3, revised 2026-11-16, which drops the 12px of room of 2026-11-13);
                the text lines up with the field labels above, 28px in. */}
            <div onClick={() => bodyRef.current?.focus()} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 'var(--space-5) 28px var(--space-4)', cursor: 'text' }}>
                <TextArea
                    bare
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
                        resize: 'none',
                        overflow: 'hidden',
                        fontSize: 'var(--size-title)',
                        lineHeight: 1.65,
                        color: 'var(--text-2)'
                    }}
                />
                {/* The From account's signature: added when saving and sending, changed in Settings */}
                {from?.signature && (
                    <p title="Your signature: change it in Settings" style={{ margin: 'var(--space-1) 0 0', whiteSpace: 'pre-line', fontSize: 'var(--size-large)', lineHeight: 1.6, color: 'var(--text-4)', cursor: 'default' }}>
                        {'—\n'}{from.signature}
                    </p>
                )}
            </div>

            {draft.attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-4)', borderTop: '1px solid var(--line-1)', flexShrink: 0 }}>
                    {draft.attachments.map(file => (
                        <span
                            key={file.key}
                            title={file.error ? `${file.filename}: ${file.error}` : file.id ? file.filename : `Attaching ${file.filename}…`}
                            style={{
                                position: 'relative',
                                overflow: 'hidden',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 'var(--space-2)',
                                padding: 'var(--space-1) var(--space-2) var(--space-1) var(--space-3)',
                                border: file.error ? '1px solid var(--danger)' : '1px solid var(--line-1)',
                                borderRadius: 'var(--radius-2)',
                                background: file.error ? 'var(--danger-tint)' : 'var(--surface-1)',
                                fontSize: 'var(--size-body)'
                            }}
                        >
                            <FileIcon size={14} aria-hidden="true" />
                            <span style={{ fontWeight: 'var(--weight-medium)' }}>{file.filename}</span>
                            {file.error
                                ? <span style={{ color: 'var(--danger)', fontSize: 'var(--size-caption)' }}>{file.error}</span>
                                : <span style={{ color: 'var(--text-3)', fontSize: 'var(--size-caption)' }}>{formatSize(file.size)}</span>}
                            <Tooltip content={`Remove ${file.filename}`}>
                                <button type="button" aria-label={`Remove ${file.filename}`} onClick={() => removeAttachment(file.key)} className="em-icon-button"
                                    style={{ width: '20px', height: '20px', flexShrink: 0, padding: 0, border: 0, borderRadius: 'var(--radius-1)' /* square, radius 4 on hover (owner, Checkpoint D) */, background: 'transparent', color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                    <X size={14} aria-hidden="true" />
                                </button>
                            </Tooltip>
                            {isUploading(file) && (
                                // Upload progress; a forwarded file being copied has none to report.
                                <span aria-hidden="true" className={file.progress === undefined ? 'skeleton-bone' : undefined} style={{
                                    position: 'absolute', left: 0, bottom: 0, height: '2px', width: '100%', transformOrigin: 'left',
                                    transform: `scaleX(${file.progress === undefined ? 1 : file.progress})`,
                                    background: 'var(--action)', transition: 'transform var(--dur-base) var(--ease-in)'
                                }} />
                            )}
                        </span>
                    ))}
                </div>
            )}

            <footer style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-4)', borderTop: '1px solid var(--line-1)', flexShrink: 0 }}>
                <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={e => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = ''; // the same file can be picked again
                }} />
                <Button kind="quiet" icon={<Paperclip size={16} aria-hidden="true" />} onClick={() => fileInputRef.current?.click()}>Attach</Button>
                <IconButton label="Discard draft" icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => void discard()} />
                {/* Beside Send, in faint text (board P3, change 1): "Saving… / Saved", or why it didn't go */}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', minWidth: 0 }}>
                    {problemText ? (
                        <span role="alert" style={{ fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-medium)', color: 'var(--danger)' }}>{problemText}</span>
                    ) : status === 'failed' && !uploading && !keptLocally ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-medium)', color: 'var(--danger)', whiteSpace: 'nowrap' }}>
                            Not saved
                            <Button size="sm" onClick={retrySave}>Try again</Button>
                        </span>
                    ) : (
                        <span aria-live="polite" style={{ fontSize: 'var(--size-caption)', color: 'var(--text-4)', whiteSpace: 'nowrap' }}>{statusText}</span>
                    )}
                </span>
                <Button
                    ref={sendButtonRef}
                    kind="primary"
                    size="lg"
                    onClick={handleSend}
                    disabled={uploading}
                    // Rule A6: while it goes, or waits for the server, it says so and can't be pressed again
                    working={sending ? 'Sending…' : waiting ? 'Waits for the server' : null}
                    trailingIcon={sending || waiting ? undefined : <Send size={16} aria-hidden="true" />}
                    style={{ marginLeft: 'var(--space-2)' }}
                >
                    Send
                </Button>
            </footer>
        </section>
    );
};
