import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { formatCount } from '../../utils/format';
import { BUCKET_ICONS, ICON_WORDS, bucketIconName, iconValue } from '../../utils/bucketIcons';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Choice';
import { Dialog } from '../../ui/Dialog';
import { Field, TextInput } from '../../ui/Field';
import { Tooltip } from '../../ui/Tooltip';

interface CreateBucketModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (label: string, color: string, emoji?: string, showBadge?: boolean, showOnHome?: boolean, autoArchiveDays?: number | null) => void;
    initialLabel?: string;
    initialColor?: string;
    initialEmoji?: string;
    initialShowBadge?: boolean;
    initialShowOnHome?: boolean;
    initialAutoArchiveDays?: number | null;
    /** How many items a number of days would archive now (an existing bucket's; a new one has none). */
    countOld?: (days: number) => Promise<number>;
    mode?: 'create' | 'edit';
}

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

// A bucket's colour is still stored (the engine, the settings file), but no longer shown or picked
// anywhere (owner, 2026-11-13): an edit keeps the one it has, and a new bucket gets the old default.
const DEFAULT_HEX = '#3498db';

export const CreateBucketModal: React.FC<CreateBucketModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialLabel = '',
    initialColor,
    initialEmoji = '',
    initialShowBadge = false,
    initialShowOnHome = false,
    initialAutoArchiveDays = null,
    countOld,
    mode = 'create'
}) => {
    const [label, setLabel] = useState(initialLabel);
    const color = initialColor ?? DEFAULT_HEX;
    const [emoji, setEmoji] = useState(initialEmoji);
    const [showBadge, setShowBadge] = useState(initialShowBadge);
    const [showOnHome, setShowOnHome] = useState(initialShowOnHome);
    const [autoArchive, setAutoArchive] = useState(initialAutoArchiveDays !== null);
    const [days, setDays] = useState(String(initialAutoArchiveDays ?? DEFAULT_DAYS));
    const [due, setDue] = useState<{ days: number; count: number } | null>(null);

    // Reset state when opening
    React.useEffect(() => {
        if (isOpen) {
            setLabel(initialLabel);
            setEmoji(initialEmoji);
            setShowBadge(initialShowBadge);
            setShowOnHome(initialShowOnHome);
            setAutoArchive(initialAutoArchiveDays !== null);
            setDays(String(initialAutoArchiveDays ?? DEFAULT_DAYS));
        }
    }, [isOpen, initialLabel, initialEmoji, initialShowBadge, initialShowOnHome, initialAutoArchiveDays]);

    // "Archive threads older than N days": 1 to 365, or off. A change that would archive items now
    // says how many ("This archives 312 items.") before it's saved; saving confirms it.
    const dayCount = Number(days);
    const validDays = /^\d+$/.test(days.trim()) && dayCount >= 1 && dayCount <= MAX_DAYS;
    const autoArchiveDays = autoArchive ? (validDays ? dayCount : initialAutoArchiveDays) : null;
    const changed = autoArchive && validDays && dayCount !== initialAutoArchiveDays;
    useEffect(() => {
        if (!isOpen || !changed || !countOld) return;
        let current = true;
        const wait = setTimeout(() => {
            countOld(dayCount).then(count => { if (current) setDue({ days: dayCount, count }); }).catch(() => { /* no count shown */ });
        }, 250);
        return () => { current = false; clearTimeout(wait); };
    }, [isOpen, changed, countOld, dayCount]);
    const archivesNow = changed && due?.days === dayCount ? due.count : 0;

    // The icon: a line icon by name; an emoji from before shows as its icon if it has one, else as it is
    const pickedIcon = bucketIconName(emoji);

    const save = () => onSave(label, color, emoji || undefined, showBadge, showOnHome, autoArchiveDays);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (label.trim() && (!autoArchive || validDays)) {
            save();
            onClose();
        }
    };

    // A click outside closes it only while nothing has changed (owner, 2026-11-13); it never saves.
    // Esc and Cancel close it without saving.
    const dirty = label !== initialLabel || emoji !== initialEmoji
        || showBadge !== initialShowBadge || showOnHome !== initialShowOnHome
        || autoArchive !== (initialAutoArchiveDays !== null) || days !== String(initialAutoArchiveDays ?? DEFAULT_DAYS);
    const canSave = !!label.trim() && (!autoArchive || validDays);

    return (
        <AnimatePresence>
            {isOpen && (
                <Dialog key="bucket-dialog" titleId="bucket-dialog-title" title={mode === 'create' ? 'New bucket' : 'Edit bucket'} onClose={onClose} dirty={dirty}
                    onSubmit={handleSubmit}
                    actions={<>
                        <Button onClick={onClose}>Cancel</Button>
                        <Button kind="primary" type="submit" disabled={!canSave}>Save</Button>
                    </>}>
                    <Field label="Label" htmlFor="bucket-label">
                        <TextInput id="bucket-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Projects, Finance" autoFocus />
                    </Field>

                    <Field label="Icon" labelId="bucket-icon-label">
                        {/* 8 × 4 line icons; the picked one has the step-up surface and a hairline ring (the dialog is
                            already on the raised surface). Picking it again goes back to the label's first letter. */}
                        <div role="group" aria-labelledby="bucket-icon-label" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 36px)', gap: 'var(--space-2)' }}>
                            {BUCKET_ICONS.map(([name, Icon]) => {
                                const picked = name === pickedIcon;
                                return (
                                    <Tooltip key={name} content={ICON_WORDS[name] ?? name}>
                                        <button
                                            type="button"
                                            className="icon-cell"
                                            aria-label={ICON_WORDS[name] ?? name}
                                            aria-pressed={picked}
                                            onClick={() => setEmoji(picked ? '' : iconValue(name))}
                                            style={{
                                                width: '36px',
                                                height: '36px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                padding: 0,
                                                borderRadius: 'max(var(--radius-1), calc(var(--radius-3) - var(--space-6)))',
                                                border: 'none',
                                                background: picked ? 'var(--fill-hover)' : 'transparent',
                                                boxShadow: picked ? 'inset 0 0 0 1px var(--line-2)' : 'none',
                                                color: picked ? 'var(--text-1)' : 'var(--text-3)',
                                                cursor: 'pointer',
                                                transition: 'background-color var(--dur-instant) var(--ease-in), color var(--dur-instant) var(--ease-in), box-shadow var(--dur-instant) var(--ease-in)'
                                            }}
                                        >
                                            <Icon size={16} aria-hidden="true" />
                                        </button>
                                    </Tooltip>
                                );
                            })}
                        </div>
                        {emoji && !pickedIcon && (
                            <span style={{ display: 'block', fontSize: 'var(--size-caption)', color: 'var(--text-4)', marginTop: 'var(--space-2)' }}>
                                Shows <span style={{ filter: 'grayscale(1)' }}>{emoji}</span> until you pick an icon
                            </span>
                        )}
                    </Field>

                    <Checkbox checked={showBadge} onChange={e => setShowBadge(e.target.checked)}
                        label="Show thread count badge" hint="The number of threads, on its tile" />

                    <Checkbox checked={showOnHome} onChange={e => setShowOnHome(e.target.checked)}
                        label="Show on home" hint="Its mail also appears in Up next, above the Inbox" />

                    <div>
                        <Checkbox checked={autoArchive} onChange={e => setAutoArchive(e.target.checked)}
                            hint="Checked once a day while the app is running"
                            label={<span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                Archive threads older than
                                <TextInput type="number" inputMode="numeric" min={1} max={MAX_DAYS} aria-label="Days"
                                    invalid={autoArchive && !validDays} value={days} disabled={!autoArchive}
                                    onChange={(e) => setDays(e.target.value)} className="ba-input--inline" />
                                days
                            </span>} />
                        {archivesNow > 0 && (
                            <span role="status" style={{ display: 'block', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-medium)', color: 'var(--text-1)', marginTop: 'var(--space-1)', marginLeft: '26px' }}>
                                This archives <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(archivesNow)}</span> thread{archivesNow === 1 ? '' : 's'}
                            </span>
                        )}
                    </div>
                </Dialog>
            )}
        </AnimatePresence>
    );
};
