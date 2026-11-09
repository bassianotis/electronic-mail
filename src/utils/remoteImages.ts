/**
 * Outside images in an email: loading one tells its sender you opened the message, when, and from
 * where. They're hidden until the person asks, one message at a time. Images sent with the message
 * itself (cid: parts, which the engine turns into data: URIs) aren't outside images and always show.
 *
 * MailFrame's content policy blocks every outside load anyway; this finds whether a message has any
 * (so the strip shows only when it does), and swaps each outside <img> for a placeholder that keeps
 * its space, so nothing jumps when images load. Tracking pixels (1×1 or hidden) get none.
 */

/** How the placeholders look: on the lamplit paper (HTML mail with its own look), in a plain email
 * in the theme's colours, or in Reader. */
export type PlaceholderLook = 'paper' | 'theme' | 'reader';

const REMOTE_URL = /^\s*(https?:)?\/\//i;
const CSS_REMOTE = /url\(\s*['"]?\s*(https?:)?\/\/|@import/i;

/** The lucide Image icon, 20px, in the placeholder's text colour. */
export const IMAGE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>';

const isRemote = (url: string | null) => !!url && REMOTE_URL.test(url);
const srcsetIsRemote = (srcset: string | null) => !!srcset && srcset.split(',').some(part => isRemote(part.trim().split(/\s+/)[0]));

/** A length in px from an attribute ("600", "600px") or an inline style; null when it isn't one. */
function px(attr: string | null, style: string, prop: 'width' | 'height'): number | null {
    const fromAttr = attr && /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(attr);
    if (fromAttr) return Math.round(Number(fromAttr[1]));
    const fromStyle = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i').exec(style);
    return fromStyle ? Math.round(Number(fromStyle[1])) : null;
}

/** The last part of an image's address ("pickup-saturday.jpg"), for a plain email's placeholder. */
export function fileNameOf(url: string | null): string {
    if (!url) return '';
    try {
        const name = new URL(url, 'https://x.invalid').pathname.split('/').filter(Boolean).pop() ?? '';
        return decodeURIComponent(name);
    } catch {
        return '';
    }
}

/** The placeholder's size: the email's own when it gives one, else a sensible default. */
function placeholderSize(w: number | null, h: number | null, look: PlaceholderLook): { width: string; height: string } {
    if (look === 'paper') {
        if (w && h) return { width: `${w}px`, height: `${h}px` };
        if (w) return { width: `${w}px`, height: `${Math.min(Math.round(w * 0.5), 300)}px` };
        return { width: '100%', height: `${h ?? 120}px` };
    }
    // A plain email (or Reader): up to 480px wide, the email's proportions when it gives them
    if (w && h) {
        const width = Math.min(w, 480);
        return { width: `${width}px`, height: `${Math.round(h * (width / w))}px` };
    }
    const width = Math.min(w ?? 480, 480);
    return { width: `${width}px`, height: `${h ?? Math.round(width * 0.625)}px` };
}

/** Builds one placeholder element (also built by MailFrame's script for an image that fails to load). */
export function placeholderMarkup(doc: Document, label: string, size: { width: string; height: string }): HTMLElement {
    const ph = doc.createElement('span');
    ph.className = 'em-ph';
    ph.setAttribute('role', 'img');
    ph.setAttribute('aria-label', label ? `Image hidden: ${label}` : 'Image hidden');
    ph.style.width = size.width;
    ph.style.height = size.height;
    ph.innerHTML = IMAGE_ICON;
    if (label) {
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

/**
 * Finds outside images in sanitized HTML and, unless `allowImages`, swaps each outside <img> for a
 * placeholder. Other outside loads (CSS backgrounds, the `background` attribute, video posters)
 * count as outside images too; they simply don't show until loaded.
 */
export function prepareBody(html: string, look: PlaceholderLook, allowImages: boolean): PreparedBody {
    if (!html || !/(src|url|background|@import|poster)/i.test(html)) return { html, remote: false };
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
    let remote = false;

    for (const img of Array.from(doc.querySelectorAll('img'))) {
        const src = img.getAttribute('src');
        const srcset = img.getAttribute('srcset');
        if (!isRemote(src) && !srcsetIsRemote(srcset)) continue;
        remote = true;
        if (allowImages) continue;
        const style = img.getAttribute('style') ?? '';
        const w = px(img.getAttribute('width'), style, 'width');
        const h = px(img.getAttribute('height'), style, 'height');
        const hidden = img.hasAttribute('hidden') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
        if (hidden || (w !== null && w <= 2) || (h !== null && h <= 2)) {
            img.remove(); // a tracking pixel: no placeholder
            continue;
        }
        const label = look === 'paper' ? (img.getAttribute('alt') ?? '').trim() : fileNameOf(src) || (img.getAttribute('alt') ?? '').trim();
        img.replaceWith(placeholderMarkup(doc, label, placeholderSize(w, h, look)));
    }
    for (const el of Array.from(doc.querySelectorAll('[background]'))) {
        if (isRemote(el.getAttribute('background'))) {
            remote = true;
            if (!allowImages) el.removeAttribute('background');
        }
    }
    for (const el of Array.from(doc.querySelectorAll('video[poster], source[srcset], source[src]'))) {
        if (isRemote(el.getAttribute('poster')) || srcsetIsRemote(el.getAttribute('srcset')) || isRemote(el.getAttribute('src'))) remote = true;
    }
    if (!remote) {
        remote = Array.from(doc.querySelectorAll('[style]')).some(el => CSS_REMOTE.test(el.getAttribute('style') ?? ''))
            || Array.from(doc.querySelectorAll('style')).some(el => CSS_REMOTE.test(el.textContent ?? ''));
    }
    return { html: remote && !allowImages ? doc.body.innerHTML : html, remote };
}
