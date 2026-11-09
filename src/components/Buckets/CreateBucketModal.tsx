import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { formatCount } from '../../utils/format';
import { BUCKET_ICONS, bucketIconName, iconValue } from '../../utils/bucketIcons';

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

// The swatches: the design system's bucket palette (index.css) and the hex each one saves as (a
// bucket's colour is stored on the server as hex). The hex sits on the swatch as data-hex, so how a
// theme shows a swatch (muted in dark) never changes what's saved.
const SWATCHES = [
    { variable: '--bucket-red', hex: '#ff3b30' },
    { variable: '--bucket-orange', hex: '#e67e22' },
    { variable: '--bucket-yellow', hex: '#f1c40f' },
    { variable: '--bucket-green', hex: '#2ecc71' },
    { variable: '--bucket-blue', hex: '#3498db' },
    { variable: '--bucket-purple', hex: '#9b59b6' },
    { variable: '--bucket-gray', hex: '#95a5a6' },
    { variable: '--bucket-dark', hex: '#2c3e50' },
];
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
    const [color, setColor] = useState(() => initialColor ?? DEFAULT_HEX);
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
            setColor(initialColor ?? DEFAULT_HEX);
            setEmoji(initialEmoji);
            setShowBadge(initialShowBadge);
            setShowOnHome(initialShowOnHome);
            setAutoArchive(initialAutoArchiveDays !== null);
            setDays(String(initialAutoArchiveDays ?? DEFAULT_DAYS));
        }
    }, [isOpen, initialLabel, initialColor, initialEmoji, initialShowBadge, initialShowOnHome, initialAutoArchiveDays]);

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

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => {
                            if (label.trim()) save();
                            onClose();
                        }}
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'var(--modal-scrim)',
                            backdropFilter: 'blur(var(--blur-modal))',
                            zIndex: 200
                        }}
                    />

                    {/* Modal. Centred by a wrapper: the motion's own transform would replace a translate here. */}
                    <div style={{ position: 'fixed', top: '40%', left: '50%', transform: 'translate(-50%, -40%)', width: '100%', maxWidth: '400px', zIndex: 201 }}>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        style={{
                            backgroundColor: 'var(--surface-raised)',
                            borderRadius: 'var(--radius-tile)',
                            padding: '24px',
                            width: '100%',
                            maxWidth: '400px',
                            maxHeight: '85vh',
                            overflowY: 'auto',
                            boxShadow: 'var(--shadow-dialog)',
                            border: '1px solid var(--border-strong)'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 'var(--weight-semibold)' }}>
                                {mode === 'create' ? 'New bucket' : 'Edit bucket'}
                            </h2>
                            <button
                                onClick={onClose}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    color: 'var(--color-text-muted)'
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-muted)' }}>
                                    Label
                                </label>
                                <input
                                    type="text"
                                    value={label}
                                    onChange={(e) => setLabel(e.target.value)}
                                    placeholder="e.g. Projects, Finance"
                                    autoFocus
                                    style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: 'max(4px, calc(var(--radius-tile) - 24px))',
                                        border: '1px solid var(--border-strong)',
                                        background: 'var(--input-bg)',
                                        color: 'var(--input-text)',
                                        fontSize: 'var(--font-size-base)',
                                        outline: 'none',
                                        transition: 'border-color var(--dur-fast) var(--ease)'
                                    }}
                                    onFocus={(e) => e.target.style.borderColor = 'var(--color-action)'}
                                    onBlur={(e) => e.target.style.borderColor = 'var(--border-strong)'}
                                />
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <span id="bucket-icon-label" style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-muted)' }}>
                                    Icon
                                </span>
                                {/* 8 × 4 line icons; the picked one has the step-up surface and a hairline ring (the dialog is
                                    already on the raised surface). Picking it again goes back to the label's first letter. */}
                                <div role="group" aria-labelledby="bucket-icon-label" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 36px)', gap: '8px' }}>
                                    {BUCKET_ICONS.map(([name, Icon]) => {
                                        const picked = name === pickedIcon;
                                        return (
                                            <button
                                                key={name}
                                                type="button"
                                                className="icon-cell"
                                                aria-label={name.replace(/-/g, ' ')}
                                                title={name.replace(/-/g, ' ')}
                                                aria-pressed={picked}
                                                onClick={() => setEmoji(picked ? '' : iconValue(name))}
                                                style={{
                                                    width: '36px',
                                                    height: '36px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    padding: 0,
                                                    borderRadius: 'max(4px, calc(var(--radius-tile) - 24px))',
                                                    border: 'none',
                                                    background: picked ? 'var(--color-bg-hover)' : 'transparent',
                                                    boxShadow: picked ? 'inset 0 0 0 1px var(--border-strong)' : 'none',
                                                    color: picked ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                                                    cursor: 'pointer',
                                                    transition: 'background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)'
                                                }}
                                            >
                                                <Icon size={16} aria-hidden="true" />
                                            </button>
                                        );
                                    })}
                                </div>
                                {emoji && !pickedIcon && (
                                    <span style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginTop: '8px' }}>
                                        Shows <span style={{ filter: 'grayscale(1)' }}>{emoji}</span> until you pick an icon
                                    </span>
                                )}
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-muted)' }}>
                                    Color
                                </label>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    {SWATCHES.map((swatch) => {
                                        const picked = color.toLowerCase() === swatch.hex;
                                        return (
                                            <button
                                                key={swatch.variable}
                                                type="button"
                                                data-hex={swatch.hex}
                                                onClick={e => setColor(e.currentTarget.dataset.hex ?? swatch.hex)}
                                                style={{
                                                    width: 'var(--swatch-size)',
                                                    height: 'var(--swatch-size)',
                                                    borderRadius: '50%',
                                                    backgroundColor: `var(${swatch.variable})`,
                                                    filter: 'var(--swatch-filter)',
                                                    border: picked ? '3px solid var(--surface-raised)' : 'none',
                                                    boxShadow: picked ? `0 0 0 2px var(${swatch.variable})` : 'none',
                                                    cursor: 'pointer',
                                                    transition: 'box-shadow var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)'
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                            </div>

                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={showBadge}
                                        onChange={(e) => setShowBadge(e.target.checked)}
                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                    />
                                    <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-main)' }}>
                                        Show thread count badge
                                    </span>
                                </label>
                                <span style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginTop: '4px', marginLeft: '24px' }}>
                                    The number of threads, on its tile
                                </span>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={showOnHome}
                                        onChange={(e) => setShowOnHome(e.target.checked)}
                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                    />
                                    <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-main)' }}>
                                        Show on home
                                    </span>
                                </label>
                                <span style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginTop: '4px', marginLeft: '24px' }}>
                                    Its mail also appears in Up next, above the Inbox
                                </span>
                            </div>

                            <div style={{ marginBottom: '24px', marginTop: '-8px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={autoArchive}
                                        onChange={(e) => setAutoArchive(e.target.checked)}
                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                    />
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-main)' }}>
                                        Archive threads older than
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            min={1}
                                            max={MAX_DAYS}
                                            aria-label="Days"
                                            aria-invalid={autoArchive && !validDays}
                                            value={days}
                                            disabled={!autoArchive}
                                            onChange={(e) => setDays(e.target.value)}
                                            style={{
                                                width: '56px',
                                                padding: '4px 8px',
                                                borderRadius: 'max(4px, calc(var(--radius-tile) - 24px))',
                                                border: `1px solid ${autoArchive && !validDays ? 'var(--color-danger)' : 'var(--border-strong)'}`,
                                                fontFamily: 'inherit',
                                                fontSize: 'var(--font-size-sm)',
                                                color: 'var(--color-text-main)',
                                                background: 'var(--surface-card)',
                                                opacity: autoArchive ? 1 : 0.5
                                            }}
                                        />
                                        days
                                    </span>
                                </label>
                                <span style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', marginTop: '4px', marginLeft: '24px' }}>
                                    Checked once a day while the app is running
                                </span>
                                {archivesNow > 0 && (
                                    <span role="status" style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-main)', marginTop: '4px', marginLeft: '24px' }}>
                                        This archives <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(archivesNow)}</span> thread{archivesNow === 1 ? '' : 's'}
                                    </span>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    style={{
                                        padding: '8px 20px',
                                        borderRadius: 'max(4px, calc(var(--radius-tile) - 24px))',
                                        border: '1px solid var(--border-strong)',
                                        backgroundColor: 'var(--surface-raised)',
                                        fontSize: 'var(--font-size-sm)',
                                        fontWeight: 'var(--weight-semibold)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!label.trim() || (autoArchive && !validDays)}
                                    style={{
                                        padding: '8px 20px',
                                        borderRadius: 'max(4px, calc(var(--radius-tile) - 24px))',
                                        border: 'none',
                                        backgroundColor: 'var(--color-action)',
                                        color: 'var(--color-on-action)',
                                        fontSize: 'var(--font-size-sm)',
                                        fontWeight: 'var(--weight-semibold)',
                                        cursor: label.trim() && (!autoArchive || validDays) ? 'pointer' : 'not-allowed',
                                        opacity: label.trim() && (!autoArchive || validDays) ? 1 : 0.5
                                    }}
                                >
                                    Save
                                </button>
                            </div>
                        </form>
                    </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};
