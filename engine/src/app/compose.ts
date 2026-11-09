// Builds outgoing messages (docs/architecture.md, rule 9). A message is built once: the bytes sent over
// SMTP and the copy saved to Sent share one Message-ID and date; only the saved copy keeps the
// Bcc header (recipients must never see it), as Thunderbird does. Replies get In-Reply-To and
// References from the original as stored by the engine, so they always join the right thread
// (Outlook needs References, not just In-Reply-To). Built with nodemailer's MailComposer with
// file and URL access disabled: attachments only ever come from bytes we hand it.
import crypto from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { Store } from '../store/store.ts';

export interface Address {
    name?: string | null;
    address: string;
}

export interface OutgoingAttachment {
    filename: string;
    contentType: string;
    content: Buffer;
}

export interface MessageSpec {
    from: Address;
    to: Address[];
    cc?: Address[];
    bcc?: Address[];
    subject: string;
    html?: string | null;
    text?: string | null;
    inReplyTo?: string | null;
    references?: string[];
    attachments?: OutgoingAttachment[];
    /** Extra headers, e.g. the draft marker. */
    headers?: Record<string, string>;
    messageId?: string;
    date?: Date;
    /** Drafts may be saved before any recipient is typed. */
    allowNoRecipients?: boolean;
}

export interface BuiltMessage {
    /** With angle brackets, as in the header. */
    messageId: string;
    envelope: { from: string; to: string[] };
    /** What goes over SMTP: no Bcc header. */
    forSmtp: Buffer;
    /** What is saved to Sent (or Drafts): keeps the Bcc header. */
    forSaving: Buffer;
}

export class ComposeError extends Error {}

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;
const MAX_REFERENCES = 20;
const MESSAGE_ID = /^[^\s<>]+@[^\s<>]+$/;

export async function buildMessage(spec: MessageSpec): Promise<BuiltMessage> {
    const all = [...spec.to, ...(spec.cc ?? []), ...(spec.bcc ?? [])];
    if (!all.length && !spec.allowNoRecipients) throw new ComposeError('add at least one recipient');
    for (const a of [spec.from, ...all]) validateAddress(a);
    const domain = spec.from.address.split('@')[1];
    const messageId = spec.messageId ?? `<${crypto.randomUUID()}@${domain}>`;
    const date = spec.date ?? new Date();
    const embedded = spec.html ? embedDataImages(spec.html) : { html: undefined, inline: [] };
    const options = {
        from: format(spec.from),
        to: spec.to.map(format),
        cc: spec.cc?.map(format),
        bcc: spec.bcc?.map(format),
        subject: oneLine(spec.subject),
        html: embedded.html,
        text: spec.text ?? undefined,
        inReplyTo: spec.inReplyTo ?? undefined,
        references: spec.references?.length ? spec.references : undefined,
        attachments: [
            ...(spec.attachments ?? []).map(a => ({ filename: oneLine(a.filename), contentType: a.contentType, content: a.content })),
            ...embedded.inline,
        ],
        headers: spec.headers,
        messageId,
        date,
        disableFileAccess: true,
        disableUrlAccess: true,
    };
    const forSmtp = await new MailComposer(options).compile().build();
    const saving = new MailComposer(options).compile();
    saving.keepBcc = true;
    const forSaving = await saving.build();
    return {
        messageId,
        envelope: { from: spec.from.address, to: all.map(a => a.address) },
        forSmtp,
        forSaving,
    };
}

/**
 * Pictures written into the HTML as data: URLs (a quoted message's inline images, which the
 * engine turns into data: URLs for display) become inline attachments the HTML refers to by
 * cid:, as nodemailer's attachDataUrls option does: Gmail and others don't show data: images.
 */
function embedDataImages(html: string): { html: string; inline: { cid: string; filename: string; contentType: string; content: Buffer; contentDisposition: 'inline' }[] } {
    const inline: { cid: string; filename: string; contentType: string; content: Buffer; contentDisposition: 'inline' }[] = [];
    const byData = new Map<string, string>();
    const out = html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)\2/gi,
        (_match, before: string, quote: string, type: string, data: string) => {
            const base64 = data.replace(/\s+/g, '');
            let cid = byData.get(base64);
            if (!cid) {
                cid = `${crypto.randomUUID()}@inline`;
                byData.set(base64, cid);
                const ext = type.split('/')[1].replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'img';
                inline.push({ cid, filename: `image-${inline.length + 1}.${ext}`, contentType: type.toLowerCase(), content: Buffer.from(base64, 'base64'), contentDisposition: 'inline' });
            }
            return `${before}${quote}cid:${cid}${quote}`;
        });
    return { html: out, inline };
}

/**
 * In-Reply-To / References for a reply to a message the engine knows (RFC 5322 §3.6.4):
 * the original's References plus its own Message-ID, trimmed like Thunderbird (keep the first
 * and the most recent ones) so long conversations do not grow the header without bound.
 * The message is looked for in the sending account first, then in the others (a reply sent from
 * another account than the one it came to: message keys are Message-IDs, the same everywhere).
 */
export function threadingFor(store: Store, account: string, msgKey: string): { inReplyTo: string; references: string[]; subject: string | null } {
    const row = store.db.prepare('SELECT message_id, refs, subject FROM message WHERE msg_key = ? ORDER BY account = ? DESC LIMIT 1')
        .get(msgKey, account) as { message_id: string | null; refs: string; subject: string | null } | undefined;
    if (!row) throw new ComposeError('the message you are replying to is no longer here');
    if (!row.message_id) throw new ComposeError('the message you are replying to has no Message-ID, so a reply cannot be threaded');
    let refs = [...(JSON.parse(row.refs) as string[]), row.message_id];
    if (refs.length > MAX_REFERENCES) refs = [refs[0], ...refs.slice(-(MAX_REFERENCES - 1))];
    return { inReplyTo: `<${row.message_id}>`, references: refs.map(r => `<${r}>`), subject: row.subject };
}

/**
 * In-Reply-To / References carried by a saved draft, used again when the draft is continued
 * (the message it answered may not be in this account, or no longer anywhere). Only well-formed
 * ids are kept, trimmed like threadingFor.
 */
export function threadingFromHeaders(inReplyTo: unknown, references: unknown): { inReplyTo: string; references: string[] } | null {
    const id = (v: unknown) => {
        if (typeof v !== 'string') return null;
        const bare = v.trim().replace(/^<|>$/g, '');
        return MESSAGE_ID.test(bare) ? `<${bare}>` : null;
    };
    const parent = id(inReplyTo);
    if (!parent) return null;
    let refs = (Array.isArray(references) ? references : []).map(id).filter((r): r is string => !!r);
    if (refs[refs.length - 1] !== parent) refs = [...refs.filter(r => r !== parent), parent];
    if (refs.length > MAX_REFERENCES) refs = [refs[0], ...refs.slice(-(MAX_REFERENCES - 1))];
    return { inReplyTo: parent, references: refs };
}

/** "Re: " once, however many times the subject was already replied to. */
export function replySubject(subject: string | null): string {
    const s = (subject ?? '').trim();
    return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function forwardSubject(subject: string | null): string {
    const s = (subject ?? '').trim();
    return /^(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`;
}

function validateAddress(a: Address): void {
    if (!ADDRESS.test(a.address ?? '')) throw new ComposeError(`"${a.address}" is not a valid email address`);
    if (a.name && /[\r\n]/.test(a.name)) throw new ComposeError('names cannot contain line breaks');
}

function format(a: Address) {
    return a.name ? { name: oneLine(a.name), address: a.address } : a.address;
}

function oneLine(s: string): string {
    return s.replace(/[\r\n]+/g, ' ');
}
