import DOMPurify from 'dompurify';

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
