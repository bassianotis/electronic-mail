/**
 * Bucket icons: a line icon is stored by its lucide name in the bucket's emoji field
 * ("icon:book-open"), so nothing migrates and settings export/import carry it as it is. Emoji from
 * before show as their icon when there's an obvious one; any other emoji shows as it is (greyscale)
 * until an icon is picked.
 */
import {
    Ban, Bell, Bookmark, BookOpen, Briefcase, Calendar, Camera, Clock, Coffee, CreditCard, FileText, Flag, Folder, Globe,
    GraduationCap, Heart, Hourglass, House, Inbox, Leaf, Mail, MapPin, Music, Newspaper, Receipt, Reply, ShoppingBag,
    SquareCheck, Star, Tag, Users, Wrench, type LucideIcon,
} from 'lucide-react';

/** The picker's icons, in its order (8 across, 4 down). */
export const BUCKET_ICONS: readonly (readonly [string, LucideIcon])[] = [
    ['inbox', Inbox], ['calendar', Calendar], ['square-check', SquareCheck], ['ban', Ban],
    ['book-open', BookOpen], ['receipt', Receipt], ['reply', Reply], ['hourglass', Hourglass],
    ['star', Star], ['heart', Heart], ['house', House], ['briefcase', Briefcase],
    ['map-pin', MapPin], ['shopping-bag', ShoppingBag], ['credit-card', CreditCard], ['music', Music],
    ['camera', Camera], ['file-text', FileText], ['folder', Folder], ['bookmark', Bookmark],
    ['tag', Tag], ['bell', Bell], ['clock', Clock], ['users', Users],
    ['mail', Mail], ['flag', Flag], ['globe', Globe], ['coffee', Coffee],
    ['graduation-cap', GraduationCap], ['leaf', Leaf], ['newspaper', Newspaper], ['wrench', Wrench],
];
const BY_NAME = new Map(BUCKET_ICONS);

/** Emoji with an obvious icon (variation selectors stripped first). */
const FROM_EMOJI: Record<string, string> = {
    '📆': 'calendar', '☑': 'square-check', '🚫': 'ban', '📖': 'book-open', '🧾': 'receipt',
    '📤': 'reply', '📂': 'folder', '📁': 'folder', '🌐': 'globe',
};

export const iconValue = (name: string) => `icon:${name}`;

/** The icon a stored value stands for: its own name, or a known emoji's; null for anything else. */
export function bucketIconName(stored?: string | null): string | null {
    if (!stored) return null;
    if (stored.startsWith('icon:')) return BY_NAME.has(stored.slice(5)) ? stored.slice(5) : null;
    return FROM_EMOJI[stored.replace(/️/g, '')] ?? null;
}

export const bucketIcon = (name: string | null): LucideIcon | undefined => (name ? BY_NAME.get(name) : undefined);

/** What shows when there's no icon: the emoji as it is, or the label's first letter. */
export const glyphText = (stored: string | null | undefined, label: string) =>
    stored && !stored.startsWith('icon:') ? stored : label.charAt(0);
