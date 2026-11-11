/**
 * The conversation view (Explore 2): its messages as a stack of cards (ConversationStack), the
 * subject in the front card, and Reply / Reply all / Forward | Archive (or Restore, when archived)
 * in a glass bar under the cards. While replying ("docked"), the cards shrink to a band above the
 * composer, with a drag bar between them. Clicking outside closes it all; the draft is saved.
 *
 * Finding your way (docs/design/reading-navigation-spec.md): the thread as a tree in a panel to the
 * right (open or closed is remembered), previous / next conversation in a pill at the bottom right
 * (in the list it was opened from), Archive moving on to the next one, and a reply tied to the
 * message it answers while you look at others.
 *
 * The conversation comes from the engine and is fetched again whenever the account changes,
 * so a reply arriving while it is open simply appears.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Email } from '../../store/mailStore';
import { ConversationStack } from './ConversationStack';
import { ThreadTree } from './ThreadTree';
import { useConversationList, type ListKey } from '../../hooks/conversationLists';
import { cachedThread, prefetchThread, rememberThread } from '../../api/threads';
import { formatDate } from '../../utils/formatDate';
import { Composer } from '../Compose/Composer';
import { useMail } from '../../context/MailContext';
import { useComposer, type SentMessage } from '../../context/ComposerContext';
import { api, paths } from '../../api/client';
import { engineEvents, useAccountState, useSessionEpoch } from '../../api/events';
import { useServerUnreachable } from '../../api/reachability';
import type { DraftContent, ThreadDetail } from '../../api/types';
import { cardFromThread, messageFromThread } from '../../utils/emailMapper';
import { FLOATING_WIDTH } from '../../utils/layout';
import type { ReplyType } from '../../utils/replyDraft';
import { Reply, ReplyAll, Forward, RotateCcw, Archive, ChevronLeft, ChevronRight } from 'lucide-react';
import { DURATION, tween } from '../../utils/motion';

interface LibraryCardViewProps {
    /** The conversation's card (or any message of it). */
    email: Email;
    onClose: () => void;
    /** A reply draft to open in the composer (picked in Up next); otherwise the conversation's own, if any. */
    openDraft?: string;
    /** The list it was opened from: previous / next and Archive follow it. */
    list?: ListKey;
    /** Opens another conversation (previous / next, or the next one after Archive). */
    onOpen: (email: Email, list?: ListKey) => void;
    /** Reached from another conversation (previous / next, Archive moving on): no entrance, the layer was already there. */
    switched?: boolean;
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

// The thread tree, open or closed, remembered across conversations in this browser; closed at first.
const TREE_KEY = 'em-thread-tree';
const readTree = () => {
    try { return localStorage.getItem(TREE_KEY) === 'open'; } catch { return false; }
};

export const LibraryCardView: React.FC<LibraryCardViewProps> = ({ email, onClose, openDraft, list: listKey, onOpen, switched }) => {
    const { activeAccountId, activeAccount, accounts, folders, drafts, markThreadSeen, moveThread, undoMove, showToast, download } = useMail();
    const accountId = activeAccountId ?? '';
    const threadId = email.threadId;
    const state = useAccountState(activeAccountId);
    const sessionEpoch = useSessionEpoch();
    // A conversation fetched ahead (previous / next) shows at once; it's fetched again regardless
    const [detail, setDetail] = useState<ThreadDetail | null>(() => cachedThread(activeAccountId, threadId));
    const [gone, setGone] = useState(false);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [linkCopied, setLinkCopied] = useState(false);
    // Messages just sent from here, shown until the engine has them from the Sent folder
    // ("Sending…" where the date goes while the engine still holds it; Undo takes it away.)
    const [pendingSent, setPendingSent] = useState<Array<Email & { messageId: string; itemId: string; sending: boolean }>>([]);
    const { draft, openReply, openSaved, changeType, retarget, update: updateDraft, close: closeDraft, onSent, discarding } = useComposer();
    // While the server can't be reached, what's open can be read; the bar's actions wait
    const offline = useServerUnreachable();
    // The composer is docked here while it holds a reply in this conversation.
    const isComposing = !!draft && draft.place === 'docked' && draft.original?.threadId === threadId && draft.original.accountId === accountId;
    const me = (activeAccount?.email ?? '').toLowerCase();
    const myAddresses = useMemo(() => accounts.map(a => a.email.toLowerCase()), [accounts]);
    const [band, setBand] = useState(readBand);
    const columnRef = useRef<HTMLDivElement>(null);
    const [treeOpen, setTreeOpen] = useState(readTree);
    const toggleTree = useCallback(() => setTreeOpen(open => {
        try { localStorage.setItem(TREE_KEY, open ? 'closed' : 'open'); } catch { /* private window: this page only */ }
        return !open;
    }), []);
    const isMine = useCallback((e: Email) => e.mailbox === 'Sent' || myAddresses.includes((e.senderAddress ?? '').toLowerCase()), [myAddresses]);

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
            .then(d => {
                rememberThread(activeAccountId, threadId, d);
                if (current) setDetail(d);
            })
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
    // A step is worked out from the selection as React applies it, not as it was when this was last
    // drawn: quick presses in a row each count, however soon after one another they come
    const setSelectedIndex = useCallback((update: number | ((prev: number) => number)) => {
        setSelectedKey(prevKey => {
            const at = prevKey ? threadEmails.findIndex(e => e.msgKey === prevKey) : -1;
            const prev = at >= 0 ? at : 0;
            const next = typeof update === 'function' ? update(prev) : update;
            return threadEmails[Math.max(0, Math.min(next, threadEmails.length - 1))]?.msgKey ?? prevKey;
        });
    }, [threadEmails]);
    // The message on screen: it trails the one asked for (selectedKey) by the moment it takes to
    // draw. The tree, the band's note and Reply follow it, as the card's counter does.
    const [shownKey, setShownKey] = useState<string | null>(null);
    const shownAt = shownKey ? threadEmails.findIndex(e => e.msgKey === shownKey) : -1;
    const shownIndex = shownAt >= 0 ? shownAt : selectedIndex;
    const selected = threadEmails[shownIndex];

    // The message a reply (or forward) docked here answers: the band opens on it, and the reply
    // stays tied to it while you look at others (reading-navigation-spec.md §6).
    const targetKey = isComposing ? draft?.original?.email?.msgKey ?? null : null;
    const [followedTarget, setFollowedTarget] = useState<string | null>(null);
    if (targetKey !== followedTarget) {
        setFollowedTarget(targetKey);
        if (targetKey) setSelectedKey(targetKey);
    }
    const target = targetKey ? threadEmails.find(e => e.msgKey === targetKey) : undefined;
    const forwarding = draft?.type === 'forward';
    const who = useCallback((e: Email) => (isMine(e) ? 'Me' : e.sender), [isMine]);

    // Previous / next, in the list it was opened from (§7). If the list changes while it's open
    // (new mail, a rule, Archive elsewhere), it keeps its place and the position is counted again.
    const convList = useConversationList(listKey);
    const at = convList ? convList.cards.findIndex(c => c.threadId === threadId) : -1;
    const [lastAt, setLastAt] = useState(-1);
    if (at >= 0 && at !== lastAt) setLastAt(at);
    const place = at >= 0 ? at : lastAt;
    const prevCard = convList && place > 0 ? convList.cards[place - 1] ?? null : null;
    const nextCard = convList && place >= 0 ? convList.cards[at >= 0 ? at + 1 : place] ?? null : null;
    // A list that loads as you scroll fetches more as you reach its end
    const loadMore = convList?.hasMore && at >= 0 && at >= convList.cards.length - 2 ? convList.loadMore : undefined;
    useEffect(() => { loadMore?.(); }, [loadMore]);
    // The conversations either side are fetched ahead, so moving to one shows it at once
    const prevId = prevCard?.threadId, nextId = nextCard?.threadId;
    useEffect(() => {
        if (!activeAccountId) return;
        for (const id of [prevId, nextId]) if (id) prefetchThread(activeAccountId, id);
    }, [activeAccountId, prevId, nextId]);

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

    // The arrow keys, the one exception to "⌘↩ only" (owner, 2026-11-10): ↑ / ↓ the older / newer
    // message, like the header's arrows; ← / → the previous / next conversation in the list it was
    // opened from, like the pill. None of them while typing in a field or replying, and ← / → only
    // with a list. Esc closes.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                closeAll();
                return;
            }
            const target = e.target as HTMLElement;
            const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
            if (isTyping || isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
            if (e.key === 'ArrowUp') {
                setSelectedIndex(prev => Math.min(prev + 1, threadEmails.length - 1)); // older
                e.preventDefault();
            } else if (e.key === 'ArrowDown') {
                setSelectedIndex(prev => Math.max(prev - 1, 0)); // newer
                e.preventDefault();
            } else if (e.key === 'ArrowLeft' && prevCard) {
                e.preventDefault();
                onOpen(prevCard, listKey);
            } else if (e.key === 'ArrowRight' && nextCard) {
                e.preventDefault();
                onOpen(nextCard, listKey);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [threadEmails.length, setSelectedIndex, closeAll, isComposing, prevCard, nextCard, onOpen, listKey]);

    /**
     * Reply, Reply all or Forward on the message on top of the stack. With this conversation's own
     * draft in the corner, that draft comes back in instead; any other draft is saved and closed.
     */
    const startCompose = useCallback((type: ReplyType) => {
        const msg = threadEmails[shownIndex];
        if (!msg || !activeAccountId) return;
        if (draft && draft.original?.threadId === threadId && draft.original.accountId === activeAccountId) {
            updateDraft({ place: 'docked' }, false);
            if (draft.type !== type) void changeType(type);
            return;
        }
        void openReply({ accountId: activeAccountId, threadId, email: msg, type });
    }, [threadEmails, shownIndex, activeAccountId, threadId, openReply, draft, updateDraft, changeType]);

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
                const answeredKey = detail.messages.find(m => (content.inReplyTo && bareId(m.messageId) === bareId(content.inReplyTo))
                    || (content.forwardOf && bareId(m.messageId) === content.forwardOf))?.msgKey;
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
            parentKey: sent.targetKey, // under the message it answers in the tree, until the engine has it
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

    // Back to the Inbox, then on to the next conversation in the list, as Archive does (owner,
    // 2026-11-10). Undo puts it back and opens it.
    const handleRestore = async () => {
        const moveOn = nextCard ?? prevCard;
        const here = detail ? cardFromThread(detail.thread) : email;
        if (moveOn) onOpen(moveOn, listKey);
        else onClose();
        const taskId = await moveThread(threadId, 'inbox');
        if (taskId !== null) {
            showToast({ message: <>Restored to <strong>Inbox</strong></>, actions: [{ label: 'Undo', onClick: () => { void undoMove(taskId); onOpen(here, listKey); } }] });
        }
    };

    // As dragging it to the Archive tile, then on to the next conversation in the list (at its end,
    // the one before; with none left, it closes). Undo brings it back and opens it. A draft for it
    // in the corner stays there.
    const handleArchive = async () => {
        const moveOn = nextCard ?? prevCard;
        const here = detail ? cardFromThread(detail.thread) : email;
        if (moveOn) onOpen(moveOn, listKey);
        else onClose();
        const taskId = await moveThread(threadId, 'archive');
        if (taskId !== null) {
            showToast({ message: 'Archived', actions: [{ label: 'Undo', onClick: () => { void undoMove(taskId); onOpen(here, listKey); } }] });
        }
    };

    /** "Reply to this one instead": the draft follows the message on the band (§6). */
    const replyInstead = async () => {
        if (!selected || selected.msgKey.startsWith('pending-')) return;
        const undo = await retarget(selected);
        if (!undo) return;
        showToast({
            message: `Now ${forwarding ? 'forwarding' : 'replying to'} ${who(selected)}, ${formatDate(selected.date)}`,
            actions: [{ label: 'Undo', onClick: undo }],
        });
    };

    // While the band shows another message than the one being answered
    const bandNote = isComposing && target && selected && selected.msgKey !== target.msgKey ? (
        <div className="em-band-note" role="status">
            <span style={{ marginRight: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {forwarding ? 'Not the message you\u2019re forwarding' : 'Not the message you\u2019re replying to'}
            </span>
            <button type="button" onClick={() => setSelectedKey(target.msgKey)}>
                {isMine(target) ? 'Back to your message' : `Back to ${target.sender}\u2019s message`}
            </button>
            {!selected.msgKey.startsWith('pending-') && (
                <button type="button" onClick={() => void replyInstead()}>
                    {forwarding ? 'Forward this one instead' : 'Reply to this one instead'}
                </button>
            )}
        </div>
    ) : undefined;

    const timeOrder = useMemo(() => [...threadEmails].reverse(), [threadEmails]);
    // Decided from the card's own count, so the tree is there from the start (skeleton rows until
    // the conversation arrives) and the card doesn't narrow a moment later (motion-audit.md, a)
    const expected = detail ? threadEmails.length : Math.max(threadEmails.length, email.threadCount ?? 1);
    const showTree = treeOpen && expected > 1;

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
        <div className="reading-layer" style={{ position: 'fixed', inset: 0, top: 'var(--server-banner)', zIndex: 200 }}>
            {/* Backdrop: clicking outside the cards closes the conversation */}
            <motion.div
                initial={switched ? false : { opacity: 0 }}
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
                    {/* The card (or the band and the composer), and the thread tree to its right; the
                        reading layer keeps its width, so the card narrows while the tree is open */}
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '12px' }}>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                            {/* The cards (a band above the composer while replying); room above for the edges */}
                            <motion.div
                                initial={switched ? false : { opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ ...tween(DURATION.slow), opacity: tween(DURATION.fast) }}
                                style={{ flex: isComposing ? `0 0 ${band}px` : 1, minHeight: 0, paddingTop: '22px', boxSizing: 'border-box' }}
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
                                    treeOpen={showTree}
                                    onToggleTree={toggleTree}
                                    expectedCount={expected}
                                    shownIndex={shownIndex}
                                    onShown={setShownKey}
                                    isMine={isMine}
                                    bandNote={bandNote}
                                />
                            </motion.div>

                            {isComposing && (
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
                                        <Composer onShowTarget={target ? () => setSelectedKey(target.msgKey) : undefined} />
                                    </motion.div>
                                </>
                            )}
                        </div>

                        {/* The thread as a tree: the same top and bottom as the card */}
                        {showTree && (
                            <div style={{ display: 'flex', paddingTop: '22px', boxSizing: 'border-box', minHeight: 0 }}>
                                <ThreadTree
                                    messages={timeOrder}
                                    currentKey={selected?.msgKey}
                                    onOpen={setSelectedKey}
                                    isMine={isMine}
                                    draft={isComposing && targetKey ? { under: targetKey, text: draft?.body ?? '' } : null}
                                    loading={detail ? 0 : expected}
                                />
                            </div>
                        )}
                    </div>

                    {/* Under it: the bar, centred, and previous / next at the right. Not while replying:
                        the composer has the room (owner, 2026-11-10). */}
                    {!isComposing && (
                    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginTop: '12px', minHeight: convList && place >= 0 ? '42px' : undefined, flexShrink: 0 }}>
                        {/* Reply, Reply all, Forward | Archive; Restore when archived */}
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

                        {/* Previous / next conversation, with the subject on hover */}
                        {convList && place >= 0 && (
                            <div className="em-conv-pill" style={{ position: 'absolute', right: 0, top: 0, pointerEvents: 'auto' }}>
                                <button
                                    type="button"
                                    disabled={!prevCard}
                                    aria-label={prevCard ? `Previous conversation: ${prevCard.subject}` : 'Previous conversation'}
                                    onClick={() => { if (prevCard) onOpen(prevCard, listKey); }}
                                >
                                    <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
                                    {prevCard && <span className="em-tip" style={{ right: '-40px' }}><i>Previous</i>{prevCard.subject}</span>}
                                </button>
                                {at >= 0 && (
                                    <span style={{ padding: '0 4px', fontSize: '13px', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                        {at + 1} of {convList.total}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    disabled={!nextCard}
                                    aria-label={nextCard ? `Next conversation: ${nextCard.subject}` : 'Next conversation'}
                                    onClick={() => { if (nextCard) onOpen(nextCard, listKey); }}
                                >
                                    <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
                                    {nextCard && <span className="em-tip" style={{ right: 0 }}><i>Next</i>{nextCard.subject}</span>}
                                </button>
                            </div>
                        )}
                    </div>
                    )}
                </div>
            </div>
        </div>
    );
};

