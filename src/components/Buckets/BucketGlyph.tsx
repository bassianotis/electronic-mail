import React from 'react';
import { bucketIcon, bucketIconName, glyphText } from '../../utils/bucketIcons';

/** A bucket's glyph: its line icon at `size` (in the current text colour), or else its emoji or the
 * label's first letter in `fallbackStyle`. */
export const BucketGlyph: React.FC<{ stored?: string | null; label: string; size: number; fallbackStyle: React.CSSProperties }> = ({ stored, label, size, fallbackStyle }) => {
    const icon = bucketIcon(bucketIconName(stored));
    if (icon) return React.createElement(icon, { size, 'aria-hidden': true, style: { flexShrink: 0 } });
    return <span aria-hidden="true" style={fallbackStyle}>{glyphText(stored, label)}</span>;
};
