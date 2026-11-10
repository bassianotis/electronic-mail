/**
 * One message inside the conversation view (Explore 2): in the reading view the conversation's
 * subject (with older / newer at its right), then a header (sender, "to Dana, Theo, me" and an
 * arrow that opens every address, the date, copy link), the body, its attachments, and the
 * Reader or Original and text size controls. In the band above the composer it's the header
 * (older / newer at its right end) and the body only. Without notes and due dates (D19, D20).
 *
 * The body is on paper (designed mail, with Reader) or in the theme (the rest, stripped of its
 * look, with Original when there was one to strip): docs/design/reading-view-spec.md.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Check, ChevronDown, ChevronUp, Download, Link2, Palette } from 'lucide-react';
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
    /** Shown where the date goes (a message being sent). */
    dateLabel?: string;
    /** The copy-link button in the header (the card in front). */
    linkCopied?: boolean;
    onCopyLink?: () => void;
    /** Older / newer, in the card's top right (a conversation of more than one message). */
    nav?: ThreadNavProps;
    /** Original is on for this conversation (ConversationStack): each message that has one shows it. */
    showOriginal: boolean;
    onShowOriginal: (on: boolean) => void;
}

interface ThreadNavProps {
    older: number;
    newer: number;
    onOlder: () => void;
    onNewer: () => void;
}

const navButton = (enabled: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '32px',
    padding: '0 12px',
    border: 0,
    borderRadius: 0,
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--weight-semibold)',
    color: enabled ? 'var(--color-text-main)' : 'var(--color-text-muted)',
    opacity: enabled ? 1 : 0.45,
    cursor: enabled ? 'pointer' : 'default'
});

/**
 * "⌃ 2 older | 1 newer ⌄": a bordered pair of buttons (an action, not data). Both always show, so
 * they never move; one with nowhere to go is disabled.
 */
const ThreadNav: React.FC<ThreadNavProps> = ({ older, newer, onOlder, onNewer }) => (
    <div role="group" aria-label="Move through the thread" className="thread-nav" style={{
        display: 'flex',
        alignItems: 'stretch',
        flexShrink: 0,
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-control)',
        background: 'var(--surface-raised)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden'
    }}>
        <button type="button" onClick={e => { e.stopPropagation(); if (older > 0) onOlder(); }} aria-disabled={older === 0} title="Older (or scroll up)" style={navButton(older > 0)}>
            <ChevronUp size={14} aria-hidden="true" />{older} older
        </button>
        <span aria-hidden="true" style={{ width: '1px', background: 'var(--border-strong)' }} />
        <button type="button" onClick={e => { e.stopPropagation(); if (newer > 0) onNewer(); }} aria-disabled={newer === 0} title="Newer (or scroll down)" style={navButton(newer > 0)}>
            {newer} newer<ChevronDown size={14} aria-hidden="true" />
        </button>
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

export const MessageCard: React.FC<MessageCardProps> = React.memo(({
    accountId, email: base, load, onLoaded, onDownload, subject, compact, myAddresses, dateLabel, linkCopied, onCopyLink, nav, showOriginal, onShowOriginal,
}) => {
    const { body, error, retry } = useMessageBody(accountId, base.msgKey, load);
    const email = useMemo(() => (body ? withBody(base, body) : base), [base, body]);
    // Reader (paper mail) is per message, never remembered; Original (theme mail with a look of its
    // own) stays on through the conversation until it's turned off or the conversation closes.
    const [readerOn, setReaderOn] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(1.0);
    const [showFullBody, setShowFullBody] = useState(false);
    // Every address, opened by the arrow after the recipients (closes when another card comes to the front).
    const [showDetails, setShowDetails] = useState(false);

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
    const muted = readerMode ? 'var(--reader-muted)' : 'var(--color-text-muted)';
    const strong = readerMode ? 'var(--reader-text)' : 'var(--color-text-main)';

    return (
        <motion.div
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                backgroundColor: readerMode ? 'var(--reader-bg)' : 'var(--surface-raised)',
                overflow: 'hidden',
                color: readerMode ? 'var(--reader-text)' : 'inherit',
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            {subject !== undefined && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: '48px', padding: '12px 16px 0 24px', flexShrink: 0 }}>
                    <h2 style={{
                        margin: 0,
                        flex: 1,
                        minWidth: 0,
                        fontSize: 'var(--font-size-lg)',
                        fontWeight: 'var(--weight-bold)',
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

            {/* Sender, to whom, when; copy link */}
            <header
                style={{
                    height: compact || subject === undefined ? '50px' : '44px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '0 12px 0 24px',
                    fontSize: 'var(--font-size-sm)',
                    color: muted,
                    borderBottom: readerMode ? '1px solid var(--reader-rule)' : '1px solid var(--color-border)',
                    flexShrink: 0
                }}
            >
                <span style={{ fontWeight: 'var(--weight-semibold)', color: strong, whiteSpace: 'nowrap' }}>
                    {fromMe ? 'Me' : email.sender}
                </span>
                {toLine && (
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                        {toLine}
                    </span>
                )}
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setShowDetails(!showDetails); }}
                    aria-expanded={showDetails}
                    title="Show addresses"
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
                        background: showDetails ? 'var(--color-bg-subtle)' : 'transparent',
                        color: muted,
                        cursor: 'pointer',
                        transform: showDetails ? 'rotate(180deg)' : 'none',
                        transition: 'transform var(--dur-fast) var(--ease)'
                    }}
                >
                    <ChevronDown size={14} aria-hidden="true" />
                </button>
                <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', color: readerMode ? muted : 'var(--color-text-faint)', fontVariantNumeric: 'var(--date-numerals)' }}>
                    {dateLabel ?? formatDateTime(email.date)}
                </span>
                {onCopyLink ? (
                    <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onCopyLink(); }}
                        title={linkCopied ? 'Link copied' : 'Copy link to this thread'}
                        aria-label={linkCopied ? 'Link copied' : 'Copy link to this thread'}
                        className="em-icon-button"
                        style={{
                            width: '32px',
                            height: '32px',
                            flexShrink: 0,
                            borderRadius: 'var(--radius-full)',
                            border: 0,
                            background: 'transparent',
                            color: linkCopied ? 'var(--color-success)' : muted,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer'
                        }}
                    >
                        {linkCopied ? <Check size={16} /> : <Link2 size={16} />}
                    </button>
                ) : <span style={{ width: '32px', flexShrink: 0 }} />}
                {compact && nav && <ThreadNav {...nav} />}
            </header>

            {/* Every address, to read or copy */}
            {showDetails && (
                <div style={{
                    padding: '8px 24px 12px',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'var(--color-bg-subtle)',
                    color: 'var(--color-text-main)',
                    fontSize: 'var(--font-size-sm)',
                    display: 'grid',
                    gridTemplateColumns: '72px 1fr',
                    gap: '4px 8px',
                    userSelect: 'text',
                    WebkitUserSelect: 'text',
                    flexShrink: 0
                }}>
                    {details.map(([label, value]) => (
                        <React.Fragment key={label}>
                            <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
                            <span style={{ overflowWrap: 'anywhere' }}>{value}</span>
                        </React.Fragment>
                    ))}
                </div>
            )}

            {bodyState === 'ready' && ((reader ?? shown).remote || (originalMode && cssIsOutside(fonts))) && <ImagesStrip state={images.state} onLoad={images.load} />}

            {/* Content (Scrollable) */}
            <div
                className={readerMode ? 'reader-scroll-container' : ''}
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    paddingTop: '16px',
                    // Room for Reader / Original and the text sizes, so they never cover the last row
                    paddingBottom: compact ? '48px' : '120px',
                    paddingLeft: readerMode ? '40px' : 'var(--space-lg)',
                    paddingRight: readerMode ? '40px' : 'var(--space-lg)'
                }}>
                <div style={{ maxWidth: readerMode ? '680px' : '100%', margin: readerMode ? '0 auto' : '0' }}>
                    {bodyState === 'loading' ? (
                        <BodySkeleton minHeight={200} />
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
                                        gap: '8px',
                                        padding: '8px 16px',
                                        // On paper, under the sheet's left edge
                                        margin: `16px 0 16px ${onSheet && !readerMode ? sheetLeft : 0}px`,
                                        backgroundColor: 'var(--color-bg-subtle)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-full)',
                                        color: 'var(--color-text-muted)',
                                        fontSize: 'var(--font-size-sm)',
                                        fontWeight: 500,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {showFullBody ? '••• Hide quoted content' : '••• Show quoted content'}
                                </button>
                            )}
                        </>
                    )}

                    {/* Attachments */}
                    {!readerMode && attachments.length > 0 && (
                        <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
                            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-sm)' }}>
                                Attachments ({formatCount(attachments.length)})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
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
                                            gap: 'var(--space-sm)',
                                            padding: 'var(--space-sm)',
                                            backgroundColor: 'var(--surface-card)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-sm)',
                                            textDecoration: 'none',
                                            color: 'var(--color-text-main)',
                                            fontSize: 'var(--font-size-sm)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <Download size={16} />
                                        <span style={{ flex: 1 }}>{attachment.filename}</span>
                                        {attachment.size !== null && (
                                            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
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

            {/* Reader mode and text size, bottom right (reading view only) */}
            {!compact && <div
                style={{
                    position: 'absolute',
                    bottom: '24px',
                    right: 'var(--space-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: '8px',
                    zIndex: 100
                }}
            >
                {/* Reader on paper mail, Original on theme mail that had a look of its own: one place, one style */}
                {(paper || canOriginal) && bodyState === 'ready' && (
                    <button
                        type="button"
                        aria-pressed={paper ? readerMode : originalMode}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (paper) setReaderOn(!readerMode);
                            else onShowOriginal(!originalMode);
                        }}
                        style={{
                            backgroundColor: 'var(--surface-raised)',
                            color: 'var(--color-text-main)',
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-pill)',
                            boxShadow: 'var(--shadow-lift)',
                            border: '1px solid var(--border-strong)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontWeight: 'var(--weight-semibold)',
                            fontSize: 'var(--font-size-sm)',
                            transition: 'background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)'
                        }}
                    >
                        {paper ? <BookOpen size={16} aria-hidden="true" /> : <Palette size={16} aria-hidden="true" />}
                        {paper ? (readerMode ? 'Exit Reader' : 'Reader') : (originalMode ? 'Exit original' : 'Original')}
                    </button>
                )}
                {!readerMode && (
                    <div style={{
                        backgroundColor: 'var(--surface-raised)',
                        padding: '4px',
                        borderRadius: 'var(--radius-control)',
                        boxShadow: 'var(--shadow-lift)',
                        display: 'flex',
                        gap: '2px',
                        border: '1px solid var(--border-strong)'
                    }}>
                        {ZOOMS.map((value, idx) => (
                            <button
                                key={value}
                                aria-label={`Text size: ${['small', 'medium', 'large', 'extra large'][idx]}`}
                                aria-pressed={zoomLevel === value}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setZoomLevel(value);
                                }}
                                style={{
                                    fontSize: `${11 + idx * 2}px`,
                                    fontWeight: 'var(--weight-semibold)',
                                    padding: '4px 12px',
                                    backgroundColor: zoomLevel === value ? 'var(--color-bg-subtle)' : 'transparent',
                                    color: zoomLevel === value ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                                    borderRadius: 'max(4px, calc(var(--radius-control) - 4px))',
                                    border: 'none',
                                    cursor: 'pointer',
                                    transition: 'background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)',
                                    lineHeight: 1
                                }}
                            >
                                Aa
                            </button>
                        ))}
                    </div>
                )}
            </div>}
        </motion.div>
    );
});
