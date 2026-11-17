/**
 * One message inside the conversation view (Explore 2): in the reading view the conversation's
 * subject (with "4 of 9", up / down and the thread toggle at its right), then a header (sender,
 * "to Dana, Theo, me" and an arrow that opens every address, the date, copy link), the body
 * ("Replying to …" above it when it answers an earlier message), its attachments, and the
 * Reader or Original and text size controls. In the band above the composer it's the header
 * (the same controls at its right end) and the body only. Without notes and due dates (D19, D20).
 *
 * The body is on paper (designed mail, with Reader) or in the theme (the rest, stripped of its
 * look, with Original when there was one to strip): docs/design/reading-view-spec.md.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronUp, CornerUpLeft, Download, Link2, ListTree, Palette } from 'lucide-react';
import type { EmailAddress as Address } from '../../store/mailStore';
import type { Email } from '../../store/mailStore';
import { useMessageBody } from '../../api/bodies';
import { urls } from '../../api/client';
import { withBody } from '../../utils/emailMapper';
import { extractReaderContent } from '../../utils/emailUtils';
import { sanitizeHtml, sanitizeReaderHtml } from '../../utils/sanitize';
import { MailFrame } from './MailFrame';
import { ImagesStrip } from './ImagesStrip';
import { cssIsOutside, prepareBody } from '../../utils/remoteImages';
import { useRemoteImages } from '../../hooks/useRemoteImages';
import { fontFaces, showsOnPaper, stripToTheme } from '../../utils/mailLook';
import { splitQuotedContent } from '../../utils/quotes';
import { formatDateTime, formatFullDateTime } from '../../utils/formatDate';
import { BodyFailure, BodySkeleton } from '../Loading/Skeletons';
import { formatCount, formatSize } from '../../utils/format';
import { Button, ButtonPair, IconButton } from '../../ui/Button';
import { Segmented } from '../../ui/Choice';
import { Tooltip } from '../../ui/Tooltip';

interface MessageCardProps {
    accountId: string;
    email: Email;
    /** Fetch the body (cards far back in the stack wait until they come forward). */
    load: boolean;
    /** Called with the message once its body is known (for replying). */
    onLoaded?: (email: Email) => void;
    /** Saves an attachment (MailContext's `download`, so a lapsed session leads to the login screen). */
    onDownload: (url: string, fallbackName: string) => void;
    /** The conversation's subject, at the top of the card (reading view; the band shows none). */
    subject?: string;
    /** In the band above the composer: the header and body only, no Reader or text size. */
    compact?: boolean;
    /** Every address of yours (all accounts): they read "me", and your own messages "Me". */
    myAddresses: string[];
    /** Shown where a message's date goes (one being sent). */
    dateLabel?: (email: Email) => string | undefined;
    /** The copy-link button in the header (the card in front). */
    linkCopied?: boolean;
    onCopyLink?: () => void;
    /** Older / newer, in the card's top right (a conversation of more than one message). */
    nav?: ThreadNavProps;
    /** "Replying to Theo Park, Oct 28" at the top of a message's body, when it answers one that isn't the one just before. */
    replyingTo?: (email: Email) => { label: string; onOpen: () => void } | undefined;
    /** Original is on for this conversation (ConversationStack): each message that has one shows it. */
    showOriginal: boolean;
    onShowOriginal: (on: boolean) => void;
    /** A swipe has just moved on: the message doesn't scroll until it ends (ConversationStack). */
    scrollHeld?: boolean;
    /** The messages either side of the one asked for: drawn out of sight ahead, so a step to one is instant. */
    warm?: Email[];
    /** The message on screen changed (at the swap): the card's counter and the tree follow it, in the same frame. */
    onShown?: (msgKey: string) => void;
}

interface ThreadNavProps {
    /** Where the open message is, in time order: "4 of 9". */
    position: number;
    total: number;
    /** The rest of the conversation is still on its way: the arrows wait. */
    arriving?: boolean;
    onOlder: () => void;
    onNewer: () => void;
    /** The thread tree beside the card. */
    treeOpen: boolean;
    onToggleTree: () => void;
}

/**
 * "4 of 9", then up / down side by side (up is the older message), then the thread tree's toggle
 * (docs/design/reading-navigation-spec.md §1). Shown only for a conversation of more than one message.
 */
const ThreadNav: React.FC<ThreadNavProps> = ({ position, total, arriving, onOlder, onNewer, treeOpen, onToggleTree }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        <span aria-live="polite" style={{ fontSize: 'var(--size-small)', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {position} of {total}
        </span>
        {/* The shared pair: its focus ring drawn inside, so the group never clips it (board P2, change 1) */}
        <ButtonPair label="Older and newer messages">
            <IconButton kind="secondary" label="Older message" keys="↑" icon={<ChevronUp size={14} aria-hidden="true" />}
                disabled={arriving || position <= 1} onClick={e => { e.stopPropagation(); onOlder(); }} />
            <IconButton kind="secondary" label="Newer message" keys="↓" icon={<ChevronDown size={14} aria-hidden="true" />}
                disabled={arriving || position >= total} onClick={e => { e.stopPropagation(); onNewer(); }} />
        </ButtonPair>
        <IconButton
            kind="secondary"
            size={36}
            className="em-tree-toggle"
            aria-expanded={treeOpen}
            label={treeOpen ? 'Hide the thread' : 'Show the thread'}
            icon={<ListTree size={14} aria-hidden="true" />}
            onClick={e => { e.stopPropagation(); onToggleTree(); }}
        />
    </div>
);

/** The text sizes a message can be read at (1.0 is the default). */
const ZOOMS = [0.9, 1.0, 1.1, 1.2];

const formatAddress = (r: { name?: string | null; address: string }) =>
    r.name && r.name !== r.address ? `${r.name} <${r.address}>` : r.address;

/** "Dana" from "Dana Whitfield", "Smith, Jo" or "\"Dana W.\"": the first name, else the address. */
const firstName = (a: Address) => {
    const name = (a.name ?? '').replace(/["']/g, '').trim();
    if (!name || name.includes('@')) return a.address;
    const given = name.includes(',') ? name.split(',')[1]?.trim() || name : name;
    return given.split(/\s+/)[0];
};

/** "to Dana, Theo, me", from the message's own To and Cc (known once its body has loaded). */
const recipientsLine = (to: Address[], cc: Address[], mine: (address: string) => boolean): string | null => {
    const all = [...to, ...cc];
    if (!all.length) return null;
    const names = [...new Set(all.filter(a => !mine(a.address)).map(firstName))];
    if (all.some(a => mine(a.address))) names.push('me');
    return `to ${names.join(', ')}`;
};

/** What a message's layer tells the card about it: for Reader / Original, and the colours. */
interface Look {
    paper: boolean;
    canOriginal: boolean;
    /** Its body is in (Reader and Original show only then). */
    ready: boolean;
}
const NO_LOOK: Look = { paper: false, canOriginal: false, ready: false };

/** A message asked for that still isn't drawn after this long is shown anyway (loading). */
const SWAP_WAIT_MS = 1500;

/**
 * Stepping between messages: an instant swap, one step, one swap (the standing decision of
 * 2026-11-10; the owner tried a 100ms crossfade at Checkpoint B and couldn't see it, so it's 0).
 * Set above 0, the message arriving crossfades over the one left, only ever between two fully drawn
 * messages (the one left stays drawn as it was until the fade ends); instant while a key is held, or
 * when a step comes while one is still fading. Nothing else changes.
 */
const FLIP_CROSSFADE_MS = 0;

export const MessageCard: React.FC<MessageCardProps> = React.memo(({
    accountId, email: base, load, onLoaded, onDownload, subject, compact, myAddresses, dateLabel, linkCopied, onCopyLink, nav, replyingTo, showOriginal, onShowOriginal, scrollHeld, warm, onShown,
}) => {
    // One step, one swap (owner, 2026-11-10): the message on screen stays until the one asked for
    // has been drawn underneath it; then the top one goes, so its header and body change together,
    // at once, already drawn. A message passed over in a quick run of steps is never shown.
    const [displayed, setDisplayed] = useState<Email>(base);
    const showing = displayed.msgKey === base.msgKey ? base : displayed;
    const incoming = displayed.msgKey === base.msgKey ? null : base;
    // The new neighbours start drawing just after a step has been painted, not in the same frame:
    // that frame should only swap
    const [warmNow, setWarmNow] = useState<Email[]>([]);
    useEffect(() => {
        let timer: number | undefined;
        const frame = requestAnimationFrame(() => { timer = window.setTimeout(() => setWarmNow(warm ?? []), 0); });
        return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
    }, [warm]);
    // The crossfade (FLIP_CROSSFADE_MS): the message left, kept drawn exactly as it was on screen
    // (its Reader and text size too) just under the one arriving, which fades in over it
    const [leaving, setLeaving] = useState<{ email: Email; readerOn: boolean; zoomLevel: number } | null>(null);
    const [fadingIn, setFadingIn] = useState<string | null>(null);
    const fading = useRef(false);
    const onScreen = useRef({ email: showing, readerOn: false, zoomLevel: 1.0 });
    // A key held down (its repeats) steps instantly
    const keyHeld = useRef(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => { keyHeld.current = e.repeat; };
        const up = () => { keyHeld.current = false; };
        window.addEventListener('keydown', down, true);
        window.addEventListener('keyup', up, true);
        return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
    }, []);
    const fadeDone = useCallback(() => {
        fading.current = false;
        setLeaving(null);
        setFadingIn(null);
    }, []);
    /** `drawn`: the message arriving is fully drawn (its body is in its frame), so it may fade in. */
    const swap = useCallback((email: Email, drawn = false) => {
        const was = onScreen.current;
        const fade = FLIP_CROSSFADE_MS > 0 && drawn && !keyHeld.current && !fading.current && was.email.msgKey !== email.msgKey;
        setDisplayed(email);
        onShown?.(email.msgKey); // same render: the counter, the tree and the body change together
        fading.current = fade;
        setLeaving(fade ? was : null);
        setFadingIn(fade ? email.msgKey : null);
    }, [onShown]);
    useEffect(() => {
        if (!incoming) return;
        const timer = setTimeout(() => swap(incoming), SWAP_WAIT_MS);
        return () => clearTimeout(timer);
    }, [incoming, swap]);
    // In case the fade's end is never heard (a hidden tab runs no animations)
    useEffect(() => {
        if (!fadingIn) return;
        const timer = setTimeout(fadeDone, FLIP_CROSSFADE_MS + 200);
        return () => clearTimeout(timer);
    }, [fadingIn, fadeDone]);

    // Reader (paper mail) and the text size belong to the message on screen, never remembered;
    // Original (theme mail with a look of its own) stays on through the conversation.
    const [readerOn, setReaderOn] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(1.0);
    const [shownKey, setShownKey] = useState(showing.msgKey);
    if (shownKey !== showing.msgKey) {
        setShownKey(showing.msgKey);
        setReaderOn(false);
        setZoomLevel(1.0);
    }
    // The body's height, so the next message's frame starts there rather than at its minimum
    const [frameHeight, setFrameHeight] = useState(200);
    const [looks, setLooks] = useState<Record<string, Look>>({});
    const report = useCallback((key: string, next: Look) => setLooks(all => {
        const was = all[key];
        return was && was.paper === next.paper && was.canOriginal === next.canOriginal && was.ready === next.ready ? all : { ...all, [key]: next };
    }), []);
    const look = looks[showing.msgKey] ?? NO_LOOK;
    const readerMode = readerOn && look.paper;
    const originalMode = showOriginal && look.canOriginal;
    const strong = readerMode ? 'var(--text-2)' : 'var(--text-1)';
    // What's on screen, for the next swap (the layers' own layout effects call it)
    useLayoutEffect(() => { onScreen.current = { email: showing, readerOn, zoomLevel }; });

    const layer = (email: Email, top: boolean, asked: boolean) => {
        const left = !top && leaving?.email.msgKey === email.msgKey ? leaving : null;
        return (
            <MessageLayer
                key={email.msgKey}
                top={top}
                leaving={!!left}
                fadeIn={top && fadingIn === email.msgKey ? FLIP_CROSSFADE_MS : 0}
                onFadeEnd={top && fadingIn === email.msgKey ? fadeDone : undefined}
                accountId={accountId}
                email={email}
                // A message still being sent has no body on the server yet (it can be the one on top
                // while the sent copy that replaces it is drawn underneath)
                load={load && !email.msgKey.startsWith('pending-')}
                onLoaded={onLoaded}
                onDownload={onDownload}
                compact={compact}
                hasSubject={subject !== undefined}
                myAddresses={myAddresses}
                dateLabel={dateLabel?.(email)}
                linkCopied={linkCopied}
                onCopyLink={onCopyLink}
                nav={compact ? nav : undefined}
                replyingTo={replyingTo?.(email)}
                readerOn={top ? readerOn : !!left?.readerOn}
                zoomLevel={top ? zoomLevel : left ? left.zoomLevel : 1.0}
                showOriginal={showOriginal}
                scrollHeld={scrollHeld}
                startHeight={frameHeight}
                onHeight={top ? setFrameHeight : undefined}
                onLook={report}
                onReady={asked && !top ? swap : undefined}
            />
        );
    };

    return (
        <div
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                backgroundColor: readerMode ? 'var(--surface-1)' : 'var(--surface-raised)',
                overflow: 'hidden',
                color: readerMode ? 'var(--text-2)' : 'inherit',
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            {subject !== undefined && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: '48px', padding: 'var(--space-3) var(--space-4) 0 var(--space-6)', flexShrink: 0 }}>
                    <h2 style={{
                        margin: 0,
                        flex: 1,
                        minWidth: 0,
                        fontSize: 'var(--size-title)',
                        fontWeight: 'var(--weight-medium)',
                        color: strong,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}>
                        {subject}
                    </h2>
                    {nav && <ThreadNav {...nav} />}
                </div>
            )}

            {/* The message (its sender, addresses, images strip and body): the next one is drawn
                underneath, then swapped in (crossfaded over the one left, FLIP_CROSSFADE_MS). The
                subject row above and Reader and the text sizes below stay still. */}
            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                {/* One keyed list, so the message drawn underneath is the same one shown on top (two
                    separate slots would make React draw it again from scratch, blank for a moment) */}
                {[showing, ...(incoming ? [incoming] : []), ...(leaving ? [leaving.email] : []), ...warmNow]
                    .filter((email, i, all) => all.findIndex(e => e.msgKey === email.msgKey) === i)
                    // In a fixed order (by date), never by role: a layer moved in the page would
                    // reload its frame (the browser does that to a moved iframe), losing its drawing
                    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.msgKey.localeCompare(b.msgKey))
                    .map(email => layer(email, email.msgKey === showing.msgKey, email.msgKey === incoming?.msgKey))}
            </div>

            {/* Reader mode and text size, bottom right (reading view only) */}
            {!compact && <div
                style={{
                    position: 'absolute',
                    bottom: '24px',
                    right: 'var(--space-6)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 'var(--space-2)',
                    zIndex: 100 // layer: page, local (Reader and the sizes over the message, inside the card)
                }}
            >
                {/* Reader on paper mail, Original on theme mail that had a look of its own: one place, one style */}
                {(look.paper || look.canOriginal) && look.ready && (
                    <Button
                        aria-pressed={look.paper ? readerMode : originalMode}
                        icon={look.paper ? <BookOpen size={16} aria-hidden="true" /> : <Palette size={16} aria-hidden="true" />}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (look.paper) setReaderOn(!readerMode);
                            else onShowOriginal(!originalMode);
                        }}
                    >
                        {look.paper ? (readerMode ? 'Exit Reader' : 'Reader') : (originalMode ? 'Exit original' : 'Original')}
                    </Button>
                )}
                {/* The text sizes: the shared Segmented in Aa's own look, one Tab stop, the arrow keys
                    choose (board P2, change 2). A click stays here, not the card's. */}
                {!readerMode && (
                    <div onClick={e => e.stopPropagation()} style={{ display: 'flex' }}>
                        <Segmented
                            label="Text size"
                            className="em-aa"
                            value={String(ZOOMS.includes(zoomLevel) ? zoomLevel : 1)}
                            onChange={v => setZoomLevel(Number(v))}
                            options={ZOOMS.map((value, idx) => ({
                                value: String(value),
                                name: `Text size: ${['small', 'medium', 'large', 'extra large'][idx]}`,
                                label: <span style={{ fontSize: `${11 + idx * 2}px` }}>Aa</span>,
                            }))}
                        />
                    </div>
                )}
            </div>}
        </div>
    );
});

interface MessageLayerProps {
    /** On screen; otherwise drawn underneath it, out of reach, until it's ready. */
    top: boolean;
    /** The message just left, kept drawn as it was under the one fading in (the crossfade) */
    leaving?: boolean;
    /** On top and fading in over the one left, for this long (ms); 0: shown at once */
    fadeIn?: number;
    onFadeEnd?: () => void;
    accountId: string;
    email: Email;
    load: boolean;
    onLoaded?: (email: Email) => void;
    onDownload: (url: string, fallbackName: string) => void;
    compact?: boolean;
    hasSubject: boolean;
    myAddresses: string[];
    dateLabel?: string;
    linkCopied?: boolean;
    onCopyLink?: () => void;
    /** In the band, the conversation's controls sit at the end of the header row. */
    nav?: ThreadNavProps;
    replyingTo?: { label: string; onOpen: () => void };
    readerOn: boolean;
    zoomLevel: number;
    showOriginal: boolean;
    scrollHeld?: boolean;
    /** The body's starting height (the message before's). */
    startHeight: number;
    onHeight?: (height: number) => void;
    onLook: (key: string, look: Look) => void;
    /** Drawn underneath: called once it's ready to be shown (`drawn`: its body is in its frame). */
    onReady?: (email: Email, drawn: boolean) => void;
}

/** One message: its header, addresses, images strip, body and attachments. */
const MessageLayer: React.FC<MessageLayerProps> = ({
    top, leaving = false, fadeIn = 0, onFadeEnd, accountId, email: base, load, onLoaded, onDownload, compact, hasSubject, myAddresses, dateLabel, linkCopied, onCopyLink, nav, replyingTo,
    readerOn, zoomLevel, showOriginal, scrollHeld, startHeight, onHeight, onLook, onReady,
}) => {
    const { body, error, retry } = useMessageBody(accountId, base.msgKey, load);
    const email = useMemo(() => (body ? withBody(base, body) : base), [base, body]);
    const [showFullBody, setShowFullBody] = useState(false);
    // Every address, opened by the arrow after the recipients
    const [showDetails, setShowDetails] = useState(false);
    // Its frame has reported its size: the body is drawn
    const [drawn, setDrawn] = useState(false);
    // Kept drawn while it's a neighbour: when it goes out of sight it starts over (quote folded,
    // addresses closed, scrolled to its top), as a message opened afresh would
    // (A message being left keeps its look until its fade is over.)
    const scroller = useRef<HTMLDivElement>(null);
    const seen = top || leaving;
    const [wasSeen, setWasSeen] = useState(seen);
    if (wasSeen !== seen) {
        setWasSeen(seen);
        if (!seen) {
            setShowFullBody(false);
            setShowDetails(false);
        }
    }
    useLayoutEffect(() => { if (!seen && scroller.current) scroller.current.scrollTop = 0; }, [seen]);

    useEffect(() => {
        if (body) onLoaded?.(email);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [body]);

    // A card far back in the stack (not loaded yet) shows its preview; one being loaded, a skeleton.
    const bodyState = error ? 'failed' : body || email.body ? 'ready' : load ? 'loading' : 'preview';
    const bodyContent = email.body || (email.preview ? `<p style="color:#999">${email.preview.replace(/</g, '&lt;')}…</p>` : '');
    const { original, quoted } = useMemo(() => splitQuotedContent(bodyContent), [bodyContent]);
    const mine = (address: string | undefined) => !!address && myAddresses.includes(address.toLowerCase());
    const fromMe = email.mailbox === 'Sent' || mine(email.senderAddress);
    // Paper for designed mail from someone else, decided on the newest part (utils/mailLook.ts)
    const paper = useMemo(() => !!body && showsOnPaper(original, body, fromMe), [body, original, fromMe]);
    // The rest is shown in the theme, its own look stripped. "Original" is offered when the message,
    // quote included, had a look of its own (its web fonts count too), and shows all of it as sent.
    const fonts = useMemo(() => (paper || !body?.html ? '' : fontFaces(body.html)), [paper, body]);
    const hadLook = useMemo(() => !paper && !!body?.html && stripToTheme(sanitizeHtml(bodyContent)).hadLook, [paper, body, bodyContent]);
    const canOriginal = !paper && !!body?.html && (hadLook || !!fonts);
    const readerMode = readerOn && paper;
    const originalMode = showOriginal && canOriginal;
    const raw = showFullBody || originalMode ? bodyContent : original;
    const themed = useMemo(() => (paper ? null : stripToTheme(sanitizeHtml(raw))), [paper, raw]);
    // Outside images: hidden (placeholders) until loaded for this message (utils/remoteImages.ts)
    const images = useRemoteImages(`${accountId}:${base.msgKey}`);
    const onSheet = paper || originalMode;
    const shown = useMemo(
        () => (onSheet || !themed ? prepareBody(sanitizeHtml(raw), 'paper', images.allowed) : prepareBody(themed.html, 'theme', images.allowed)),
        [onSheet, themed, raw, images.allowed]
    );
    const reader = useMemo(
        () => (readerMode ? prepareBody(sanitizeReaderHtml(extractReaderContent(raw)), 'reader', images.allowed) : null),
        [readerMode, raw, images.allowed]
    );
    // Where the paper sheet starts, so "Show quoted content" lines up under it
    const [sheetLeft, setSheetLeft] = useState(0);
    const attachments = email.attachments ?? [];
    const toLine = recipientsLine(email.to ?? [], email.cc ?? [], mine);
    // Reply-To shows only when replies go somewhere other than the sender.
    const replyTo = (email.replyTo ?? []).filter(a => a.address.toLowerCase() !== (email.senderAddress ?? '').toLowerCase());
    const details: [string, string][] = [
        ['From', email.senderAddress ? formatAddress({ name: email.sender, address: email.senderAddress }) : email.sender],
        ...(email.to?.length ? [['To', email.to.map(formatAddress).join(', ')] as [string, string]] : []),
        ...(email.cc?.length ? [['Cc', email.cc.map(formatAddress).join(', ')] as [string, string]] : []),
        ...(replyTo.length ? [['Reply-To', replyTo.map(formatAddress).join(', ')] as [string, string]] : []),
        ['Date', formatFullDateTime(email.date)],
    ];
    const muted = readerMode ? 'var(--text-3)' : 'var(--text-3)';
    const strong = readerMode ? 'var(--text-2)' : 'var(--text-1)';

    // What it is, for the card's Reader / Original; and, drawn underneath, when it can be shown
    useEffect(() => { onLook(base.msgKey, { paper, canOriginal, ready: bodyState === 'ready' }); }, [onLook, base.msgKey, paper, canOriginal, bodyState]);
    const showable = bodyState === 'failed' || bodyState === 'preview' || (bodyState === 'ready' && drawn);
    // Before the frame is painted: a message drawn ahead swaps in the same frame as the step
    useLayoutEffect(() => { if (showable) onReady?.(base, bodyState === 'ready' && drawn); }, [showable, onReady, base, bodyState, drawn]);
    const heard = useCallback((height: number) => {
        setDrawn(true);
        onHeight?.(height);
    }, [onHeight]);

    return (
        <div
            aria-hidden={top ? undefined : true}
            inert={!top}
            data-message-layer={top ? 'top' : leaving ? 'leaving' : 'under'}
            onAnimationEnd={e => { if (e.target === e.currentTarget && e.animationName === 'em-flip-in') onFadeEnd?.(); }}
            style={{
                position: 'absolute',
                inset: 0,
                // layer: view, local (the message on top; the one just left right under it while the
                // top one fades in; the ones drawn ahead under both)
                zIndex: top ? 2 : leaving ? 1 : 0,
                animation: fadeIn ? `em-flip-in ${fadeIn}ms var(--ease-in)` : undefined,
                display: 'flex',
                flexDirection: 'column',
                // Opaque, so the next message drawing underneath doesn't show through
                backgroundColor: readerMode ? 'var(--surface-1)' : 'var(--surface-raised)'
            }}
        >
            {/* Sender, to whom, when; copy link */}
            <header
                style={{
                    height: compact || !hasSubject ? '50px' : '44px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: '0 var(--space-3) 0 var(--space-6)',
                    fontSize: 'var(--size-body)',
                    color: muted,
                    borderBottom: readerMode ? '1px solid var(--line-2)' : '1px solid var(--line-1)',
                    flexShrink: 0
                }}
            >
                <span style={{ fontWeight: 'var(--weight-medium)', color: strong, whiteSpace: 'nowrap' }}>
                    {fromMe ? 'Me' : email.sender}
                </span>
                {toLine && (
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                        {toLine}
                    </span>
                )}
                <Tooltip content={showDetails ? 'Hide addresses' : 'Show addresses'}>
                    <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setShowDetails(!showDetails); }}
                        aria-expanded={showDetails}
                        aria-label={showDetails ? 'Hide addresses' : 'Show addresses'}
                        className="em-icon-button"
                        style={{
                            width: '24px',
                            height: '24px',
                            marginLeft: '-4px',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: 0,
                            borderRadius: 'var(--radius-full)',
                            background: showDetails ? 'var(--surface-1)' : 'transparent',
                            color: muted,
                            cursor: 'pointer',
                            transform: showDetails ? 'rotate(180deg)' : 'none',
                            transition: 'transform var(--dur-instant) var(--ease-in)'
                        }}
                    >
                        <ChevronDown size={14} aria-hidden="true" />
                    </button>
                </Tooltip>
                <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', color: readerMode ? muted : 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
                    {dateLabel ?? formatDateTime(email.date)}
                </span>
                {onCopyLink ? (
                    <Tooltip content={linkCopied ? 'Link copied' : 'Copy link to this thread'}>
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); onCopyLink(); }}
                            aria-label={linkCopied ? 'Link copied' : 'Copy link to this thread'}
                            className="em-icon-button"
                            style={{
                                width: '32px',
                                height: '32px',
                                flexShrink: 0,
                                borderRadius: 'var(--radius-full)',
                                border: 0,
                                background: 'transparent',
                                color: linkCopied ? 'var(--success)' : muted,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer'
                            }}
                        >
                            {linkCopied ? <Check size={16} /> : <Link2 size={16} />}
                        </button>
                    </Tooltip>
                ) : <span style={{ width: '32px', flexShrink: 0 }} />}
                {nav && <ThreadNav {...nav} />}
            </header>

            {/* Every address, to read or copy */}
            {showDetails && (
                <div style={{
                    padding: 'var(--space-2) var(--space-6) var(--space-3)',
                    borderBottom: '1px solid var(--line-1)',
                    background: 'var(--surface-1)',
                    color: 'var(--text-1)',
                    fontSize: 'var(--size-body)',
                    display: 'grid',
                    gridTemplateColumns: '72px 1fr',
                    gap: 'var(--space-1) var(--space-2)',
                    userSelect: 'text',
                    WebkitUserSelect: 'text',
                    flexShrink: 0
                }}>
                    {details.map(([label, value]) => (
                        <React.Fragment key={label}>
                            <span style={{ color: 'var(--text-3)' }}>{label}</span>
                            <span style={{ overflowWrap: 'anywhere' }}>{value}</span>
                        </React.Fragment>
                    ))}
                </div>
            )}

            {bodyState === 'ready' && ((reader ?? shown).remote || (originalMode && cssIsOutside(fonts))) && <ImagesStrip state={images.state} onLoad={images.load} />}

            {/* Content (Scrollable) */}
            <div
                ref={scroller}
                data-message-scroll
                className={readerMode ? 'reader-scroll-container' : ''}
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: scrollHeld ? 'hidden' : 'auto',
                    paddingTop: 'var(--space-4)',
                    // Room for Reader / Original and the text sizes, so they never cover the last row
                    paddingBottom: compact ? '48px' : '120px',
                    paddingLeft: readerMode ? '40px' : 'var(--space-6)',
                    paddingRight: readerMode ? '40px' : 'var(--space-6)'
                }}>
                <div style={{ maxWidth: readerMode ? '680px' : '100%', margin: readerMode ? '0 auto' : '0' }}>
                    {replyingTo && (
                        <button type="button" className="em-reply-line" onClick={e => { e.stopPropagation(); replyingTo.onOpen(); }}>
                            <CornerUpLeft size={13} aria-hidden="true" />Replying to {replyingTo.label}
                        </button>
                    )}
                    {bodyState === 'loading' ? (
                        <BodySkeleton minHeight={startHeight} />
                    ) : bodyState === 'failed' ? (
                        <BodyFailure minHeight={200} onRetry={retry} />
                    ) : (
                        <>
                            {/* In a frame like any email: its content policy keeps outside content out, Reader included */}
                            <MailFrame
                                html={readerMode ? reader?.html ?? '' : shown.html}
                                look={readerMode ? 'reader' : onSheet ? 'paper' : 'theme'}
                                imagesAllowed={images.allowed}
                                fontSize={16 * zoomLevel}
                                minHeight={200}
                                startHeight={startHeight}
                                onHeight={heard}
                                onImagesSettled={images.settled}
                                onSheetLeft={setSheetLeft}
                                fonts={originalMode ? fonts : ''}
                            />
                            {quoted && !originalMode && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowFullBody(!showFullBody);
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-2)',
                                        padding: 'var(--space-2) var(--space-4)',
                                        // On paper, under the sheet's left edge
                                        margin: `16px 0 16px ${onSheet && !readerMode ? sheetLeft : 0}px`,
                                        backgroundColor: 'var(--surface-1)',
                                        border: '1px solid var(--line-1)',
                                        borderRadius: 'var(--radius-full)',
                                        color: 'var(--text-3)',
                                        fontSize: 'var(--size-body)',
                                        fontWeight: 500,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {showFullBody ? 'Hide quoted text' : 'Show quoted text'}
                                </button>
                            )}
                        </>
                    )}

                    {/* Attachments */}
                    {!readerMode && attachments.length > 0 && (
                        <div style={{ marginTop: 'var(--space-6)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--line-1)' }}>
                            <div style={{ fontSize: 'var(--size-body)', fontWeight: 'var(--weight-medium)', color: 'var(--text-3)', marginBottom: 'var(--space-2)' }}>
                                Attachments ({formatCount(attachments.length)})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                {attachments.map(attachment => (
                                    <a
                                        key={attachment.part}
                                        href={urls.attachment(accountId, email.msgKey, attachment.part)}
                                        download={attachment.filename}
                                        onClick={e => {
                                            e.preventDefault();
                                            onDownload(e.currentTarget.href, attachment.filename ?? `attachment-${attachment.part}`);
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-2)',
                                            padding: 'var(--space-2)',
                                            backgroundColor: 'var(--surface-1)',
                                            border: '1px solid var(--line-1)',
                                            borderRadius: 'var(--radius-2)',
                                            textDecoration: 'none',
                                            color: 'var(--text-1)',
                                            fontSize: 'var(--size-body)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <Download size={16} />
                                        <span style={{ flex: 1 }}>{attachment.filename}</span>
                                        {attachment.size !== null && (
                                            <span style={{ color: 'var(--text-3)', fontSize: 'var(--size-caption)' }}>
                                                {formatSize(attachment.size)}
                                            </span>
                                        )}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
