// Drafts live in the mail server's Drafts folder, so they follow you to every device
// (docs/architecture.md, rule 9). Saving appends a new version and then removes the older versions of
// the same draft, the way Thunderbird and Roundcube replace drafts. Versions are recognised by
// a private header carrying the draft's key, so drafts written by other apps are never touched
// unless the user explicitly continues one (it is then replaced by our version).
import { simpleParser, type AddressObject } from 'mailparser';
import type { ImapFlow } from 'imapflow';
import type { Store } from '../store/store.ts';
import type { AccountWorker } from '../worker/accountWorker.ts';
import { buildMessage, ComposeError, threadingFor, threadingFromHeaders, type Address } from './compose.ts';
import type { UploadInfo, Uploads } from './uploads.ts';

export const DRAFT_HEADER = 'X-Electronic-Mail-Draft';
/** On a reply written from another account: the account (here) holding the message it answers. */
export const ORIGINAL_ACCOUNT_HEADER = 'X-Electronic-Mail-Original-Account';
/**
 * On a forward: the Message-ID of the message it forwards, so reopening the draft finds it again
 * (a forward carries no In-Reply-To). Only on the draft; sending builds a new message without it.
 */
export const FORWARD_OF_HEADER = 'X-Electronic-Mail-Forward-Of';
const MESSAGE_ID = /^<?([^\s<>]+)>?$/;
const DRAFT_KEY = /^[A-Za-z0-9-]{8,64}$/;

export interface DraftInput {
    to: Address[];
    cc: Address[];
    bcc: Address[];
    subject: string;
    html: string | null;
    text: string | null;
    /** Message key this draft replies to (threading headers come from it). */
    replyTo?: string | null;
    /** Without replyTo: the threading headers of the draft being continued, kept as they were. */
    inReplyTo?: string | null;
    references?: string[];
    /** Upload ids. */
    attachments: string[];
    /** A draft written elsewhere that this one replaces (deleted once ours is saved). */
    replaces?: string | null;
    /** A reply's original is in this other account (so reopening it finds its conversation). */
    originalAccount?: string | null;
    /** Message key of the message a forward forwards (saved as FORWARD_OF_HEADER). */
    forwardOf?: string | null;
}

export interface DraftSummary {
    msgKey: string;
    /** The conversation a reply draft belongs to (null for a new message). */
    threadId: string | null;
    subject: string | null;
    recipients: string[];
    date: string | null;
    preview: string | null;
}

export interface DraftContent {
    msgKey: string;
    /** Null for drafts written by another app; saving gives it one. */
    draftKey: string | null;
    to: Address[];
    cc: Address[];
    bcc: Address[];
    subject: string;
    html: string | null;
    text: string | null;
    inReplyTo: string | null;
    references: string[];
    attachments: UploadInfo[];
    /** For a reply written from another account: the account holding the message it answers. */
    originalAccount: string | null;
    /** For a forward: the Message-ID (without <>) of the message it forwards. */
    forwardOf: string | null;
}

export class Drafts {
    private readonly store: Store;
    private readonly uploads: Uploads;

    constructor(store: Store, uploads: Uploads) {
        this.store = store;
        this.uploads = uploads;
    }

    list(accountId: string): DraftSummary[] {
        // A reply draft is threaded like any message, so it carries its conversation's id; a new
        // message's draft is alone in a thread no view shows.
        return (this.store.db.prepare(`SELECT m.msg_key, m.subject, m.addresses, m.date, m.preview,
                (SELECT t.thread_id FROM thread t WHERE t.account = m.account AND t.thread_id = m.thread_id) AS thread_id
            FROM message m
            JOIN placement p ON p.account = m.account AND p.msg_key = m.msg_key
            JOIN folder f ON f.account = p.account AND f.path = p.folder
            WHERE m.account = ? AND f.role = 'drafts' ORDER BY m.date DESC`).all(accountId) as
            { msg_key: string; subject: string | null; addresses: string; date: string | null; preview: string | null; thread_id: string | null }[])
            .map(r => ({ msgKey: r.msg_key, threadId: r.thread_id, subject: r.subject, recipients: JSON.parse(r.addresses), date: r.date, preview: r.preview }));
    }

    /** Saves a new version; returns the new version's message key. */
    async save(worker: AccountWorker, from: Address, accountId: string, draftKey: string, input: DraftInput): Promise<{ msgKey: string }> {
        if (!DRAFT_KEY.test(draftKey)) throw new ComposeError('invalid draft key');
        const folder = this.draftsFolder(accountId);
        const threading = input.replyTo ? threadingFor(this.store, accountId, input.replyTo) : threadingFromHeaders(input.inReplyTo, input.references);
        const forwarded = !input.replyTo && input.forwardOf ? this.messageIdOf(accountId, input.forwardOf) : null;
        const built = await buildMessage({
            from, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, html: input.html, text: input.text,
            attachments: input.attachments.map(id => this.uploads.load(id)),
            inReplyTo: threading?.inReplyTo, references: threading?.references,
            headers: {
                [DRAFT_HEADER]: draftKey,
                ...(input.originalAccount && DRAFT_KEY.test(input.originalAccount) ? { [ORIGINAL_ACCOUNT_HEADER]: input.originalAccount } : {}),
                ...(forwarded ? { [FORWARD_OF_HEADER]: `<${forwarded}>` } : {}),
            },
            allowNoRecipients: true,
        });
        const replacedUids = input.replaces ? this.uidsOf(accountId, folder, input.replaces) : [];
        await worker.runJob(async client => {
            const appended = await client.append(folder, built.forSaving, ['\\Draft', '\\Seen']);
            if (!appended) throw new ComposeError('the server refused to save the draft');
            const older = (await this.versionUids(client, folder, draftKey)).filter(uid => uid !== appended.uid);
            await this.deleteUids(client, folder, [...older, ...replacedUids]);
        });
        return { msgKey: built.messageId.replace(/^<|>$/g, '') };
    }

    /** Reads a draft back into compose fields (its attachments become uploads again). */
    async open(worker: AccountWorker, accountId: string, msgKey: string): Promise<DraftContent> {
        const folder = this.draftsFolder(accountId);
        const [uid] = this.uidsOf(accountId, folder, msgKey);
        if (!uid) throw new ComposeError('that draft is no longer here');
        const source = await worker.withReader(async client => {
            const lock = await client.getMailboxLock(folder, { readOnly: true });
            try {
                await client.noop(); // fresh view (see bodies.ts)
                const m = await client.fetchOne(String(uid), { source: true }, { uid: true });
                if (!m || !m.source) throw new ComposeError('that draft is no longer here');
                return m.source;
            } finally {
                lock.release();
            }
        });
        const parsed = await simpleParser(source);
        const key = parsed.headers.get(DRAFT_HEADER.toLowerCase());
        const originalAccount = parsed.headers.get(ORIGINAL_ACCOUNT_HEADER.toLowerCase());
        const forwardOf = parsed.headers.get(FORWARD_OF_HEADER.toLowerCase());
        const refs = parsed.references;
        return {
            msgKey,
            draftKey: typeof key === 'string' && DRAFT_KEY.test(key) ? key : null,
            to: addresses(parsed.to), cc: addresses(parsed.cc), bcc: addresses(parsed.bcc),
            subject: parsed.subject ?? '',
            html: typeof parsed.html === 'string' ? parsed.html : null,
            text: parsed.text ?? null,
            inReplyTo: parsed.inReplyTo ?? null,
            references: Array.isArray(refs) ? refs : refs ? [refs] : [],
            // Pictures inside the quote come back as data: URLs in the HTML (mailparser does that),
            // so only real attachments become uploads; the pictures would otherwise turn into files.
            attachments: parsed.attachments.filter(a => !a.related)
                .map(a => this.uploads.saveBuffer(a.content, a.filename ?? 'attachment', a.contentType)),
            originalAccount: typeof originalAccount === 'string' && DRAFT_KEY.test(originalAccount) ? originalAccount : null,
            forwardOf: typeof forwardOf === 'string' ? MESSAGE_ID.exec(forwardOf.trim())?.[1] ?? null : null,
        };
    }

    /**
     * A message's Message-ID (without <>), if the cache knows it and it's safe to put in a header.
     * This account's copy first; a draft moved to another account (From changed) still finds it.
     */
    private messageIdOf(accountId: string, msgKey: string): string | null {
        const row = this.store.db.prepare('SELECT message_id FROM message WHERE msg_key = ? ORDER BY account = ? DESC LIMIT 1').get(msgKey, accountId) as { message_id: string | null } | undefined;
        const id = row?.message_id ? MESSAGE_ID.exec(row.message_id.trim())?.[1] : null;
        return id ?? null;
    }

    /**
     * Changing From: the draft is saved to the other account's Drafts folder, then every copy of it
     * (and a draft from another app it was continuing) is deleted from the first. Saving first: if
     * the deleting fails, the draft is in both rather than in neither (`oldCopyKept`).
     */
    async move(from: { worker: AccountWorker; accountId: string }, to: { worker: AccountWorker; accountId: string; address: Address },
        draftKey: string, input: DraftInput): Promise<{ msgKey: string; oldCopyKept: boolean }> {
        const saved = await this.save(to.worker, to.address, to.accountId, draftKey, { ...input, replaces: null });
        try {
            await this.removeAllVersions(from.worker, from.accountId, draftKey);
            if (input.replaces && this.uidsOf(from.accountId, this.draftsFolder(from.accountId), input.replaces).length) {
                await this.discard(from.worker, from.accountId, input.replaces);
            }
            return { ...saved, oldCopyKept: false };
        } catch {
            return { ...saved, oldCopyKept: true };
        }
    }

    async discard(worker: AccountWorker, accountId: string, msgKey: string): Promise<void> {
        const folder = this.draftsFolder(accountId);
        const uids = this.uidsOf(accountId, folder, msgKey);
        if (!uids.length) throw new ComposeError('that draft is no longer here');
        await worker.runJob(client => this.deleteUids(client, folder, uids));
    }

    /** After a message written as this draft was sent and saved: remove every version. */
    async removeAllVersions(worker: AccountWorker, accountId: string, draftKey: string): Promise<void> {
        const folder = this.draftsFolder(accountId);
        await worker.runJob(async client => this.deleteUids(client, folder, await this.versionUids(client, folder, draftKey)));
    }

    private draftsFolder(accountId: string): string {
        const folder = this.store.listFolders(accountId).find(f => f.role === 'drafts')?.path;
        if (!folder) throw new ComposeError('this account has no Drafts folder');
        return folder;
    }

    private uidsOf(accountId: string, folder: string, msgKey: string): number[] {
        return (this.store.db.prepare('SELECT uid FROM placement WHERE account = ? AND folder = ? AND msg_key = ?')
            .all(accountId, folder, msgKey) as { uid: number }[]).map(r => r.uid);
    }

    /** UIDs of every saved version of one draft (only ever ours: matched by the private header). */
    private async versionUids(client: ImapFlow, folder: string, draftKey: string): Promise<number[]> {
        if (client.mailbox && client.mailbox.path === folder) await client.mailboxClose(); // fresh view
        const lock = await client.getMailboxLock(folder, { readOnly: true });
        try {
            return ((await client.search({ header: { [DRAFT_HEADER]: draftKey } }, { uid: true })) || []);
        } finally {
            lock.release();
        }
    }

    private async deleteUids(client: ImapFlow, folder: string, uids: number[]): Promise<void> {
        if (!uids.length) return;
        // Without UIDPLUS, imapflow falls back to a plain EXPUNGE, which would also erase any
        // message another app had merely flagged \Deleted in this folder. Refuse instead.
        if (!client.capabilities.has('UIDPLUS')) throw new ComposeError('this mail server cannot delete individual messages safely (no UIDPLUS)');
        if (client.mailbox && client.mailbox.path === folder && client.mailbox.readOnly) await client.mailboxClose();
        const lock = await client.getMailboxLock(folder);
        try {
            await client.messageDelete(uids.join(','), { uid: true }); // \\Deleted + UID EXPUNGE of exactly these
        } finally {
            lock.release();
        }
    }
}

function addresses(field: AddressObject | AddressObject[] | undefined): Address[] {
    const list = Array.isArray(field) ? field : field ? [field] : [];
    return list.flatMap(f => f.value).filter(v => v.address).map(v => ({ name: v.name || null, address: v.address!.toLowerCase() }));
}
