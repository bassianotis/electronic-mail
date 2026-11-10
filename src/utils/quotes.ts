/**
 * A reply's own part and the history it quotes. The quote is folded behind "Show quoted content",
 * and whether a message shows on paper is decided on its own part only (utils/mailLook.ts).
 */
import { inertDiv } from './inertHtml';

/** Splits a reply into what was written now and the quoted history (shown on request). */
export const splitQuotedContent = (html: string): { original: string; quoted: string | null } => {
    if (!html) return { original: '', quoted: null };
    const div = inertDiv(html); // parsed where nothing loads
    const quoteSelectors = [
        '.gmail_quote',           // Gmail (and this app)
        '.gmail_extra',
        'blockquote[type="cite"]', // Apple Mail
        '.yahoo_quoted',
        '.moz-cite-prefix',       // Thunderbird
        '.OutlookMessageHeader',
        '#divRplyFwdMsg',         // Outlook web
        '.ms-outlook-hide-in-thread',
    ];
    for (const selector of quoteSelectors) {
        const quoteEl = div.querySelector(selector);
        if (quoteEl) {
            const quoted = quoteEl.outerHTML;
            quoteEl.remove();
            const original = div.innerHTML.trim();
            if (original) return { original, quoted };
        }
    }
    const onWrote = html.match(/(<div[^>]*>|<p[^>]*>|<br\s*\/?>)*On\s+.{10,100}\s+wrote:\s*(<br\s*\/?>|<\/div>|<\/p>)?/i);
    if (onWrote?.index !== undefined && onWrote.index > 50) {
        const original = html.substring(0, onWrote.index).trim();
        const quoted = html.substring(onWrote.index).trim();
        if (original && quoted) return { original, quoted };
    }
    const forwarded = html.match(/(<div[^>]*>|<p[^>]*>)?-{2,}[\s]*(Original Message|Forwarded Message)[\s]*-{2,}/i);
    if (forwarded?.index !== undefined && forwarded.index > 50) {
        const original = html.substring(0, forwarded.index).trim();
        const quoted = html.substring(forwarded.index).trim();
        if (original && quoted) return { original, quoted };
    }
    return { original: html, quoted: null };
};
