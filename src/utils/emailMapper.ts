/**
 * Turns the engine's shapes into what the screens show.
 */
import type { Email, Bucket, Rule } from '../../shared/types';
import type { BucketView, MessageBody, RuleView, ThreadCard, ThreadMessage } from '../api/types';

function parseDate(value: string | null | undefined): Date {
    const parsed = value ? new Date(value) : null;
    return parsed && !isNaN(parsed.getTime()) ? parsed : new Date(0);
}

/** A conversation's card (Inbox, bucket, Archive, search). */
export function cardFromThread(t: ThreadCard): Email {
    return {
        id: t.threadId,
        threadId: t.threadId,
        msgKey: t.latestMsgKey,
        sender: t.fromName || t.fromAddr || 'Unknown',
        senderAddress: t.fromAddr ?? undefined,
        subject: t.subject || '(No Subject)',
        preview: t.preview ?? '',
        body: '',
        date: parseDate(t.latestDate),
        read: t.unread === 0,
        location: t.location,
        threadCount: t.messageCount,
        mailbox: !t.location && t.hasSent ? 'Sent' : undefined,
    };
}

/** One message inside a conversation. */
export function messageFromThread(m: ThreadMessage, thread: ThreadCard): Email {
    return {
        id: m.msgKey,
        threadId: thread.threadId,
        msgKey: m.msgKey,
        sender: m.fromName || m.fromAddr || 'Unknown',
        senderAddress: m.fromAddr ?? undefined,
        subject: m.subject || thread.subject || '(No Subject)',
        preview: m.preview ?? '',
        body: '',
        date: parseDate(m.date),
        read: m.seen,
        location: thread.location,
        threadCount: thread.messageCount,
        mailbox: m.sent ? 'Sent' : undefined,
        parentKey: m.parentKey ?? null,
    };
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** HTML for showing a message: its HTML part, else its text part as readable HTML. */
export function bodyHtml(body: Pick<MessageBody, 'html' | 'text'>): string {
    if (body.html) return body.html;
    if (body.text) {
        const linked = escapeHtml(body.text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, url => `<a href="${url}">${url}</a>`);
        return `<div style="white-space: pre-wrap">${linked}</div>`;
    }
    return '<p style="color: #999">(This message has no text.)</p>';
}

/** Adds what only the full message knows (recipients, attachments, body) to a message. */
export function withBody(email: Email, body: MessageBody): Email {
    return {
        ...email,
        body: bodyHtml(body),
        to: body.headers.to,
        cc: body.headers.cc,
        replyTo: body.headers.replyTo,
        attachments: body.attachments.map(a => ({
            part: a.part,
            filename: a.filename ?? `attachment-${a.part}`,
            contentType: a.contentType,
            size: a.size,
        })),
    };
}

export function bucketFromView(b: BucketView): Bucket {
    return {
        id: b.path,
        label: b.name,
        count: b.count,
        unreadThreads: b.unreadThreads,
        sortOrder: b.sortOrder,
        color: b.color,
        emoji: b.emoji ?? undefined,
        showBadge: b.showBadge,
        showOnHome: b.showOnHome,
        autoArchiveDays: b.autoArchiveDays,
    };
}

export function ruleFromView(r: RuleView, buckets: Bucket[]): Rule {
    return {
        id: r.id,
        senderPattern: r.senderPattern,
        bucketId: buckets.find(b => b.label === r.bucket)?.id ?? r.bucket,
        createdAt: r.createdAt,
    };
}
