/**
 * The thread as a tree, in a panel to the right of the card (docs/design/reading-navigation-spec.md
 * §2): each message under the one it answers, with guide lines like a file tree. Clicking a row opens
 * that message in the card. While a reply is being written, it shows as a "Draft" row under the
 * message it answers.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import type { Email } from '../../store/mailStore';
import { threadTree } from '../../utils/threadTree';
import { formatDate, formatListDate } from '../../utils/formatDate';
import { Bone } from '../Loading/Skeletons';

interface ThreadTreeProps {
    /** The conversation's messages, oldest first. */
    messages: Email[];
    /** The message open in the card. */
    currentKey: string | undefined;
    onOpen: (msgKey: string) => void;
    /** Your own messages read "Me". */
    isMine: (email: Email) => boolean;
    /** While replying: the message the reply answers (the draft row goes under it), and its first line. */
    draft?: { under: string; text: string } | null;
    /** The conversation is still on its way: this many skeleton rows (its card's count). */
    loading?: number;
}

const DRAFT_KEY = '\u0000draft';
const X0 = 12;   // the first level's left padding
const INDENT = 16;
const TICK_Y = 17; // where a row's tick meets its guide line

const firstLine = (text: string) => text.split('\n').map(l => l.trim()).find(Boolean) ?? '';

export const ThreadTree: React.FC<ThreadTreeProps> = ({ messages, currentKey, onOpen, isMine, draft, loading = 0 }) => {
    const rows = useMemo(() => {
        const all: (Email | { msgKey: string; parentKey: string; draft: true })[] = [...messages];
        if (draft && messages.some(m => m.msgKey === draft.under)) all.push({ msgKey: DRAFT_KEY, parentKey: draft.under, draft: true });
        return threadTree(all);
    }, [messages, draft]);
    const byKey = useMemo(() => new Map(messages.map(m => [m.msgKey, m])), [messages]);
    const name = (m: Email) => (isMine(m) ? 'Me' : m.sender);
    const people = useMemo(() => new Set(messages.map(m => (isMine(m) ? 'me' : (m.senderAddress ?? m.sender).toLowerCase()))).size, [messages, isMine]);

    // The open message's row stays in view
    const rowRefs = useRef(new Map<string, HTMLButtonElement>());
    useEffect(() => {
        if (currentKey) rowRefs.current.get(currentKey)?.scrollIntoView({ block: 'nearest' });
    }, [currentKey]);

    return (
        <nav
            aria-label="Messages in this thread"
            style={{
                width: '300px',
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box',
                padding: '10px var(--space-2)',
                background: 'var(--surface-raised)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--radius-3)',
                pointerEvents: 'auto',
                minHeight: 0,
            }}
        >
            <div style={{ padding: '6px 10px 10px', fontSize: 'var(--size-caption)', fontWeight: 500, color: 'var(--text-4)', flexShrink: 0 }}>
                {loading ? `${loading} messages` : `${messages.length} messages · ${people} ${people === 1 ? 'person' : 'people'}`}
            </div>
            {loading > 0 && (
                <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column' }}>
                    {Array.from({ length: Math.min(loading, 12) }, (_, i) => (
                        <div key={i} style={{ padding: '9px 10px 9px var(--space-3)', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                            <Bone w={i % 3 === 0 ? 110 : 90} h={11} r="4px" />
                            <Bone w={i % 2 ? 200 : 230} h={10} r="4px" />
                        </div>
                    ))}
                </div>
            )}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: loading ? 'none' : 'flex', flexDirection: 'column' }}>
                {rows.map(({ message, depth, last, rails }) => {
                    const isDraft = message.msgKey === DRAFT_KEY;
                    const email = isDraft ? null : (message as Email);
                    const parent = message.parentKey ? byKey.get(message.parentKey) : undefined;
                    const lines: React.CSSProperties[] = [];
                    for (let level = 1; level < rails.length; level++) {
                        if (rails[level]) lines.push({ left: X0 + (level - 1) * INDENT + 4, top: 0, bottom: 0, width: 1 });
                    }
                    if (depth > 0) {
                        const x = X0 + (depth - 1) * INDENT + 4;
                        lines.push(last ? { left: x, top: 0, height: TICK_Y, width: 1 } : { left: x, top: 0, bottom: 0, width: 1 });
                        lines.push({ left: x, top: TICK_Y, height: 1, width: 8 });
                    }
                    const current = !isDraft && message.msgKey === currentKey;
                    const label = isDraft
                        ? 'Draft reply'
                        : `${name(email!)}, ${formatDate(email!.date)}${parent ? `, replying to ${name(parent)}` : ''}`;
                    return (
                        <button
                            key={message.msgKey}
                            ref={el => { if (el) rowRefs.current.set(message.msgKey, el); else rowRefs.current.delete(message.msgKey); }}
                            type="button"
                            className="em-tree-row"
                            disabled={isDraft}
                            aria-current={current ? 'true' : undefined}
                            aria-label={label}
                            onClick={() => { if (email) onOpen(email.msgKey); }}
                            style={{ paddingLeft: `${X0 + depth * INDENT}px` }}
                        >
                            {lines.map((style, i) => (
                                <span key={i} aria-hidden="true" style={{ position: 'absolute', background: 'var(--line-3)', ...style }} />
                            ))}
                            <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', fontSize: 'var(--size-small)' }}>
                                <b style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {isDraft ? 'Me' : name(email!)}
                                </b>
                                {isDraft && <span style={{ color: 'var(--action)', fontSize: 'var(--size-caption)', fontWeight: 500 }}>Draft</span>}
                                {email && (
                                    <span style={{ marginLeft: 'auto', color: 'var(--text-4)', fontSize: 'var(--size-caption)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                        {formatListDate(email.date)}
                                    </span>
                                )}
                            </span>
                            <span style={{ display: 'block', fontSize: 'var(--size-caption)', color: 'var(--text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {isDraft ? firstLine(draft?.text ?? '') || ' ' : firstLine(email!.preview) || ' '}
                            </span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};
