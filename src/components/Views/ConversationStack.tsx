/**
 * A conversation as a stack of cards (Explore 2): the message on top, and while the thread tree is
 * closed the edges of the older ones above it (clicking one steps back a card). "4 of 9", up / down
 * and the tree's toggle sit in the front card at its top right (MessageCard). Scrolling on the stack
 * moves one card per gesture, once the message itself has scrolled to its end. Full height in the
 * reading view; the band above the composer while replying (docs/design/reading-navigation-spec.md).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Email } from '../../store/mailStore';
import { loadBody } from '../../api/bodies';
import { formatDate, formatDateTime } from '../../utils/formatDate';
import { MessageCard } from './MessageCard';

interface ConversationStackProps {
    accountId: string;
    /** Newest first: index 0 is the newest message. */
    emails: Email[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** The conversation's subject, shown in the card (reading view only). */
    subject?: string;
    /** The band above the composer: header and body only. */
    compact?: boolean;
    myAddresses: string[];
    linkCopied: boolean;
    onCopyLink: () => void;
    onDownload: (url: string, fallbackName: string) => void;
    /** Text in place of a card's date (a message being sent). */
    dateLabel?: (email: Email) => string | undefined;
    /** The thread tree beside the card: while it's open, no edges. */
    treeOpen: boolean;
    onToggleTree: () => void;
    /** Your own messages ("Me" in "Replying to Me, Oct 28"). */
    isMine: (email: Email) => boolean;
    /** In the band, at the top of the card: "Not the message you're replying to". */
    bandNote?: React.ReactNode;
    /** How many messages the conversation has, known from its card before the rest arrives. */
    expectedCount?: number;
    /** The message on screen (it trails the one asked for by the moment it takes to draw): the
     *  counter and the edges follow it, so they change in the same frame as the message. */
    shownIndex?: number;
    onShown?: (msgKey: string) => void;
}

/** Wheel events further apart than this start a new gesture (a trackpad's momentum keeps them closer). */
const GESTURE_GAP_MS = 100;

/** The older messages' edges above the card (§4): the near one, then the far one. */
const EDGES = [
    { height: 14, inset: 14, top: -12 },
    { height: 12, inset: 28, top: -22 },
];

const isPending = (e: Email) => e.msgKey.startsWith('pending-');

export const ConversationStack: React.FC<ConversationStackProps> = ({
    accountId, emails, selectedIndex, onSelect, subject, compact, myAddresses, linkCopied, onCopyLink, onDownload, dateLabel,
    treeOpen, onToggleTree, isMine, bandNote, expectedCount = 0, shownIndex, onShown,
}) => {
    const front = emails[selectedIndex];
    // Until the conversation arrives only its newest message is here: "9 of 9", the arrows waiting
    const total = Math.max(emails.length, expectedCount);
    const arriving = total > emails.length;
    // Steps count from the message asked for (quick steps add up); what's shown, from the one on screen
    const older = total - 1 - selectedIndex;
    const newer = selectedIndex;
    const shown = shownIndex !== undefined && shownIndex >= 0 ? shownIndex : selectedIndex;
    const shownOlder = total - 1 - shown;
    // The messages either side of the one asked for, drawn ahead out of sight (MessageCard)
    const warm = useMemo(
        () => [emails[selectedIndex - 1], emails[selectedIndex + 1]].filter((e): e is Email => !!e && !isPending(e)),
        [emails, selectedIndex]
    );

    // The cards either side load ahead, so stepping through draws them at once.
    useEffect(() => {
        for (const e of [emails[selectedIndex - 1], emails[selectedIndex + 1]]) {
            if (e && !isPending(e)) loadBody(accountId, e.msgKey).catch(() => { /* shown when it comes to the front */ });
        }
    }, [accountId, emails, selectedIndex]);


    // Original, once turned on, stays on as you step through this conversation (owner, 2026-11-10);
    // the view is remade for each conversation, so the next one starts without it.
    const [showOriginal, setShowOriginal] = useState(false);

    // "Replying to …" on a message that answers one that isn't just before it in time (§3)
    const replyingTo = useCallback((m: Email) => {
        const at = emails.findIndex(e => e.msgKey === m.msgKey);
        const parentIndex = m.parentKey ? emails.findIndex(e => e.msgKey === m.parentKey) : -1;
        if (parentIndex < 0 || parentIndex === at + 1) return undefined;
        const parent = emails[parentIndex];
        return { label: `${isMine(parent) ? 'Me' : parent.sender}, ${formatDate(parent.date)}`, onOpen: () => onSelect(parentIndex) };
    }, [emails, isMine, onSelect]);

    // One message per scroll gesture, its momentum included (a trackpad's tail of small events
    // used to flip a second time once a fixed lock ran out); the message scrolls first, and a
    // gesture that was scrolling it doesn't flip when it reaches the end (a new gesture does).
    const lastEventTime = useRef(0);
    const inScrollGesture = useRef(false);
    const flippedThisGesture = useRef(false);
    // After a swipe has moved on, the rest of it (its momentum) mustn't scroll the next message:
    // that one's scrolling is held until the swipe ends, so it opens at its top
    const [scrollHeld, setScrollHeld] = useState(false);
    const releaseScroll = useRef<number | undefined>(undefined);
    const holdScroll = () => {
        setScrollHeld(true);
        window.clearTimeout(releaseScroll.current);
        releaseScroll.current = window.setTimeout(() => setScrollHeld(false), GESTURE_GAP_MS + 20);
    };
    useEffect(() => () => window.clearTimeout(releaseScroll.current), []);
    const handleWheel = (e: React.WheelEvent) => {
        // When the event happened, not when it's handled: drawing the next message can keep the page
        // busy for a moment, and the rest of the same swipe, handled late, mustn't read as a new one
        const at = (e.nativeEvent as WheelEvent & { emTime?: number }).emTime ?? e.timeStamp; // from the body's frame: its own time
        const isFreshGesture = at - lastEventTime.current > GESTURE_GAP_MS;
        lastEventTime.current = at;
        if (isFreshGesture) {
            inScrollGesture.current = false;
            flippedThisGesture.current = false;
        }
        if (flippedThisGesture.current) {
            holdScroll();
            return;
        }

        // The message's own scrolling area (found by its marker: no style lookups on every event)
        const scroller = (e.target as Element).closest?.('[data-message-scroll]') as HTMLElement | null;
        if (scroller && e.currentTarget.contains(scroller) && scroller.scrollHeight > scroller.clientHeight + 5) {
            const atTop = scroller.scrollTop <= 2;
            const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
            if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) {
                inScrollGesture.current = true;
                return;
            }
            if (!isFreshGesture) return;
        }
        if (inScrollGesture.current || Math.abs(e.deltaY) < 15) return;
        if (e.deltaY > 0 && newer > 0) {
            onSelect(selectedIndex - 1);
            flippedThisGesture.current = true;
            holdScroll();
        } else if (e.deltaY < 0 && older > 0) {
            onSelect(selectedIndex + 1);
            flippedThisGesture.current = true;
            holdScroll();
        }
    };

    if (!front) return null;

    return (
        <div onWheel={handleWheel} style={{ position: 'relative', height: '100%', pointerEvents: 'auto' }}>
            {/* Only while the tree is closed, never in the band: one edge for one older message, two for more */}
            {!treeOpen && !compact && arriving && EDGES.slice(0, Math.min(shownOlder, 2)).map((edge, k) => (
                <span key={k} aria-hidden="true" style={{ position: 'absolute', zIndex: 2 - k, left: edge.inset, right: edge.inset, top: edge.top, height: edge.height, boxSizing: 'border-box', background: 'var(--stack-edge-bg)', border: '1px solid var(--stack-edge-border)', borderBottom: 0, borderRadius: '8px 8px 0 0' }} />
            ))}
            {!treeOpen && !compact && !arriving && EDGES.slice(0, Math.min(shownOlder, 2)).map((edge, k) => {
                const behind = emails[shown + 1 + k];
                if (!behind) return null;
                const label = `Older: ${behind.sender}, ${formatDateTime(behind.date)}`;
                return (
                    <button
                        key={behind.msgKey}
                        type="button"
                        onClick={() => onSelect(shown + 1)}
                        title={label}
                        aria-label={label}
                        style={{
                            all: 'unset',
                            cursor: 'pointer',
                            position: 'absolute',
                            zIndex: 2 - k,
                            left: edge.inset,
                            right: edge.inset,
                            top: edge.top,
                            height: edge.height,
                            boxSizing: 'border-box',
                            background: 'var(--stack-edge-bg)',
                            border: '1px solid var(--stack-edge-border)',
                            borderBottom: 0,
                            borderRadius: '8px 8px 0 0'
                        }}
                    />
                );
            })}

            <article
                data-email-card="selected"
                style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 'var(--radius-tile)',
                    boxShadow: 'var(--shadow-message-front)',
                    overflow: 'hidden',
                    background: 'var(--surface-raised)'
                }}
            >
                {compact && bandNote}
                {/* One card for the whole conversation: stepping swaps only the message inside it (MessageCard) */}
                <div style={{ flex: 1, minHeight: 0 }}>
                    <MessageCard
                        accountId={accountId}
                        email={front}
                        load={!isPending(front)}
                        onDownload={onDownload}
                        subject={compact ? undefined : subject}
                        compact={compact}
                        myAddresses={myAddresses}
                        dateLabel={dateLabel}
                        linkCopied={linkCopied}
                        onCopyLink={onCopyLink}
                        showOriginal={showOriginal}
                        onShowOriginal={setShowOriginal}
                        scrollHeld={scrollHeld}
                        warm={warm}
                        onShown={onShown}
                        replyingTo={replyingTo}
                        nav={total > 1 ? {
                            position: shownOlder + 1,
                            total,
                            arriving,
                            onOlder: () => onSelect(selectedIndex + 1),
                            onNewer: () => onSelect(selectedIndex - 1),
                            treeOpen,
                            onToggleTree,
                        } : undefined}
                    />
                </div>
            </article>
        </div>
    );
};
