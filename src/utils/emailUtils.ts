import { inertDiv } from './inertHtml';

/**
 * Extract the first meaningful paragraph from HTML content for email preview
 */
export function extractFirstParagraph(html: string, maxLength: number = 150): string {
    if (!html) return '';

    // Parse it where nothing loads (utils/inertHtml.ts)
    const tempDiv = inertDiv(html);

    // Remove script and style elements
    const scripts = tempDiv.querySelectorAll('script, style');
    scripts.forEach(el => el.remove());

    // Try to find the first paragraph
    const paragraphs = tempDiv.querySelectorAll('p');

    for (const p of Array.from(paragraphs)) {
        const text = p.textContent?.trim() || '';

        // Skip if it's too short - we want at least 20 characters of meaningful content
        if (text.length < 20) continue;

        // Skip common email footers/headers patterns
        const skipPatterns = [
            /unsubscribe/i,
            /view.*browser/i,
            /click here/i,
            /^https?:\/\//,
            /^www\./,
            /privacy policy/i,
            /terms of service/i,
            /^©/,
            /all rights reserved/i
        ];

        const shouldSkip = skipPatterns.some(pattern => pattern.test(text));
        if (shouldSkip) continue;

        // This looks like a good paragraph, use it
        if (text.length > maxLength) {
            return text.substring(0, maxLength).trim() + '...';
        }
        return text;
    }

    // If no good paragraph found, try getting first meaningful text from any element
    const allText = tempDiv.textContent?.trim() || '';
    const lines = allText.split('\n').map(line => line.trim()).filter(line => line.length >= 20);

    if (lines.length > 0) {
        const firstLine = lines[0];
        if (firstLine.length > maxLength) {
            return firstLine.substring(0, maxLength).trim() + '...';
        }
        return firstLine;
    }

    return '';
}

/** Elements read as part of a line, not as blocks of their own. */
const INLINE = new Set(['a', 'abbr', 'b', 'big', 'cite', 'code', 'del', 'em', 'font', 'i', 'ins', 'kbd', 'label', 'mark', 'q', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr']);
const BLOCKS = 'address, article, aside, blockquote, center, dd, div, dl, dt, figure, footer, h1, h2, h3, h4, h5, h6, header, hr, li, main, ol, p, pre, section, table, td, th, tr, ul';
/** Clutter, removed before reading: scripts, forms, logos and tracking pixels, hidden text. */
const CLUTTER = [
    'script', 'style', 'button', 'input', 'form', 'svg', 'nav', '[role="navigation"]',
    '.unsubscribe', '[hidden]', '[style*="display: none"]', '[style*="display:none"]',
    '[style*="font-size: 1px"]', '[style*="font-size:1px"]', 'a[href*="unsubscribe"]',
];
/** Lines that are only a newsletter's furniture. */
const FURNITURE = [
    /^(unsubscribe|view (it |this (email |message )?)?(in|on) (your |a |the )?(web )?browser|click here|privacy policy|terms of service|manage (your )?(email )?preferences)\.?$/i,
    /^©\s*\d{4}/,
    /^all rights reserved\.?$/i,
    /^https?:\/\/\S+$/,
    /^www\.\S+$/,
];

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textOf = (el: Element | DocumentFragment) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const isFurniture = (text: string) => FURNITURE.some(pattern => pattern.test(text));

/** A picture worth reading around: not a tracking pixel, an icon or a logo. */
function keepImage(img: Element): boolean {
    const width = parseInt(img.getAttribute('width') || '0');
    const height = parseInt(img.getAttribute('height') || '0');
    return !((width > 0 && width < 50) || (height > 0 && height < 50));
}

/** A small table of facts (a bill's lines): no tables inside, only words in its cells, and two columns or more. */
function isDataTable(table: Element): boolean {
    if (table.querySelector('table')) return false;
    const cells = Array.from(table.querySelectorAll('td, th'));
    if (!cells.length || cells.some(cell => cell.querySelector(BLOCKS))) return false;
    return Array.from(table.querySelectorAll('tr')).some(row => row.querySelectorAll('td, th').length >= 2);
}

function dataTable(table: Element): string {
    const rows = Array.from(table.querySelectorAll('tr'))
        .map(row => Array.from(row.querySelectorAll('td, th')).map(cell => `<${cell.tagName.toLowerCase()}>${cell.innerHTML.trim()}</${cell.tagName.toLowerCase()}>`).join(''))
        .filter(Boolean);
    return rows.length ? `<table>${rows.map(r => `<tr>${r}</tr>`).join('')}</table>` : '';
}

/**
 * Reader's content (paper mail only; docs/design/reading-view-spec.md, Part 2): the words,
 * headings, lists, quotes, pictures and small tables of facts, in order, without the email's
 * layout. Text is collected from any block, a <div> included (Gmail and this app write a reply's
 * text straight into one), so the message's own words are never dropped: only clutter goes
 * (logos and tracking pixels, hidden text, "Unsubscribe", "View in browser", copyright lines).
 * The caller passes the newest part; quoted history stays behind "Show quoted content".
 */
export function extractReaderContent(html: string): string {
    if (!html) return '';
    const root = inertDiv(html);
    for (const selector of CLUTTER) {
        try { root.querySelectorAll(selector).forEach(el => el.remove()); } catch { /* a selector this browser can't read */ }
    }
    const out: string[] = [];
    let line: string[] = [];

    // The line being collected becomes a paragraph (without line breaks at either end)
    const flush = () => {
        const content = line.join('').replace(/^(\s|<br>)+|(\s|<br>)+$/gi, '');
        line = [];
        if (!content) return;
        const holder = inertDiv(content);
        const text = textOf(holder);
        if (!text && !holder.querySelector('img')) return;
        if (text && isFurniture(text)) return;
        out.push(`<p>${content}</p>`);
    };

    const walk = (node: Node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) { line.push(escapeText(child.textContent ?? '')); continue; }
            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            const el = child as Element;
            const tag = el.tagName.toLowerCase();
            if (tag === 'br') { line.push('<br>'); continue; }
            if (tag === 'img') {
                if (keepImage(el)) { flush(); out.push(el.outerHTML); }
                continue;
            }
            if (INLINE.has(tag) && !el.querySelector(BLOCKS)) {
                if (!isFurniture(textOf(el))) line.push(el.outerHTML);
                continue;
            }
            flush();
            if (/^h[1-6]$/.test(tag)) {
                const text = textOf(el);
                if (text && !isFurniture(text)) out.push(`<${tag}>${el.innerHTML.trim()}</${tag}>`);
            } else if (tag === 'ul' || tag === 'ol') {
                const items = Array.from(el.children).filter(li => li.tagName === 'LI' && textOf(li) && !isFurniture(textOf(li)));
                if (items.length) out.push(`<${tag}>${items.map(li => `<li>${li.innerHTML.trim()}</li>`).join('')}</${tag}>`);
            } else if (tag === 'blockquote') {
                const inner = extractReaderContent(el.innerHTML);
                if (inner) out.push(`<blockquote>${inner}</blockquote>`);
            } else if (tag === 'pre') {
                if (textOf(el)) out.push(`<pre>${el.innerHTML}</pre>`);
            } else if (tag === 'table' && isDataTable(el)) {
                out.push(dataTable(el));
            } else if (tag !== 'hr') {
                walk(el); // a block or container (div, p, td, section...): its text, in order
            }
            flush();
        }
    };
    walk(root);
    flush();
    return out.join('');
}
