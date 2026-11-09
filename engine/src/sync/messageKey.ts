import { createHash } from 'node:crypto';

const ID = /<([^<>\s]+@[^<>\s]+)>/g;

/** All well-formed `<local@domain>` ids in a header value, in order, without brackets. */
export function idList(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return [...raw.matchAll(ID)].map(m => m[1]);
}

export function firstId(raw: string | null | undefined): string | null {
    return idList(raw)[0] ?? null;
}

/**
 * Identity for a message's header facts. Normally its Message-ID; messages without one
 * (about 120 in the live mailboxes) get a stable hash of their header block, as notmuch
 * does, so re-syncing never inserts them twice (the old app stored one of them 12,455 times).
 */
export function messageKey(messageId: string | null, rawHeaders: Buffer | null): string {
    if (messageId) return messageId;
    const digest = createHash('sha1').update(rawHeaders ?? Buffer.alloc(0)).digest('hex');
    return `synthetic:${digest}`;
}
