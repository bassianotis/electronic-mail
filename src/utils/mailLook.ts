/**
 * Paper or theme (docs/design/reading-view-spec.md, Part 1), one rule for the reading view and the
 * Inbox card. Mail someone designed (sent to a list, or laid out in tables) keeps its own look on
 * the paper sheet. Everything else, your own mail included, is shown in the theme: its colours,
 * backgrounds, fonts, sizes and widths are stripped, so it reads like the rest of the app. The
 * decision looks only at the newest message's own part, never at what it quotes, so a reply that
 * quotes a newsletter stays in the theme.
 */
import { inertDiv } from './inertHtml';

/** The headers that say a message was sent to a list (from the message body). */
export interface ListHeaders {
    listUnsubscribe?: string | null;
    listId?: string | null;
    precedence?: string | null;
}

/** Shown on paper: designed mail from someone else. `newestHtml` is the newest message's own part. */
export function showsOnPaper(newestHtml: string, headers: ListHeaders | null | undefined, fromMe: boolean): boolean {
    return !fromMe && isDesigned(newestHtml, headers);
}

/** Sent to a list, or laid out in tables (bills and receipts often have no list headers). */
export function isDesigned(newestHtml: string, headers: ListHeaders | null | undefined): boolean {
    if (headers?.listUnsubscribe || headers?.listId) return true;
    if (/^\s*(bulk|list|junk)\s*$/i.test(headers?.precedence ?? '')) return true;
    return hasLayoutTable(newestHtml);
}

/**
 * A table at least 480px wide, role="presentation", or tables nested two deep, unless the outer one
 * says it's narrow (under 480px): that's a signature block in personal mail, not a layout.
 */
function hasLayoutTable(html: string): boolean {
    if (!html || !/<table\b/i.test(html)) return false;
    for (const table of Array.from(inertDiv(html).querySelectorAll('table'))) {
        if ((table.getAttribute('role') ?? '').trim().toLowerCase() === 'presentation') return true;
        const width = widthPx(table);
        if (width >= 480) return true;
        if (table.querySelector('table') && !(width > 0 && width < 480)) return true;
    }
    return false;
}

function widthPx(el: Element): number {
    const attr = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(el.getAttribute('width') ?? '');
    if (attr) return Number(attr[1]);
    let widest = 0;
    for (const m of (el.getAttribute('style') ?? '').matchAll(/(?:^|;)\s*(?:min-|max-)?width\s*:\s*(\d+(?:\.\d+)?)px/gi)) widest = Math.max(widest, Number(m[1]));
    return widest;
}

/** Style properties theme mail keeps: what the text is, never how the sender dressed it. */
const KEEP = new Set([
    'display', 'visibility', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line',
    'text-align', 'white-space', 'vertical-align', 'list-style', 'list-style-type', 'direction', 'unicode-bidi',
]);
/** Attributes that carry a look (width and height stay on images). */
const LOOK_ATTRS = ['bgcolor', 'background', 'color', 'face', 'size', 'text', 'link', 'vlink', 'alink'];

/**
 * Mail shown in the theme: colours, backgrounds, fonts, sizes and widths stripped; structure kept
 * (paragraphs, line breaks, lists, quotes, links, inline images and data tables). `hadLook` says
 * whether that removed something the sender chose (a colour, background, font or size), so
 * "Original" has something to show.
 */
export function stripToTheme(html: string): { html: string; hadLook: boolean } {
    if (!html) return { html, hadLook: false };
    const div = inertDiv(html);
    let hadLook = false;
    for (const sheet of Array.from(div.querySelectorAll('style'))) {
        if (sheetHasLook(sheet.textContent ?? '')) hadLook = true;
        sheet.remove();
    }
    for (const el of Array.from(div.querySelectorAll('*'))) {
        const inLink = !!el.closest('a');
        for (const name of LOOK_ATTRS) {
            const value = el.getAttribute(name);
            if (value === null) continue;
            if (attrIsLook(name, value, inLink)) hadLook = true;
            el.removeAttribute(name);
        }
        if (el.tagName !== 'IMG') {
            el.removeAttribute('width');
            el.removeAttribute('height');
        }
        const style = el.getAttribute('style');
        if (style === null) continue;
        const kept: string[] = [];
        for (const [prop, value] of declarations(style)) {
            if (KEEP.has(prop)) kept.push(`${prop}:${value}`);
            else if (declIsLook(prop, value, inLink)) hadLook = true;
        }
        if (kept.length) el.setAttribute('style', kept.join(';'));
        else el.removeAttribute('style');
    }
    return { html: div.innerHTML, hadLook };
}

/** "a: b; c: d" as [prop, value] pairs (semicolons inside quotes or brackets don't split). */
function declarations(style: string): [string, string][] {
    const out: [string, string][] = [];
    let depth = 0;
    let quote = '';
    let start = 0;
    const push = (end: number) => {
        const decl = style.slice(start, end);
        const i = decl.indexOf(':');
        if (i > 0) out.push([decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim()]);
    };
    for (let i = 0; i < style.length; i++) {
        const c = style[i];
        if (quote) { if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ';' && depth === 0) { push(i); start = i + 1; }
    }
    push(style.length);
    return out;
}

/** Fonts nearly every mail app uses by default: stripping them changes nothing worth showing. */
const EVERYDAY_FONTS = /^(arial|helvetica|helvetica neue|sans-serif|serif|system-ui|ui-sans-serif|-apple-system|blinkmacsystemfont|segoe ui|roboto|calibri|aptos|verdana|tahoma|times new roman|times|lucida grande|inherit|initial)$/;
const firstFont = (value: string) => value.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();

function declIsLook(prop: string, value: string, inLink: boolean): boolean {
    const v = value.replace(/\s*!important\s*$/i, '').trim();
    if (prop === 'color') return !inLink && !isNeutral(v);
    if (prop === 'background-image') return /url\(|gradient\(/i.test(v);
    if (prop === 'background' || prop === 'background-color') return /url\(|gradient\(/i.test(v) || !isPlainBackground(v);
    if (prop === 'font-family') return !EVERYDAY_FONTS.test(firstFont(v));
    if (prop === 'font-size') return !isEverydaySize(v);
    if (prop === 'font') {
        const size = /([\d.]+(?:px|pt|em|rem|%))(?:\/\S+)?\s+(.+)$/i.exec(v);
        return !!size && (!isEverydaySize(size[1]) || !EVERYDAY_FONTS.test(firstFont(size[2])));
    }
    return false;
}

function attrIsLook(name: string, value: string, inLink: boolean): boolean {
    if (name === 'color') return !inLink && !isNeutral(value);
    if (name === 'bgcolor') return !isPlainBackground(value);
    if (name === 'background') return !!value.trim();
    if (name === 'face') return !EVERYDAY_FONTS.test(firstFont(value));
    if (name === 'size') return !/^\s*[23]\s*$/.test(value); // <font size="3"> is the default
    return false;
}

function sheetHasLook(css: string): boolean {
    if (/@font-face/i.test(css)) return true;
    for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
        if (declIsLook(m[1].toLowerCase(), m[2], false)) return true;
    }
    return false;
}

/** 12–18px (9–13.5pt, 0.75–1.15em, 75–115%), or a keyword near the default. */
function isEverydaySize(value: string): boolean {
    const v = value.trim().toLowerCase();
    if (/^(medium|small|inherit|initial|normal)$/.test(v)) return true;
    const m = /^([\d.]+)(px|pt|em|rem|%)$/.exec(v);
    if (!m) return false;
    const n = Number(m[1]);
    const px = m[2] === 'px' ? n : m[2] === 'pt' ? n * (4 / 3) : m[2] === '%' ? (n / 100) * 16 : n * 16;
    return px >= 12 && px <= 18;
}

/** No background, or white: what a mail app's page is anyway. */
function isPlainBackground(value: string): boolean {
    const v = value.trim().toLowerCase();
    if (!v || /^(none|transparent|inherit|initial|unset|white|#fff|#ffffff|window)$/.test(v)) return true;
    const rgb = rgbOf(v);
    return !!rgb && rgb.every(c => c >= 250);
}

const NEUTRAL_NAMES = /^(inherit|initial|unset|currentcolor|transparent|windowtext|black|white|silver|gr[ae]y|dimgr[ae]y|darkgr[ae]y|lightgr[ae]y|gainsboro|whitesmoke)$/;

function rgbOf(value: string): number[] | null {
    const v = value.trim().toLowerCase().replace(/\s*!important$/, '');
    const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hex) {
        const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
        return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    }
    const fn = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    return fn ? fn.slice(1, 4).map(Number) : null;
}

/** Black, white or a grey: text the theme can recolour without changing what the sender meant. */
function isNeutral(value: string): boolean {
    if (NEUTRAL_NAMES.test(value.trim().toLowerCase().replace(/\s*!important$/, ''))) return true;
    const rgb = rgbOf(value);
    return !!rgb && Math.max(...rgb) - Math.min(...rgb) <= 24;
}

/**
 * The email's own web fonts (its @font-face rules, wherever its style blocks are), for Original:
 * the rest of its style blocks stays out, as on paper. They load only after "Load images" (the
 * frame's content policy), and a rule that could break out of a <style> is dropped.
 */
export function fontFaces(html: string): string {
    if (!html || !/@font-face/i.test(html)) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html'); // a separate document: nothing loads
    const rules: string[] = [];
    for (const sheet of Array.from(doc.querySelectorAll('style'))) {
        for (const m of (sheet.textContent ?? '').matchAll(/@font-face\s*\{[^{}]*\}/gi)) {
            if (!/[<>]/.test(m[0])) rules.push(m[0]);
        }
    }
    return rules.join('\n');
}
