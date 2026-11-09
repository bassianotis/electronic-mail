/**
 * Starting a reply or a forward (Explore 2, 2a): who it goes to, its subject, the quote and its
 * threading, built in one place from the message being answered. The composer calls it again
 * when the reply type changes, so it works with the conversation closed too.
 *
 * Also how typed recipients become chips: "Name <addr>", commas and semicolons, checked with the
 * engine's own address rule (engine/src/app/compose.ts) so the two never disagree.
 */
import type { Email } from '../store/mailStore';
import type { Address, MessageBody } from '../api/types';
import { loadBody } from '../api/bodies';
import { bodyHtml } from './emailMapper';
import { forwardSubject, quoteForForward, quoteForReply, replySubject } from './compose';

export type ReplyType = 'reply' | 'replyAll' | 'forward';

export interface Recipient {
    name: string | null;
    address: string;
    /** Filled in from the message being answered, not typed: changing the reply type may take it away. */
    auto?: boolean;
    /** Why this address can't be sent to (shown on its chip). */
    invalid?: string;
}

export interface ReplyStart {
    to: Recipient[];
    cc: Recipient[];
    subject: string;
    quotedHtml: string;
    quotedText: string;
    /** Message key being answered (the engine adds In-Reply-To and References). */
    replyTo?: string;
    /** Message key being forwarded. */
    forwardOf?: string;
    /** A forward's files, as the original lists them (copied into uploads when forwarding). */
    files: { filename: string; size: number }[];
}

/** Who to answer and what to quote, from the message's own headers. */
export async function buildReply(accountId: string, msg: Email, type: ReplyType, myAddresses: string[]): Promise<ReplyStart> {
    let body: MessageBody | null = null;
    try {
        body = await loadBody(accountId, msg.msgKey);
    } catch (err) {
        console.error('Could not read the message being answered:', err);
    }
    const mine = (address: string) => myAddresses.includes(address.toLowerCase());
    const h = body?.headers;
    const sender = h?.replyTo.length ? h.replyTo : h?.from.length ? h.from
        : msg.senderAddress ? [{ name: msg.sender, address: msg.senderAddress }] : [];
    const fromMe = msg.mailbox === 'Sent' || (sender.length > 0 && sender.every(a => mine(a.address)));
    const auto = (a: Address): Recipient => ({ name: a.name || null, address: a.address, auto: true });
    let to: Recipient[] = [];
    const cc: Recipient[] = [];
    if (type !== 'forward') {
        // Answering your own message goes to the people you wrote to, not back to you.
        to = (fromMe ? (h?.to ?? []).filter(a => !mine(a.address)) : sender).map(auto);
        if (type === 'replyAll') {
            // Everyone else on the message, never any of your own addresses.
            const seen = new Set([...myAddresses, ...to.map(a => a.address.toLowerCase())]);
            for (const a of [...(h?.to ?? []), ...(h?.cc ?? [])]) {
                const key = a.address.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    cc.push(auto(a));
                }
            }
        }
    }
    const original = { ...msg, body: body ? bodyHtml(body) : msg.body, to: h?.to, cc: h?.cc };
    const quote = type === 'forward' ? quoteForForward(original, body?.text ?? null) : quoteForReply(original, body?.text ?? null);
    return {
        to, cc,
        subject: type === 'forward' ? forwardSubject(msg.subject) : replySubject(msg.subject),
        quotedHtml: quote.html,
        quotedText: quote.text,
        replyTo: type === 'forward' ? undefined : msg.msgKey,
        forwardOf: type === 'forward' ? msg.msgKey : undefined,
        files: type === 'forward' ? (body?.attachments ?? []).map(a => ({ filename: a.filename ?? `attachment-${a.part}`, size: a.size ?? 0 })) : [],
    };
}

/** The composer's title: the subject, or "New message" until a new message has one. */
export const composerTitle = (d: { type: ReplyType | null; subject: string }) =>
    d.type ? d.subject || '(No subject)' : d.subject || 'New message';

/** An attachment still on its way to the engine (Send waits for it). */
export const isUploading = (a: { id?: string; error?: string }) => !a.id && !a.error;

/** The engine's rule (engine/src/app/compose.ts ADDRESS). */
const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

/** Why an address can't be sent to, or undefined if it can. */
export function addressProblem(address: string): string | undefined {
    if (ADDRESS.test(address)) return undefined;
    if (!address.includes('@')) return `"${address}" isn't an email address: it has no @`;
    return `"${address}" isn't a valid email address`;
}

/** Typed or pasted text as recipients: "Name <addr>", "addr", separated by commas, semicolons or new lines. */
export function parseRecipients(text: string): Recipient[] {
    const pieces: string[] = [];
    let current = '';
    let quoted = false, angled = false;
    for (const c of text) {
        if (c === '"') quoted = !quoted;
        else if (c === '<') angled = true;
        else if (c === '>') angled = false;
        if ((c === ',' || c === ';' || c === '\n') && !quoted && !angled) {
            pieces.push(current);
            current = '';
        } else current += c;
    }
    pieces.push(current);
    return pieces.map(p => p.trim()).filter(Boolean).map(p => {
        const m = p.match(/^(.*?)\s*<([^>]*)>\s*$/);
        const name = m ? m[1].replace(/^"|"$/g, '').trim() || null : null;
        const address = (m ? m[2] : p).trim();
        return { name, address, invalid: addressProblem(address) };
    });
}

/** Adds recipients, leaving out anyone already there. */
export function withRecipients(list: Recipient[], added: Recipient[]): Recipient[] {
    const seen = new Set(list.map(r => r.address.toLowerCase()));
    const out = [...list];
    for (const r of added) {
        const key = r.address.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
    }
    return out;
}
