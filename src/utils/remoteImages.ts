/**
 * Outside images in an email: loading one tells its sender you opened the message, when, and from
 * where. They're hidden until the person asks, one message at a time. Images sent with the message
 * itself (cid: parts, which the engine turns into data: URIs) aren't outside images and always show.
 *
 * MailFrame's content policy blocks every outside load anyway (Reader is in the frame too); this
 * finds whether a message has any (so the strip shows only when it does), and swaps each outside
 * <img> for a placeholder that keeps its space, so nothing jumps when images load. Tracking pixels
 * (1×1 or hidden) get none.
 *
 * "Outside" is an allow-list: every address is resolved the way the browser would (new URL), and
 * anything that isn't data: or cid: is outside. So odd spellings that a pattern would miss
 * (`\\host/p.png`, `https:\\host`, `/\host`, a tab inside "https") are caught too.
 */

/** How the placeholders look: on the lamplit paper (HTML mail with its own look), in a plain email
 * in the theme's colours, or in Reader. */
export type PlaceholderLook = 'paper' | 'theme' | 'reader';

const BASE = 'https://x.invalid/';

/** Whether loading this address would reach outside the message (anything but data: and cid:). */
export function isOutside(url: string | null | undefined): boolean {
    if (url == null || !url.trim()) return false; // no address: nothing loads
    try {
        const { protocol } = new URL(url, BASE);
        return protocol !== 'data:' && protocol !== 'cid:';
    } catch {
        return true; // one the parser can't read counts as outside
    }
}

/** The addresses in a srcset, read the way the browser does (a data: address may hold commas). */
export function srcsetUrls(srcset: string): string[] {
    const urls: string[] = [];
    let i = 0;
    while (i < srcset.length) {
        while (i < srcset.length && /[\s,]/.test(srcset[i])) i++;
        const start = i;
        while (i < srcset.length && !/\s/.test(srcset[i])) i++;
        let url = srcset.slice(start, i);
        if (url.endsWith(',')) url = url.replace(/,+$/, '');
        else while (i < srcset.length && srcset[i] !== ',') i++; // its descriptors ("2x", "600w")
        if (url) urls.push(url);
    }
    return urls;
}

const srcsetIsOutside = (srcset: string | null) => !!srcset && srcsetUrls(srcset).some(isOutside);

/** Whether CSS would load anything from outside: url(), image-set() and @import, with CSS escapes undone. */
export function cssIsOutside(css: string): boolean {
    if (!css) return false;
    const text = css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16) || 0xfffd))
        .replace(/\\(.)/g, '$1');
    if (/@import/i.test(text)) return true;
    for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
        if (isOutside(m[1] ?? m[2] ?? m[3])) return true;
    }
    for (const m of text.matchAll(/image-set\(([^)]*)\)/gi)) {
        for (const q of m[1].matchAll(/"([^"]*)"|'([^']*)'/g)) if (isOutside(q[1] ?? q[2])) return true;
    }
    return false;
}

/** The lucide Image icon, 20px (14px in a chip), in the placeholder's text colour. */
export const IMAGE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>';

/** A length in px from an attribute ("600", "600px") or an inline style; null when it isn't one. */
function px(attr: string | null, style: string, prop: 'width' | 'height'): number | null {
    const fromAttr = attr && /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(attr);
    if (fromAttr) return Math.round(Number(fromAttr[1]));
    const fromStyle = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i').exec(style);
    return fromStyle ? Math.round(Number(fromStyle[1])) : null;
}

export const IMAGE_ICON_SMALL = IMAGE_ICON.replace('width="20" height="20"', 'width="14" height="14"');

/** The last part of an image's address ("pickup-saturday.jpg"), for a plain email's placeholder. */
export function fileNameOf(url: string | null): string {
    let current = url ?? '';
    // Image services that resize a picture carry its real address inside theirs (Substack's
    // ".../fetch/w_1100/https%3A%2F%2F..."): that address's own file name is the one to show.
    for (let depth = 0; depth < 3 && current; depth++) {
        let name: string;
        try {
            name = decodeURIComponent(new URL(current, 'https://x.invalid').pathname.split('/').filter(Boolean).pop() ?? '');
        } catch {
            return '';
        }
        if (!/^https?:\/\//i.test(name)) return name;
        current = name;
    }
    return '';
}

/**
 * A hidden image's placeholder: a box at the image's real size when the email gives both sides and
 * neither is under 120px; otherwise a one-line chip (the icon and the file name). A chip is never
 * wider than the email made room for (its width, when it gives one), so the layout stays as
 * designed; under ICON_ONLY_BELOW wide (a button's icon) it's the icon alone, at the image's size.
 * The same rule is in public/mail-frame.js, for an image that fails once loaded.
 */
export type PlaceholderShape =
    | { kind: 'box'; width: number; height: number }
    | { kind: 'chip'; width?: number; height?: number };

export const ICON_ONLY_BELOW = 96;

export function placeholderShape(w: number | null, h: number | null): PlaceholderShape {
    if (w && h && w >= 120 && h >= 120) return { kind: 'box', width: w, height: h };
    return { kind: 'chip', ...(w ? { width: w } : {}), ...(h ? { height: h } : {}) };
}

/** Builds one placeholder: `label` is what it shows, `name` what a screen reader hears. */
export function placeholderMarkup(doc: Document, shape: PlaceholderShape, label: string, name: string): HTMLElement {
    const ph = doc.createElement('span');
    ph.className = shape.kind === 'chip' ? 'em-ph em-chip' : 'em-ph';
    ph.setAttribute('role', 'img');
    ph.setAttribute('aria-label', name ? `Hidden image: ${name}` : 'Hidden image');
    const iconOnly = shape.kind === 'chip' && !!shape.width && shape.width < ICON_ONLY_BELOW;
    if (shape.kind === 'box') {
        ph.style.width = `${shape.width}px`;
        ph.style.aspectRatio = `${shape.width} / ${shape.height}`;
    } else if (iconOnly) {
        ph.classList.add('em-chip-icon');
        ph.style.width = `${Math.max(shape.width!, 20)}px`;
        if (shape.height) ph.style.height = `${Math.max(shape.height, 20)}px`;
    } else if (shape.width) {
        ph.style.maxWidth = `min(100%, ${shape.width}px)`;
    }
    ph.innerHTML = shape.kind === 'chip' ? IMAGE_ICON_SMALL : IMAGE_ICON;
    if (label && !iconOnly) {
        const text = doc.createElement('span');
        text.className = 'em-ph-label';
        text.textContent = label;
        ph.appendChild(text);
    }
    return ph;
}

export interface PreparedBody {
    html: string;
    /** It has outside images (the strip shows). */
    remote: boolean;
}

/** Attributes that load something, besides <img>'s own src and srcset (href only on <link>). */
const LOADING_ATTRS = ['src', 'srcset', 'background', 'poster', 'href'] as const;

/**
 * Finds outside loads in sanitized HTML and, unless `allowImages`, swaps each outside <img> for a
 * placeholder and takes outside addresses off everything else (backgrounds, video posters, media,
 * links to stylesheets). Outside CSS (url(), image-set(), @import) counts too; the frame's content
 * policy keeps it from loading until images are loaded.
 */
export function prepareBody(html: string, look: PlaceholderLook, allowImages: boolean): PreparedBody {
    if (!html) return { html, remote: false };
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
    let remote = false;
    let changed = false;

    for (const img of Array.from(doc.querySelectorAll('img'))) {
        const src = img.getAttribute('src');
        if (!isOutside(src) && !srcsetIsOutside(img.getAttribute('srcset'))) continue;
        remote = true;
        if (allowImages) continue;
        changed = true;
        const style = img.getAttribute('style') ?? '';
        const w = px(img.getAttribute('width'), style, 'width');
        const h = px(img.getAttribute('height'), style, 'height');
        const hidden = img.hasAttribute('hidden') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
        if (hidden || (w !== null && w <= 2) || (h !== null && h <= 2)) {
            img.remove(); // a tracking pixel: no placeholder
            continue;
        }
        const alt = (img.getAttribute('alt') ?? '').trim();
        const file = fileNameOf(src);
        const shape = placeholderShape(w, h);
        // A chip names the file; a box on paper shows the sender's own words for it, elsewhere the file
        const label = shape.kind === 'chip' ? file || alt : look === 'paper' ? alt : file || alt;
        img.replaceWith(placeholderMarkup(doc, shape, label, alt || file));
    }
    for (const el of Array.from(doc.body.querySelectorAll('*'))) {
        if (el.tagName === 'IMG') continue;
        for (const name of LOADING_ATTRS) {
            const value = el.getAttribute(name);
            if (value === null || (name === 'href' && el.tagName !== 'LINK')) continue; // a link loads only when clicked
            if (!(name === 'srcset' ? srcsetIsOutside(value) : isOutside(value))) continue;
            remote = true;
            if (!allowImages) { el.removeAttribute(name); changed = true; }
        }
        const style = el.getAttribute('style');
        if (style && cssIsOutside(style)) remote = true;
        if (el.tagName === 'STYLE' && cssIsOutside(el.textContent ?? '')) remote = true;
    }
    return { html: changed ? doc.body.innerHTML : html, remote };
}
