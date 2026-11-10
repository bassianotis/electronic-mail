import DOMPurify from 'dompurify';
import { inertDiv } from './inertHtml';

/**
 * Sanitizes HTML content to prevent XSS attacks.
 * Configured to allow common email formatting tags and attributes.
 */
export const sanitizeHtml = (html: string): string => {
    if (!html) return '';

    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_TAGS: ['style', 'img', 'div', 'span', 'p', 'br', 'a', 'table', 'tbody', 'tr', 'td', 'th', 'thead', 'tfoot', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'i', 'strong', 'em', 'u', 's', 'strike', 'hr', 'code', 'pre'],
        ADD_ATTR: ['style', 'class', 'id', 'href', 'target', 'src', 'alt', 'title', 'width', 'height', 'align', 'valign', 'cellpadding', 'cellspacing', 'border', 'bgcolor', 'color'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea'],
        FORBID_ATTR: ['onmouseover', 'onclick', 'onerror', 'onload', 'onfocus', 'onblur'], // Explicitly forbid event handlers
    });
};

/**
 * Reader keeps only the words and pictures: no styles, no media, nothing that loads from outside
 * except <img>, which utils/remoteImages.ts turns into placeholders until the person loads images.
 * It's shown in a frame like any email (MailFrame), so the frame's content policy stands behind this.
 */
export const sanitizeReaderHtml = (html: string): string => {
    if (!html) return '';
    const clean = DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'link', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'video', 'audio', 'source', 'picture', 'track', 'svg', 'math'],
        FORBID_ATTR: ['style', 'background', 'bgcolor', 'color', 'face', 'size', 'srcset', 'poster', 'onmouseover', 'onclick', 'onerror', 'onload', 'onfocus', 'onblur'],
    });
    // An image left with no address (it had only a srcset) would show as a broken icon
    if (!/<img\b/i.test(clean)) return clean;
    const div = inertDiv(clean);
    div.querySelectorAll('img').forEach(img => { if (!(img.getAttribute('src') ?? '').trim()) img.remove(); });
    return div.innerHTML;
};
