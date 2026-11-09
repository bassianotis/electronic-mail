/**
 * Replying and forwarding: subjects, and the quoted original in the Gmail style the app has
 * always used (a .gmail_quote block, which other mail apps also recognise and fold away).
 */
import type { Email } from '../store/mailStore';
import { sanitizeHtml } from './sanitize';
import { inertDiv } from './inertHtml';

export function replySubject(subject: string): string {
    return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

export function forwardSubject(subject: string): string {
    return /^(fwd?|fw):/i.test(subject.trim()) ? subject : `Fwd: ${subject}`;
}

export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** What the user typed, as HTML: escaped, line breaks kept. */
export function textToHtml(text: string): string {
    return escapeHtml(text).replace(/\n/g, '<br>');
}

/** Readable text from HTML (for the plain-text part of a reply). */
export function htmlToText(html: string): string {
    const div = inertDiv(sanitizeHtml(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')));
    return (div.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** "Wed, Nov 5, 2025 at 1:45 PM", like Gmail. */
function longDate(date: Date): string {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        + ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function who(email: Pick<Email, 'sender' | 'senderAddress'>): string {
    return email.senderAddress && email.sender !== email.senderAddress
        ? `${email.sender} <${email.senderAddress}>`
        : email.senderAddress || email.sender;
}

/** The original, quoted below a reply. `text` is the original's plain-text part, if it has one. */
export function quoteForReply(original: Email, text: string | null): { html: string; text: string } {
    const attribution = `On ${longDate(original.date)}, ${who(original)} wrote:`;
    const quotedText = (text ?? (original.body ? htmlToText(original.body) : '')).split('\n').map(line => `> ${line}`).join('\n');
    if (!original.body && !text) return { html: '', text: '' };
    return {
        html: `<br><br>
<div class="gmail_quote">
  <div style="color:#888888;font-size:11px;margin:0 0 8px">${escapeHtml(attribution)}</div>
  <blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">
    ${sanitizeHtml(original.body || textToHtml(text ?? ''))}
  </blockquote>
</div>`,
        text: `\n\n${attribution}\n${quotedText}`,
    };
}

/** The original below a forward, with its headers. */
export function quoteForForward(original: Email, text: string | null): { html: string; text: string } {
    const lines = [
        `From: ${who(original)}`,
        `Date: ${longDate(original.date)}`,
        `Subject: ${original.subject}`,
        ...(original.to?.length ? [`To: ${original.to.map(a => a.name ? `${a.name} <${a.address}>` : a.address).join(', ')}`] : []),
    ];
    return {
        html: `<br><br>
<div class="gmail_quote">
  <div>---------- Forwarded message ---------<br>${lines.map(escapeHtml).join('<br>')}<br><br></div>
  ${sanitizeHtml(original.body || textToHtml(text ?? ''))}
</div>`,
        text: `\n\n---------- Forwarded message ---------\n${lines.join('\n')}\n\n${text ?? (original.body ? htmlToText(original.body) : '')}`,
    };
}

/**
 * The From account's signature (Explore 2, section 6): its own block of the HTML after what was
 * typed and before the quote, and after a "-- " line in plain text, so it's never part of the text
 * and reopening a draft never doubles it.
 */
export function signatureHtml(signature: string | null): string {
    return signature ? `<div class="em-signature">-- <br>${textToHtml(signature)}</div>` : '';
}

export function signatureText(signature: string | null): string {
    return signature ? `\n\n-- \n${signature}` : '';
}

/** Where the quote starts in a plain-text part: a reply's attribution line or a forward's header. */
const QUOTE_START = /\n\nOn .{10,200} wrote:\n|\n\n---------- Forwarded message ---------\n/;

export interface DraftParts {
    /** What the user typed (the part above the quote). */
    body: string;
    /** The quote below it, kept exactly as it was saved. */
    quotedHtml: string;
    quotedText: string;
    forward: boolean;
}

/** A saved draft split into what the user typed and the quote, so continuing it keeps the quote. */
export function draftParts(html: string | null, text: string | null): DraftParts {
    const quoteAt = text ? text.search(QUOTE_START) : -1;
    const quotedText = text && quoteAt >= 0 ? text.slice(quoteAt) : '';
    const forward = /^\n\n---------- Forwarded message/.test(quotedText) || /---------- Forwarded message/.test(html ?? '');
    if (html) {
        const div = inertDiv(sanitizeHtml(html));
        const mine = div.querySelector('.em-body');
        if (mine) {
            const body = htmlToText(mine.innerHTML);
            mine.remove();
            div.querySelector(':scope > .em-signature')?.remove(); // added again from the From account
            return { body, quotedHtml: div.innerHTML.trim() ? div.innerHTML : '', quotedText, forward };
        }
    }
    // Written by another app (no .em-body): the typed part comes from the text, the quote is kept as
    // text, and a signature after a "-- " line is left off.
    if (text) {
        const typed = quoteAt >= 0 ? text.slice(0, quoteAt) : text;
        const sig = typed.lastIndexOf('\n-- \n');
        return { body: (sig >= 0 ? typed.slice(0, sig) : typed).replace(/\s+$/, ''), quotedHtml: quotedText ? textToHtml(quotedText) : '', quotedText, forward };
    }
    return { body: html ? htmlToText(html) : '', quotedHtml: '', quotedText: '', forward };
}
