/**
 * A conversation as a stack of cards (Explore 2): the message on top, the two older ones as thin
 * edges peeking above it (clicking one steps back a card), and "⌃ 3 older | 1 newer ⌄" inside the
 * front card at its top right (MessageCard). Scrolling on the stack moves one card per gesture,
 * once the message itself has scrolled to its end. Full height in the reading view; the band above
 * the composer while replying.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Email } from '../../store/mailStore';
import { loadBody } from '../../api/bodies';
import { formatDateTime } from '../../utils/formatDate';
import { MessageCard } from './MessageCard';
import { DURATION, tween } from '../../utils/motion';

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
}

/** The thin edges of the next older cards (1a). */
const PEEKS = [
    { height: 12, inset: 16, top: -12, opacity: 0.8 },
    { height: 12, inset: 32, top: -24, opacity: 0.55 },
];

const isPending = (e: Email) => e.msgKey.startsWith('pending-');

export const ConversationStack: React.FC<ConversationStackProps> = ({
    accountId, emails, selectedIndex, onSelect, subject, compact, myAddresses, linkCopied, onCopyLink, onDownload, dateLabel,
}) => {
    const front = emails[selectedIndex];
    const older = emails.length - 1 - selectedIndex;
    const newer = selectedIndex;

    // The cards either side load ahead, so stepping through draws them at once.
    useEffect(() => {
        for (const e of [emails[selectedIndex - 1], emails[selectedIndex + 1]]) {
            if (e && !isPending(e)) loadBody(accountId, e.msgKey).catch(() => { /* shown when it comes to the front */ });
        }
    }, [accountId, emails, selectedIndex]);

    // Which way the last step went, so the new card comes in from that side.
    const [step, setStep] = useState({ index: selectedIndex, direction: 0 });
    if (step.index !== selectedIndex) setStep({ index: selectedIndex, direction: selectedIndex > step.index ? -1 : 1 });
    const direction = step.direction;

    // One card per scroll gesture; the message scrolls first, and a gesture that was scrolling it
    // doesn't flip the card when it reaches the end (a new gesture does).
    const lastWheelTime = useRef(0);
    const lastEventTime = useRef(0);
    const inScrollGesture = useRef(false);
    const handleWheel = (e: React.WheelEvent) => {
        const now = Date.now();
        const isFreshGesture = now - lastEventTime.current > 100;
        lastEventTime.current = now;
        if (isFreshGesture) inScrollGesture.current = false;

        const card = e.currentTarget.querySelector('[data-email-card="selected"]');
        let current: HTMLElement | null = e.target as HTMLElement;
        if (card && card.contains(current)) {
            for (let i = 0; i < 20 && current && current !== card; i++) {
                const style = window.getComputedStyle(current);
                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && current.scrollHeight > current.clientHeight + 5) {
                    const atTop = current.scrollTop <= 2;
                    const atBottom = current.scrollTop + current.clientHeight >= current.scrollHeight - 2;
                    if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) {
                        inScrollGesture.current = true;
                        return;
                    }
                    if (!isFreshGesture) return;
                    break;
                }
                current = current.parentElement;
            }
        }
        if (inScrollGesture.current && !isFreshGesture) return;
        if (now < lastWheelTime.current || Math.abs(e.deltaY) < 15) return;
        if (e.deltaY > 0 && newer > 0) {
            onSelect(selectedIndex - 1);
            lastWheelTime.current = now + 600;
        } else if (e.deltaY < 0 && older > 0) {
            onSelect(selectedIndex + 1);
            lastWheelTime.current = now + 600;
        }
    };

    if (!front) return null;

    return (
        <div onWheel={handleWheel} style={{ position: 'relative', height: '100%', pointerEvents: 'auto' }}>
            {PEEKS.map((peek, k) => {
                const behind = emails[selectedIndex + 1 + k];
                if (!behind) return null;
                const label = `Older: ${behind.sender}, ${formatDateTime(behind.date)}`;
                return (
                    <button
                        key={behind.msgKey}
                        type="button"
                        onClick={() => onSelect(selectedIndex + 1)}
                        title={label}
                        aria-label={label}
                        style={{
                            all: 'unset',
                            cursor: 'pointer',
                            position: 'absolute',
                            zIndex: 2 - k,
                            left: peek.inset,
                            right: peek.inset,
                            top: peek.top,
                            height: peek.height,
                            background: 'var(--surface-card)',
                            borderRadius: 'var(--radius-tile) var(--radius-tile) 0 0',
                            boxShadow: 'var(--shadow-message-back)',
                            opacity: peek.opacity
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
                <motion.div
                    key={front.msgKey}
                    initial={direction ? { opacity: 0, y: direction * 14 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={tween(DURATION.mid)}
                    style={{ height: '100%' }}
                >
                    <MessageCard
                        accountId={accountId}
                        email={front}
                        load={!isPending(front)}
                        onDownload={onDownload}
                        subject={compact ? undefined : subject}
                        compact={compact}
                        myAddresses={myAddresses}
                        dateLabel={dateLabel?.(front)}
                        linkCopied={linkCopied}
                        onCopyLink={onCopyLink}
                        nav={emails.length > 1 ? {
                            older,
                            newer,
                            onOlder: () => onSelect(selectedIndex + 1),
                            onNewer: () => onSelect(selectedIndex - 1),
                        } : undefined}
                    />
                </motion.div>
            </article>
        </div>
    );
};
