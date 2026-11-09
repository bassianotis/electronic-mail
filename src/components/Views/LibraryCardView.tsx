/**
 * The conversation view (Explore 2): its messages as a stack of cards (ConversationStack), the
 * subject in the front card, and Reply / Reply all / Forward | Archive (or Restore, when archived)
 * in a glass bar under the cards. While replying ("docked"), the cards shrink to a band above the
 * composer, with a drag bar between them. Clicking outside closes it all; the draft is saved.
 *
 * The conversation comes from the engine and is fetched again whenever the account changes,
 * so a reply arriving while it is open simply appears.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Email } from '../../store/mailStore';
import { ConversationStack } from './ConversationStack';
import { Composer } from '../Compose/Composer';
import { useMail } from '../../context/MailContext';
import { useComposer, type SentMessage } from '../../context/ComposerContext';
import { api, paths } from '../../api/client';
import { engineEvents, useAccountState, useSessionEpoch } from '../../api/events';
import { useServerUnreachable } from '../../api/reachability';
import type { DraftContent, ThreadDetail } from '../../api/types';
import { messageFromThread } from '../../utils/emailMapper';
import { FLOATING_WIDTH } from '../../utils/layout';
import type { ReplyType } from '../../utils/replyDraft';
import { Reply, ReplyAll, Forward, RotateCcw, Archive } from 'lucide-react';
import { DURATION, tween } from '../../utils/motion';

interface LibraryCardViewProps {
    /** The conversation's card (or any message of it). */
    email: Email;
    onClose: () => void;
    /** A reply draft to open in the composer (picked in Up next); otherwise the conversation's own, if any. */
    openDraft?: string;
}


/** A button in the glass bar under the cards: icon and label (1g). */
const barButton: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    height: '32px',
    padding: '0 12px',
    borderRadius: 'max(4px, calc(var(--radius-pill) - 4px))',
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--color-text-main)',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--weight-semibold)',
    cursor: 'pointer'
};

const bareId = (id: string | null | undefined) => (id ?? '').replace(/^<|>$/g, '');

// The band above the composer: 200px to start, 160px to about 70% of the height, kept for the session.
const BAND_KEY = 'em-band-height';
const BAND_MIN = 160;
const readBand = () => {
    try { return Number(sessionStorage.getItem(BAND_KEY)) || 200; } catch { return 200; }
};

export const LibraryCardView: React.FC<LibraryCardViewProps> = ({ email, onClose, openDraft }) => {
    const { activeAccountId, activeAccount, accounts, folders, drafts, markThreadSeen, moveThread, undoMove, showToast, download } = useMail();
    const accountId = activeAccountId ?? '';
    const threadId = email.threadId;
    const state = useAccountState(activeAccountId);
    const sessionEpoch = useSessionEpoch();
    const [detail, setDetail] = useState<ThreadDetail | null>(null);
    const [gone, setGone] = useState(false);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [linkCopied, setLinkCopied] = useState(false);
    // Messages just sent from here, shown until the engine has them from the Sent folder
    // ("Sending…" where the date goes while the engine still holds it; Undo takes it away.)
    const [pendingSent, setPendingSent] = useState<Array<Email & { messageId: string; itemId: string; sending: boolean }>>([]);
    const { draft, openReply, openSaved, changeType, update: updateDraft, close: closeDraft, onSent, discarding } = useComposer();
    // While the server can't be reached, what's open can be read; the bar's actions wait
    const offline = useServerUnreachable();
    // The composer is docked here while it holds a reply in this conversation.
    const isComposing = !!draft && draft.place === 'docked' && draft.original?.threadId === threadId && draft.original.accountId === accountId;
    const me = (activeAccount?.email ?? '').toLowerCase();
    const myAddresses = useMemo(() => accounts.map(a => a.email.toLowerCase()), [accounts]);
    const [band, setBand] = useState(readBand);
    const columnRef = useRef<HTMLDivElement>(null);

    /** Closes the conversation, and the draft docked in it (saved, with a notice). */
    const closeAll = useCallback(() => {
        if (isComposing) void closeDraft();
        onClose();
    }, [isComposing, closeDraft, onClose]);

    // The conversation, fetched again whenever anything in the account changes
    useEffect(() => {
        if (!activeAccountId) return;
        let current = true;
        api.get<ThreadDetail>(paths.thread(activeAccountId, threadId))
            .then(d => { if (current) setDetail(d); })
            .catch(err => {
                if (!current) return;
                if ((err as { status?: number }).status === 404) setGone(true);
                else console.error('Failed to load the conversation:', err);
            });
        return () => { current = false; };
    }, [activeAccountId, threadId, state, sessionEpoch]);

    // Newest first: index 0 is the front card
    const threadEmails: Email[] = useMemo(() => {
        const fromEngine = detail
            ? [...detail.messages].reverse().map(m => messageFromThread(m, detail.thread))
            : [{ ...email, id: email.msgKey }];
        const known = new Set(detail?.messages.map(m => bareId(m.messageId)) ?? []);
        const pending = pendingSent.filter(p => !known.has(bareId(p.messageId)));
        return [...pending, ...fromEngine];
    }, [detail, email, pendingSent]);

    const found = threadEmails.findIndex(e => e.msgKey === selectedKey);
    const selectedIndex = found >= 0 ? found : 0;
    const setSelectedIndex = useCallback((update: number | ((prev: number) => number)) => {
        const next = typeof update === 'function' ? update(selectedIndex) : update;
        const target = threadEmails[Math.max(0, Math.min(next, threadEmails.length - 1))];
        if (target) setSelectedKey(target.msgKey);
    }, [selectedIndex, threadEmails]);

    const location = detail ? detail.thread.location : email.location;
    const hasSent = detail ? detail.thread.hasSent : email.mailbox === 'Sent';
    // Sent-only conversations live in no folder: they can be answered, not restored.
    const isSentOnlyThread = !location && hasSent;
    const archiveMode = !location || location === folders.archive;

    // Opening a conversation marks it read
    const markedRef = useRef(false);
    useEffect(() => {
        if (markedRef.current) return;
        markedRef.current = true;
        if (!email.read) markThreadSeen(threadId);
    }, [email.read, threadId, markThreadSeen]);

    // Keyboard navigation for thread
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
            if (isTyping) return; // Allow typing in composer

            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                setSelectedIndex(prev => Math.min(prev + 1, threadEmails.length - 1)); // older
                e.preventDefault();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                setSelectedIndex(prev => Math.max(prev - 1, 0)); // newer
                e.preventDefault();
            } else if (e.key === 'Escape') {
                closeAll();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [threadEmails.length, setSelectedIndex, closeAll]);

    /**
     * Reply, Reply all or Forward on the message on top of the stack. With this conversation's own
     * draft in the corner, that draft comes back in instead; any other draft is saved and closed.
     */
    const startCompose = useCallback((type: ReplyType) => {
        const msg = threadEmails[selectedIndex];
        if (!msg || !activeAccountId) return;
        if (draft && draft.original?.threadId === threadId && draft.original.accountId === activeAccountId) {
            updateDraft({ place: 'docked' }, false);
            if (draft.type !== type) void changeType(type);
            return;
        }
        void openReply({ accountId: activeAccountId, threadId, email: msg, type });
    }, [threadEmails, selectedIndex, activeAccountId, threadId, openReply, draft, updateDraft, changeType]);

    /** The message a reopened reply draft answers: the newest one someone else wrote, else the newest. */
    const replyTarget = useMemo(
        () => threadEmails.find(e => e.mailbox !== 'Sent' && (e.senderAddress ?? '').toLowerCase() !== me) ?? threadEmails[0],
        [threadEmails, me],
    );

    // A reply draft waiting in this conversation opens where it was left (unless the composer
    // already holds this conversation's draft).
    const checkedDraft = useRef(false);
    useEffect(() => {
        if (checkedDraft.current || !detail || !activeAccountId) return;
        checkedDraft.current = true;
        if (draft?.original?.threadId === threadId) return;
        // (not one just discarded: its notice still offers Undo)
        const waiting = openDraft ?? drafts.find(d => d.threadId === threadId && !discarding.includes(d.msgKey))?.msgKey;
        if (!waiting) return;
        api.get<{ draft: DraftContent }>(paths.draft(activeAccountId, waiting))
            .then(({ draft: content }) => {
                // The message it answers, if it's in the conversation (for changing the reply type)
                const answeredKey = detail.messages.find(m => content.inReplyTo && bareId(m.messageId) === bareId(content.inReplyTo))?.msgKey;
                const answered = threadEmails.find(e => e.msgKey === answeredKey) ?? replyTarget;
                return openSaved({ accountId: activeAccountId, content, threadId, email: answered });
            })
            .catch(err => console.error('Could not open the draft:', err));
    }, [detail, drafts, threadId, activeAccountId, replyTarget, openDraft, draft, threadEmails, openSaved, discarding]);

    const addPending = useCallback((sent: SentMessage) => {
        const { item, subject, html, text } = sent;
        setPendingSent(prev => [{
            id: `pending-${item.messageId}`,
            messageId: item.messageId,
            itemId: item.id,
            sending: true,
            threadId,
            msgKey: `pending-${item.messageId}`,
            sender: sent.from.name || 'Me',
            senderAddress: sent.from.address,
            subject,
            preview: text.substring(0, 100),
            body: html,
            date: new Date(),
            read: true,
            location,
            mailbox: 'Sent',
            to: sent.to.map(a => ({ name: a.name ?? undefined, address: a.address })),
            cc: sent.cc.map(a => ({ name: a.name ?? undefined, address: a.address })),
        }, ...prev]);
        setSelectedKey(null); // the front card: what was just sent
    }, [threadId, location]);

    // What the composer sends in this conversation shows as its front card at once; Undo takes it
    // away again, and once it has gone out its date replaces "Sending…". Sent from another account
    // (From changed), its copy goes to that account's Sent and never joins this conversation, so
    // it isn't shown here.
    useEffect(() => onSent((sent: SentMessage) => {
        if (sent.threadId !== threadId || sent.accountId !== accountId || sent.fromAccountId !== accountId) return;
        if (sent.kind === 'sent') addPending(sent);
        else setPendingSent(prev => prev.filter(p => p.itemId !== sent.item.id));
    }), [onSent, threadId, accountId, addPending]);
    useEffect(() => engineEvents.onOutbox(e => {
        if (e.status !== 'sent' && e.status !== 'saved') return;
        setPendingSent(prev => prev.map(p => (p.itemId === e.id && p.sending ? { ...p, sending: false, date: new Date() } : p)));
    }), []);
    const sendingLabel = useCallback((e: Email) => (pendingSent.some(p => p.msgKey === e.msgKey && p.sending) ? 'Sending…' : undefined), [pendingSent]);

    // The drag bar between the band and the composer
    const resizeBand = (height: number) => {
        const max = (columnRef.current?.clientHeight ?? 800) * 0.7;
        const next = Math.round(Math.max(BAND_MIN, Math.min(max, height)));
        setBand(next);
        try { sessionStorage.setItem(BAND_KEY, String(next)); } catch { /* private window: this page only */ }
    };
    const startDrag = (e: React.PointerEvent) => {
        e.preventDefault();
        const startY = e.clientY, startHeight = band;
        const move = (ev: PointerEvent) => resizeBand(startHeight + ev.clientY - startY);
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    const copyLink = () => {
        const url = `${window.location.origin}/?thread=${encodeURIComponent(threadId)}`;
        navigator.clipboard.writeText(url).then(() => {
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        }).catch(err => {
            console.error('Failed to copy link:', err);
        });
    };

    const handleRestore = async () => {
        onClose();
        const taskId = await moveThread(threadId, 'inbox');
        if (taskId !== null) {
            showToast({ message: <>Restored to <strong>Inbox</strong></>, actions: [{ label: 'Undo', onClick: () => void undoMove(taskId) }] });
        }
    };

    // As dragging it to the Archive tile; a draft for it in the corner stays there.
    const handleArchive = async () => {
        onClose();
        const taskId = await moveThread(threadId, 'archive');
        if (taskId !== null) {
            showToast({ message: 'Archived', actions: [{ label: 'Undo', onClick: () => void undoMove(taskId) }] });
        }
    };

    const subject = detail?.thread.subject || email.subject;

    if (gone) {
        return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--overlay-scrim)', backdropFilter: 'blur(var(--blur-overlay))' }} onClick={onClose}>
                <div style={{ backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl)', boxShadow: 'var(--shadow-lg)' }}>
                    This conversation is no longer in your mailbox.
                </div>
            </div>
        );
    }

    return (
        <div style={{ position: 'fixed', inset: 0, top: 'var(--server-banner)', zIndex: 200 }}>
            {/* Backdrop: clicking outside the cards closes the conversation */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={closeAll}
                style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'var(--overlay-scrim)',
                    backdropFilter: 'blur(var(--blur-overlay))'
                }}
            />

            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', justifyContent: 'center', padding: '16px 24px 20px' }}>
                <div ref={columnRef} style={{ width: FLOATING_WIDTH, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {/* The cards (a band above the composer while replying) */}
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...tween(DURATION.slow), opacity: tween(DURATION.fast) }}
                        style={{ flex: isComposing ? `0 0 ${band}px` : 1, minHeight: 0, paddingTop: '20px', boxSizing: 'border-box' }}
                    >
                        <ConversationStack
                            accountId={accountId}
                            emails={threadEmails}
                            selectedIndex={selectedIndex}
                            onSelect={setSelectedIndex}
                            subject={subject}
                            compact={isComposing}
                            myAddresses={myAddresses}
                            linkCopied={linkCopied}
                            onCopyLink={copyLink}
                            onDownload={download}
                            dateLabel={sendingLabel}
                        />
                    </motion.div>

                    {isComposing ? (
                        <>
                            {/* The drag bar: drag to resize the band, or the arrow keys */}
                            <div style={{ flex: '0 0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <button
                                    type="button"
                                    title="Drag to resize"
                                    aria-label="Resize: drag, or use the arrow keys"
                                    onPointerDown={startDrag}
                                    onKeyDown={e => {
                                        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                                        e.preventDefault();
                                        e.stopPropagation(); // not the cards' arrow keys
                                        resizeBand(band + (e.key === 'ArrowDown' ? 20 : -20));
                                    }}
                                    style={{ pointerEvents: 'auto', width: '64px', height: '16px', border: 0, padding: 0, background: 'transparent', cursor: 'row-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}
                                >
                                    <span aria-hidden="true" style={{ display: 'block', width: '40px', height: '4px', borderRadius: 'var(--radius-full)', background: 'var(--drag-handle)', boxShadow: 'var(--drag-handle-shadow)' }} />
                                </button>
                            </div>
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={tween(DURATION.slow)}
                                style={{
                                    flex: 1,
                                    minHeight: 0,
                                    pointerEvents: 'auto',
                                    borderRadius: 'var(--radius-lg)',
                                    boxShadow: 'var(--shadow-panel)',
                                    border: '1px solid var(--border-strong)',
                                    overflow: 'hidden'
                                }}
                            >
                                <Composer />
                            </motion.div>
                        </>
                    ) : (
                        /* The bar under the cards: Reply, Reply all, Forward | Archive; Restore when archived */
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px', flexShrink: 0 }}>
                            <div style={{
                                pointerEvents: 'auto',
                                display: 'flex',
                                gap: '2px',
                                padding: '4px',
                                borderRadius: 'var(--radius-pill)',
                                background: 'var(--bar-bg)',
                                border: '1px solid var(--glass-border)',
                                boxShadow: 'var(--shadow-sm)',
                                backdropFilter: 'blur(var(--blur-control))',
                                WebkitBackdropFilter: 'blur(var(--blur-control))'
                            }}>
                                {archiveMode && !isSentOnlyThread ? (
                                    <button type="button" className="em-pill-button" onClick={() => void handleRestore()} title="Restore" style={barButton}>
                                        <RotateCcw size={16} aria-hidden="true" />Restore
                                    </button>
                                ) : (
                                    <>
                                        <button type="button" className="em-pill-button needs-server" disabled={offline} onClick={() => startCompose('reply')} title="Reply" style={barButton}>
                                            <Reply size={16} aria-hidden="true" />Reply
                                        </button>
                                        <button type="button" className="em-pill-button needs-server" disabled={offline} onClick={() => startCompose('replyAll')} title="Reply all" style={barButton}>
                                            <ReplyAll size={16} aria-hidden="true" />Reply all
                                        </button>
                                        <button type="button" className="em-pill-button needs-server" disabled={offline} onClick={() => startCompose('forward')} title="Forward" style={barButton}>
                                            <Forward size={16} aria-hidden="true" />Forward
                                        </button>
                                        {/* In the Inbox or a bucket (a sent-only conversation can't be archived) */}
                                        {!archiveMode && (
                                            <>
                                                <span aria-hidden="true" style={{ width: '1px', margin: '4px 4px', background: 'var(--border-strong)' }} />
                                                <button type="button" className="em-pill-button needs-server" disabled={offline} onClick={() => void handleArchive()} title="Archive" style={barButton}>
                                                    <Archive size={16} aria-hidden="true" />Archive
                                                </button>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

