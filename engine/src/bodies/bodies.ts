// Message bodies, attachments and card previews, fetched on demand part by part
// (BODYSTRUCTURE, then only the parts needed), as EmailEngine does. imapflow's download()
// already undoes transfer encodings, format=flowed and non-UTF-8 charsets for text parts.
// Bodies are cached with a size cap, evicting the least recently read (Rule 3); previews are
// stored with the message. HTML is returned as sent: the UI renders it with DOMPurify inside a
// sandboxed iframe whose CSP only allows data: images (Rule 10), so inline cid: images are
// turned into data: URIs here.
import type { Readable } from 'node:stream';
import type { ImapFlow, MessageStructureObject } from 'imapflow';
import type { Store } from '../store/store.ts';

export interface AttachmentInfo {
    part: string;
    filename: string | null;
    contentType: string;
    size: number | null;
}

export interface MessageAddress {
    name: string | null;
    address: string;
}

export interface MessageHeaders {
    from: MessageAddress[];
    to: MessageAddress[];
    cc: MessageAddress[];
    replyTo: MessageAddress[];
    subject: string | null;
    date: string | null;
}

export interface MessageBody {
    msgKey: string;
    /** For replying: who it came from and went to (names included). */
    headers: MessageHeaders;
    html: string | null;
    text: string | null;
    attachments: AttachmentInfo[];
    listUnsubscribe: string | null;
    listUnsubscribePost: string | null;
}

interface Leaf {
    part: string;
    type: string;
    disposition: string | null;
    filename: string | null;
    contentId: string | null;
    size: number | null;
}

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_TOTAL_BYTES = 8 * 1024 * 1024;
const PREVIEW_BYTES = 8 * 1024;
const PREVIEW_CHARS = 200;
const PREVIEW_CHUNK = 5;
export const DEFAULT_BODY_CACHE_BYTES = 200 * 1024 * 1024;

export class NotFound extends Error {}

/** Reads a message body, from cache if possible. `client` should be the worker's reader connection. */
export async function getBody(client: ImapFlow, store: Store, account: string, msgKey: string, cacheBytes = DEFAULT_BODY_CACHE_BYTES): Promise<MessageBody> {
    const cached = store.db.prepare('SELECT data FROM body WHERE account = ? AND msg_key = ?').get(account, msgKey) as { data: string } | undefined;
    if (cached) {
        const body = JSON.parse(cached.data) as MessageBody;
        if (body.headers) { // cached before headers were stored: fetch again
            store.db.prepare('UPDATE body SET accessed_at = ? WHERE account = ? AND msg_key = ?').run(new Date().toISOString(), account, msgKey);
            return body;
        }
    }

    const { folder, uid } = locate(store, account, msgKey);
    const lock = await lockFresh(client, folder);
    let body: MessageBody;
    try {
        const msg = await client.fetchOne(String(uid), { bodyStructure: true, envelope: true, headers: ['list-unsubscribe', 'list-unsubscribe-post'] }, { uid: true });
        if (!msg || !msg.bodyStructure) throw new NotFound(`message ${msgKey} is no longer on the server`);
        const leaves = flatten(msg.bodyStructure);
        const htmlPart = leaves.find(l => l.type === 'text/html' && l.disposition !== 'attachment');
        const textPart = leaves.find(l => l.type === 'text/plain' && l.disposition !== 'attachment');

        let html = htmlPart ? await downloadText(client, uid, htmlPart.part, MAX_TEXT_BYTES) : null;
        const text = textPart ? await downloadText(client, uid, textPart.part, MAX_TEXT_BYTES) : null;

        // Inline images referenced as cid: become data: URIs (the iframe CSP blocks everything else).
        const inlined = new Set<string>();
        if (html) {
            let budget = MAX_INLINE_TOTAL_BYTES;
            for (const leaf of leaves) {
                if (!leaf.contentId || !leaf.type.startsWith('image/')) continue;
                if (!html.toLowerCase().includes(`cid:${leaf.contentId.toLowerCase()}`)) continue;
                if ((leaf.size ?? 0) > MAX_INLINE_IMAGE_BYTES || (leaf.size ?? 0) > budget) continue;
                const data = await downloadBuffer(client, uid, leaf.part, MAX_INLINE_IMAGE_BYTES);
                budget -= data.length;
                html = replaceCid(html, leaf.contentId, `data:${leaf.type};base64,${data.toString('base64')}`);
                inlined.add(leaf.part);
            }
        }

        const headers = parseHeaders(msg.headers);
        const e = msg.envelope ?? {};
        const list = (a: { name?: string; address?: string }[] | undefined): MessageAddress[] =>
            (a ?? []).filter(x => x.address).map(x => ({ name: x.name || null, address: x.address!.toLowerCase() }));
        const date = e.date ? new Date(e.date) : null;
        body = {
            msgKey,
            headers: {
                from: list(e.from), to: list(e.to), cc: list(e.cc), replyTo: list(e.replyTo),
                subject: e.subject ?? null,
                date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
            },
            html,
            text,
            attachments: leaves
                .filter(l => l !== htmlPart && l !== textPart && !inlined.has(l.part))
                .map(l => ({ part: l.part, filename: l.filename, contentType: l.type, size: l.size })),
            listUnsubscribe: headers.get('list-unsubscribe') ?? null,
            listUnsubscribePost: headers.get('list-unsubscribe-post') ?? null,
        };
    } finally {
        lock.release();
    }

    const data = JSON.stringify(body);
    store.transaction(() => {
        store.db.prepare(`INSERT OR REPLACE INTO body (account, msg_key, data, size, accessed_at) VALUES (?, ?, ?, ?, ?)`)
            .run(account, msgKey, data, Buffer.byteLength(data), new Date().toISOString());
        const preview = makePreview(body.text, body.html);
        if (preview !== null) store.db.prepare('UPDATE message SET preview = ? WHERE account = ? AND msg_key = ?').run(preview, account, msgKey);
        evict(store, cacheBytes);
    });
    return body;
}

/**
 * Streams one attachment. The mailbox lock is held until the stream ends, so the caller must
 * consume or destroy the returned stream.
 */
export async function openAttachment(client: ImapFlow, store: Store, account: string, msgKey: string, part: string):
    Promise<{ contentType: string; filename: string | null; content: Readable }> {
    const { folder, uid } = locate(store, account, msgKey);
    const lock = await lockFresh(client, folder);
    try {
        const download = await client.download(String(uid), part, { uid: true });
        if (!download.content) throw new NotFound(`attachment ${part} of ${msgKey} not found`);
        const release = () => lock.release();
        download.content.once('end', release);
        download.content.once('error', release);
        download.content.once('close', release);
        return {
            contentType: download.meta.contentType ?? 'application/octet-stream',
            filename: download.meta.filename ?? null,
            content: download.content,
        };
    } catch (err) {
        lock.release();
        throw err;
    }
}

/**
 * Fills card previews for messages that have none, reading only the first few KB of their text.
 * Returns how many were filled. Used for Inbox and bucket cards; Archive previews load on demand.
 */
export async function fillPreviews(client: ImapFlow, store: Store, account: string, msgKeys: string[],
    shouldYield: () => boolean = () => false): Promise<{ filled: number; yielded: boolean }> {
    const byFolder = new Map<string, { uid: number; msgKey: string }[]>();
    for (const msgKey of msgKeys) {
        const row = store.db.prepare('SELECT preview FROM message WHERE account = ? AND msg_key = ?').get(account, msgKey) as { preview: string | null } | undefined;
        if (!row || row.preview !== null) continue;
        try {
            const { folder, uid } = locate(store, account, msgKey);
            byFolder.set(folder, [...(byFolder.get(folder) ?? []), { uid, msgKey }]);
        } catch { /* no placement any more */ }
    }
    let filled = 0;
    // Small chunks, each under its own lock: a body the user clicks waits for at most one chunk,
    // not for the whole batch (found on real mail: 8-14 s waits behind a 200-message batch),
    // and the filler stops entirely while a read is waiting.
    const chunks: [string, { uid: number; msgKey: string }[]][] = [];
    for (const [folder, items] of byFolder) {
        for (let i = 0; i < items.length; i += PREVIEW_CHUNK) chunks.push([folder, items.slice(i, i + PREVIEW_CHUNK)]);
    }
    let yielded = false;
    for (const [folder, items] of chunks) {
        if (shouldYield()) { yielded = true; break; } // someone is waiting to read a message: step aside
        const lock = await lockFresh(client, folder);
        try {
            const uids = items.map(i => i.uid).join(',');
            const structures = new Map<number, MessageStructureObject>();
            for await (const m of client.fetch(uids, { uid: true, bodyStructure: true }, { uid: true })) {
                if (m.bodyStructure) structures.set(m.uid, m.bodyStructure);
            }
            for (const { uid, msgKey } of items) {
                const structure = structures.get(uid);
                if (!structure) {
                    // Gone since we looked: mark it so it is not retried forever.
                    store.db.prepare('UPDATE message SET preview = ? WHERE account = ? AND msg_key = ?').run('', account, msgKey);
                    continue;
                }
                const leaves = flatten(structure);
                const textPart = leaves.find(l => l.type === 'text/plain' && l.disposition !== 'attachment');
                const htmlPart = leaves.find(l => l.type === 'text/html' && l.disposition !== 'attachment');
                const chosen = textPart ?? htmlPart;
                const content = chosen ? await downloadText(client, uid, chosen.part, PREVIEW_BYTES) : null;
                const preview = makePreview(chosen === textPart ? content : null, chosen === htmlPart ? content : null) ?? '';
                store.db.prepare('UPDATE message SET preview = ? WHERE account = ? AND msg_key = ?').run(preview, account, msgKey);
                filled++;
            }
        } finally {
            lock.release();
        }
    }
    return { filled, yielded };
}

// ------------------------------------------------------------------ helpers

/**
 * Opens a folder for reading with an up-to-date view. The reader connection keeps INBOX open
 * while it idles; a folder that is already open still shows the session's older view until the
 * server is asked for news, so a just-arrived message would look missing. NOOP first
 * (Mailspring's lesson: "a session with a stale view could return a moved copy").
 */
async function lockFresh(client: ImapFlow, folder: string) {
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
        await client.noop();
    } catch (err) {
        lock.release();
        throw err;
    }
    return lock;
}

/** Any current copy of the message; prefers folders the user sees over Trash/Junk. */
function locate(store: Store, account: string, msgKey: string): { folder: string; uid: number } {
    const row = store.db.prepare(`SELECT p.folder, p.uid FROM placement p
        JOIN folder f ON f.account = p.account AND f.path = p.folder
        WHERE p.account = ? AND p.msg_key = ?
        ORDER BY CASE f.role WHEN 'inbox' THEN 0 WHEN 'bucket' THEN 1 WHEN 'archive' THEN 2 WHEN 'sent' THEN 3
            WHEN 'other' THEN 4 WHEN 'drafts' THEN 5 ELSE 6 END
        LIMIT 1`).get(account, msgKey) as { folder: string; uid: number } | undefined;
    if (!row) throw new NotFound(`message ${msgKey} not found`);
    return row;
}

/** Leaf parts in document order. An attached email (message/rfc822) counts as one attachment. */
function flatten(node: MessageStructureObject, out: Leaf[] = []): Leaf[] {
    const type = (node.type || 'text/plain').toLowerCase();
    if (node.childNodes?.length && type !== 'message/rfc822') {
        for (const child of node.childNodes) flatten(child, out);
        return out;
    }
    out.push({
        part: node.part ?? '1',
        type,
        disposition: node.disposition?.toLowerCase() ?? null,
        filename: node.dispositionParameters?.filename ?? node.parameters?.name ?? null,
        contentId: node.id ? node.id.replace(/^<|>$/g, '') : null,
        size: node.size ?? null,
    });
    return out;
}

async function downloadBuffer(client: ImapFlow, uid: number, part: string, maxBytes: number): Promise<Buffer> {
    const d = await client.download(String(uid), part, { uid: true, maxBytes });
    if (!d.content) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    for await (const chunk of d.content) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

async function downloadText(client: ImapFlow, uid: number, part: string, maxBytes: number): Promise<string> {
    return (await downloadBuffer(client, uid, part, maxBytes)).toString('utf8');
}

function replaceCid(html: string, contentId: string, dataUri: string): string {
    const escaped = contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return html.replace(new RegExp(`cid:${escaped}`, 'gi'), dataUri);
}

function parseHeaders(raw: Buffer | undefined): Map<string, string> {
    const headers = new Map<string, string>();
    if (!raw) return headers;
    for (const line of raw.toString('utf8').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
    }
    return headers;
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** First ~200 characters of readable text. */
export function makePreview(text: string | null, html: string | null): string | null {
    let source = text;
    if (!source && html) {
        source = html
            .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1)) || 32) : m));
    }
    if (source === null) return null;
    return source
        .replace(/^>.*$/gm, ' ') // quoted reply lines
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, PREVIEW_CHARS);
}

function evict(store: Store, capBytes: number): void {
    let { total } = store.db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM body').get() as { total: number };
    if (total <= capBytes) return;
    const oldest = store.db.prepare('SELECT account, msg_key, size FROM body ORDER BY accessed_at LIMIT 100');
    const remove = store.db.prepare('DELETE FROM body WHERE account = ? AND msg_key = ?');
    while (total > capBytes) {
        const rows = oldest.all() as { account: string; msg_key: string; size: number }[];
        if (!rows.length) break;
        for (const r of rows) {
            if (total <= capBytes) break;
            remove.run(r.account, r.msg_key);
            total -= r.size;
        }
    }
}
