/**
 * One recipient row of the composer (To, Cc, Bcc): chips and an input. Typing "Name <addr>",
 * commas or semicolons turns what's typed into chips (so does Enter, Tab or leaving the field);
 * Backspace in an empty field takes the last chip back. An address the engine wouldn't accept
 * shows as a chip with a red outline, its title saying why.
 *
 * Suggestions (Explore 2, C3): a moment after typing, people from mail in any account, the typed
 * start in bold; Up and Down move, Enter or Tab adds.
 *
 * Folding (as Mailbird, Thunderbird and phone mail apps do): while the row isn't in use it keeps to
 * one line, the chips that fit and "+N more"; clicking into it shows everyone again. A red chip
 * keeps the row open, so it can be fixed.
 */
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../api/client';
import { parseRecipients, withRecipients, type Recipient } from '../../utils/replyDraft';
import { fieldLabel, fieldRow } from './styles';
import { Tooltip } from '../../ui/Tooltip';
import { Button } from '../../ui/Button';
import { TextInput } from '../../ui/Field';

interface RecipientFieldProps {
    label: 'To' | 'Cc' | 'Bcc';
    recipients: Recipient[];
    onChange: (recipients: Recipient[]) => void;
    /** The 34px reply-type gutter (replies), 0 for a new message. */
    gutter: number;
    gutterContent?: React.ReactNode;
    /** Clicking the label or the field (To expands the composer's fields). */
    onActivate?: () => void;
    placeholder?: string;
    /** At the right end (the Cc and Bcc links). */
    trailing?: React.ReactNode;
    autoFocus?: boolean;
}

interface Contact {
    name: string | null;
    address: string;
}

const SUGGEST_DELAY_MS = 120;
/** The flex gap between the row's parts. */
const GAP = 6;
/** Room kept on a folded row for "+N more", and for a sliver of the field after it. */
const MORE_ROOM = 76;
const INPUT_ROOM = 16;

/** `text` with the part matching what was typed in bold (at its start or a word's). */
const Marked: React.FC<{ text: string; typed: string }> = ({ text, typed }) => {
    const at = text.toLowerCase().startsWith(typed) ? 0 : text.toLowerCase().indexOf(` ${typed}`) + 1;
    if (!typed || at < 0 || (at === 0 && !text.toLowerCase().startsWith(typed))) return <>{text}</>;
    return <>{text.slice(0, at)}<b style={{ fontWeight: 'var(--weight-medium)' }}>{text.slice(at, at + typed.length)}</b>{text.slice(at + typed.length)}</>;
};

export const RecipientField: React.FC<RecipientFieldProps> = ({ label, recipients, onChange, gutter, gutterContent, onActivate, placeholder, trailing, autoFocus }) => {
    const [text, setText] = useState('');
    const [found, setFound] = useState<{ query: string; contacts: Contact[] } | null>(null);
    const [picked, setPicked] = useState(0);
    const listId = useId(); // the suggestions, for the combobox (aria-controls, aria-activedescendant)
    const asked = useRef(0);
    const query = text.trim().toLowerCase();
    const added = new Set(recipients.map(r => r.address.toLowerCase()));
    const suggestions = found && found.query === query ? found.contacts.filter(c => !added.has(c.address)) : [];
    const open = suggestions.length > 0;
    const rowRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const trailingRef = useRef<HTMLSpanElement>(null);
    const [inUse, setInUse] = useState(false);
    const [width, setWidth] = useState(0);
    const [fits, setFits] = useState(Infinity);
    const folded = !inUse && !recipients.some(r => r.invalid);
    const hidden = folded ? Math.max(0, recipients.length - fits) : 0;
    const hasTrailing = !!trailing;

    useEffect(() => {
        const row = rowRef.current;
        if (!row) return;
        const watch = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
        watch.observe(row);
        return () => watch.disconnect();
    }, []);

    // Folded: how many chips fit on the one line (always the first, so the line starts after the label).
    useLayoutEffect(() => {
        const row = rowRef.current;
        if (!folded || !row) return;
        const chips = [...row.querySelectorAll<HTMLElement>('[data-chip]')].map(c => c.offsetWidth);
        if (!chips.length) return;
        const start = row.querySelector<HTMLElement>('[data-chip]')!.getBoundingClientRect().left;
        const trailing = trailingRef.current ? trailingRef.current.offsetWidth + GAP : 0;
        const end = row.getBoundingClientRect().right - trailing - INPUT_ROOM;
        const all = chips.reduce((sum, w) => sum + w + GAP, 0);
        let n = chips.length;
        if (start + all > end) {
            let x = start;
            n = 0;
            while (n < chips.length && x + chips[n] <= end - MORE_ROOM) x += chips[n++] + GAP;
        }
        // A measurement before paint, so the row never shows unfolded first.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFits(Math.max(1, n));
    }, [folded, recipients, width, hasTrailing]);

    // A moment after typing stops, ask the engine (an older answer arriving late is ignored).
    useEffect(() => {
        if (!query || /[,;<>]/.test(query)) return;
        const n = ++asked.current;
        const wait = setTimeout(() => {
            api.get<{ contacts: Contact[] }>(`/contacts?q=${encodeURIComponent(query)}`)
                .then(({ contacts }) => { if (n === asked.current) setFound({ query, contacts }); })
                .catch(() => { /* no suggestions this time */ });
        }, SUGGEST_DELAY_MS);
        return () => clearTimeout(wait);
    }, [query]);

    const pick = (contact: Contact) => {
        onChange(withRecipients(recipients, [{ name: contact.name, address: contact.address }]));
        setText('');
        setPicked(0);
    };

    const commit = (value: string) => {
        const added = parseRecipients(value);
        if (added.length) onChange(withRecipients(recipients, added));
    };

    const handleChange = (value: string) => {
        // Everything up to the last comma or semicolon becomes chips; the rest stays typed.
        const cut = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'));
        if (cut >= 0 && !/"[^"]*$|<[^>]*$/.test(value.slice(0, cut))) {
            commit(value.slice(0, cut));
            setText(value.slice(cut + 1).trimStart());
        } else setText(value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            // ⌘↩ sends (the composer handles it): what's typed becomes a chip first.
            if (text.trim()) {
                commit(text);
                setText('');
            }
            return;
        }
        if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setPicked(i => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        } else if (open && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault();
            pick(suggestions[Math.min(picked, suggestions.length - 1)]);
        } else if (open && e.key === 'Escape') {
            e.preventDefault(); // the suggestions close, not the composer
            setFound(null);
        } else if ((e.key === 'Enter' || e.key === 'Tab') && text.trim()) {
            if (e.key === 'Enter') e.preventDefault();
            commit(text);
            setText('');
        } else if (e.key === 'Backspace' && !text && recipients.length) {
            const last = recipients[recipients.length - 1];
            onChange(recipients.slice(0, -1));
            setText(last.name ? `${last.name} <${last.address}>` : last.address);
            e.preventDefault();
        }
    };

    return (
        <div
            ref={rowRef}
            onFocus={() => setInUse(true)}
            onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInUse(false); }}
            // Folded, a click on the row (not one of its buttons) opens it to add or change people.
            onClick={e => { if (folded && !(e.target as HTMLElement).closest('button')) inputRef.current?.focus(); }}
            style={{ ...fieldRow, position: 'relative', ...(folded && { flexWrap: 'nowrap', overflow: 'hidden' }) }}
        >
            <span style={{ flex: `0 0 ${gutter}px`, display: 'flex' }}>{gutterContent}</span>
            {onActivate ? (
                // The row's label opens it: the shared Button's text kind (board P5-1, row 8)
                <Button kind="text" onClick={() => { onActivate(); inputRef.current?.focus(); }} style={{ flex: fieldLabel.flex, justifyContent: 'flex-start' }}>
                    {label}
                </Button>
            ) : (
                <span style={fieldLabel}>{label}</span>
            )}
            {recipients.map((r, i) => (
                <span
                    key={r.address}
                    data-chip=""
                    title={r.invalid ?? r.address}
                    // A red chip can take the focus: Send moves it there when an address needs fixing.
                    tabIndex={r.invalid ? -1 : undefined}
                    data-invalid-recipient={r.invalid ? '' : undefined}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--space-1)',
                        padding: 'var(--space-1) var(--space-1) var(--space-1) var(--space-3)',
                        background: 'var(--fill-selected)',
                        border: r.invalid ? '1px solid var(--danger)' : '1px solid var(--line-2)',
                        borderRadius: 'var(--radius-2)',
                        color: r.invalid ? 'var(--danger)' : 'var(--text-1)',
                        fontSize: 'var(--size-body)',
                        whiteSpace: 'nowrap',
                        // Folded, a first name too long for the line on its own shortens with "…"
                        flexShrink: folded && fits === 1 && i === 0 ? 1 : 0,
                        minWidth: 0,
                        // Past the folded line: out of the way, still measured for the next fold.
                        ...(folded && i >= fits && { position: 'absolute', visibility: 'hidden' })
                    }}
                >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name || r.address}</span>
                    <Tooltip content={`Remove ${r.name || r.address}`}>
                        <button
                            type="button"
                            aria-label={`Remove ${r.name || r.address}`}
                            onClick={() => onChange(recipients.filter(x => x !== r))}
                            className="em-icon-button"
                            style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: 'var(--radius-1)', // square, its hover fill radius 4 (owner, Checkpoint D)
                                border: 0,
                                background: 'transparent',
                                color: 'var(--text-3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0,
                                cursor: 'pointer'
                            }}
                        >
                            <X size={14} aria-hidden="true" />
                        </button>
                    </Tooltip>
                </span>
            ))}
            {hidden > 0 && (
                // The text kind (owner, Checkpoint D)
                <Button kind="text"
                    tabIndex={-1} // the field itself opens the row from the keyboard
                    title={`Show all ${recipients.length}`}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => inputRef.current?.focus()}
                    style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                    +{hidden} more
                </Button>
            )}
            <TextInput
                bare
                ref={inputRef}
                aria-label={label}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={open ? `${listId}-${Math.min(picked, suggestions.length - 1)}` : undefined}
                type="email"
                value={text}
                autoFocus={autoFocus}
                placeholder={recipients.length || text ? '' : placeholder}
                onChange={e => { handleChange(e.target.value); setPicked(0); }}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                    if (!text.trim()) return;
                    commit(text);
                    setText('');
                }}
                onClick={onActivate}
                onFocus={onActivate}
                style={{ flex: 1, minWidth: folded ? 0 : '60px', padding: 'var(--space-1) 0' }}
            />
            {trailing && <span ref={trailingRef} style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }}>{trailing}</span>}
            {open && (
                <div id={listId} role="listbox" aria-label="Suggestions" style={{
                    position: 'absolute',
                    zIndex: 25, // layer: popover, local (inside the composer)
                    left: `${gutter + 66}px`,
                    top: '100%',
                    width: '340px',
                    maxWidth: 'calc(100% - 20px)',
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--radius-3)',
                    boxShadow: 'var(--shadow-raised)',
                    padding: 'var(--space-1)'
                }}>
                    {suggestions.map((c, i) => (
                        <div
                            key={c.address}
                            id={`${listId}-${i}`}
                            role="option"
                            aria-selected={i === picked}
                            onMouseDown={e => { e.preventDefault(); pick(c); }} // before the field loses focus
                            onMouseEnter={() => setPicked(i)}
                            style={{
                                padding: 'var(--space-2) var(--space-3)',
                                borderRadius: 'max(var(--radius-1), calc(var(--radius-3) - var(--space-1)))',
                                background: i === picked ? 'var(--surface-1)' : 'transparent',
                                fontSize: 'var(--size-body)',
                                color: 'var(--text-1)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                cursor: 'pointer'
                            }}
                        >
                            {c.name ? <><Marked text={c.name} typed={query} /> <span style={{ color: 'var(--text-3)' }}><Marked text={c.address} typed={query} /></span></>
                                : <Marked text={c.address} typed={query} />}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
