/**
 * The one composition open at a time (Explore 2, 2a): a new message, a reply or a forward, kept in
 * shared app state rather than inside the panel, so the same draft can be shown docked under its
 * conversation, centred, or in a corner window while the rest of the app is used (4), and keeps
 * saving whichever place shows it.
 *
 * Saving (docs/architecture.md, rule 9): a little while after the last change the draft is saved to the
 * server's Drafts folder (each save replaces the previous copy); saves never overlap. Closing saves
 * what's left and says so ("Draft saved" with Open), or says it couldn't.
 *
 * Send and Discard both hide the draft rather than drop it, for as long as their notice offers Undo
 * (section 5): the engine holds a sent message 5 seconds before it goes, and Undo takes it back and
 * shows the draft again exactly as it was; a discarded draft is deleted from the server only when
 * its notice runs out.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, AUTH_REQUIRED_EVENT, errorText, paths, SESSION_RESTORED_EVENT, uploadFile } from '../api/client';
import type { DraftContent, OutboxItem } from '../api/types';
import type { Email } from '../store/mailStore';
import { useMail } from './MailContext';
import { reachability } from '../api/reachability';
import { forgetDraft, keepDraft, keptDraft } from '../utils/keptDraft';
import { draftParts, signatureHtml, signatureText, textToHtml } from '../utils/compose';
import { buildReply, isUploading, withRecipients, type Recipient, type ReplyType } from '../utils/replyDraft';

export interface ComposerAttachment {
    key: string;
    filename: string;
    size: number;
    /** Upload id, once the file has reached the engine. */
    id?: string;
    /** How much has gone up so far (0–1), while uploading. */
    progress?: number;
    /** Why it couldn't be attached (shown in the strip until removed). */
    error?: string;
    /** One of the forwarded message's own files (copied when forwarding). */
    forwarded?: boolean;
}


/** The message a reply or forward starts from. */
export interface OriginalMessage {
    /** The account holding it: it owns the conversation, and Back goes there. */
    accountId: string;
    /** Its conversation in that account (null when it isn't there). */
    threadId: string | null;
    /** The message, for changing the reply type (unknown for some continued drafts). */
    email: Email | null;
}

export interface ComposerDraft {
    /** This composition, for as long as it's open. */
    id: string;
    /** Its Drafts folder and outgoing server. */
    fromAccountId: string;
    /** Null for a new message. */
    original: OriginalMessage | null;
    type: ReplyType | null;
    to: Recipient[];
    cc: Recipient[];
    bcc: Recipient[];
    showCc: boolean;
    showBcc: boolean;
    subject: string;
    /** Typed by the user: changing the reply type keeps it. */
    subjectEdited: boolean;
    /** What the user typed (the quote below it is never shown). */
    body: string;
    quotedHtml: string;
    quotedText: string;
    /** Message key being answered (threading comes from it)... */
    replyTo?: string;
    /** ...or the threading a continued draft was saved with. */
    inReplyTo?: string;
    references?: string[];
    /** Message key being forwarded (its attachments go along). */
    forwardOf?: string;
    attachments: ComposerAttachment[];
    /** Its key on the server: every saved copy carries it, so each save replaces the last. */
    draftKey: string;
    /** From, Cc/Bcc and Subject shown (a reply starts with only To). */
    expanded: boolean;
    /** Docked (under its conversation, or centred), in the corner window, or that window minimised. */
    place: 'docked' | 'corner' | 'minimised';
}

export type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'failed';

/** A message the composer handed to the outbox ('sent'), or took back with Undo ('undone'). */
export interface SentMessage {
    kind: 'sent' | 'undone';
    /** The answered conversation's account and thread (null for a new message). */
    accountId: string | null;
    threadId: string | null;
    /** The account it was sent from (From), which can differ from the conversation's. */
    fromAccountId: string;
    from: { name: string | null; address: string };
    item: OutboxItem;
    subject: string;
    html: string;
    text: string;
    to: { name: string | null; address: string }[];
    cc: { name: string | null; address: string }[];
    /** The message it answers or forwards (its key), when known: the thread tree puts it under that. */
    targetKey: string | null;
}

/** Asks the app to show a conversation (Open on a draft notice; App.tsx listens). */
export const OPEN_CONVERSATION_EVENT = 'openConversation';

const MAX_ATTACHMENTS_MB = 25;
// Each save is a round trip to the mail server (a new copy in Drafts), so wait for a pause in typing.
const DRAFT_SAVE_DELAY_MS = 2500;
/** How long the engine holds a sent message, so Undo can still take it back. */
const HOLD_MS = 5000;
/** How long "Draft discarded · Undo" stays; the server's copy is deleted after it. */
const DISCARD_NOTICE_MS = 6000;

interface ComposerContextType {
    draft: ComposerDraft | null;
    status: SaveStatus;
    sending: boolean;
    /** Send was pressed while the server couldn't be reached: it goes when the server answers. */
    waiting: boolean;
    /** The server doesn't have the latest changes, but this computer does (it couldn't be reached, or the session ended). */
    keptLocally: boolean;
    /** Every address of yours (all accounts). */
    myAddresses: string[];
    /** The draft closed last this session (its message key): first in Up next, with a ring. */
    recentDraft: string | null;
    /** Drafts discarded while their notice still offers Undo (message keys): not shown or reopened. */
    discarding: string[];
    /** Changes the open draft; `edit` false for what isn't content (expanding the fields). */
    update: (patch: Partial<ComposerDraft> | ((d: ComposerDraft) => Partial<ComposerDraft>), edit?: boolean) => void;
    openNew: () => Promise<void>;
    openReply: (from: { accountId: string; threadId: string; email: Email; type: ReplyType }) => Promise<void>;
    /** A saved draft, from `accountId`'s Drafts; a reply's original may be in `originalAccountId`. */
    openSaved: (from: { accountId: string; content: DraftContent; threadId: string | null; email?: Email | null; originalAccountId?: string }) => Promise<void>;
    changeType: (type: ReplyType) => Promise<void>;
    /**
     * "Reply to this one instead": the reply (or forward) moves to another message of its
     * conversation. Threading, the quote and the recipients its type filled in follow it; what was
     * typed and the people added by hand stay. Resolves to an Undo, or null when nothing changed.
     */
    retarget: (email: Email) => Promise<(() => void) | null>;
    /** Changing From: the draft moves to that account's Drafts folder and sends from there. */
    changeFrom: (accountId: string) => Promise<void>;
    /** Back from the corner: a reply goes back under its conversation (opened if need be). */
    dock: () => void;
    /** Closes the open draft, saving what's left, with a notice. */
    close: () => Promise<void>;
    discard: () => Promise<void>;
    send: () => Promise<void>;
    retrySave: () => void;
    addFiles: (files: File[]) => void;
    removeAttachment: (key: string) => void;
    /** Hears about every message the composer sends or takes back (a conversation shows it at once). */
    onSent: (listener: (sent: SentMessage) => void) => () => void;
}

const ComposerContext = createContext<ComposerContextType | undefined>(undefined);

const people = (list: Recipient[]) => list.filter(r => !r.invalid).map(r => ({ name: r.name, address: r.address }));
const fromDraft = (list: { name: string | null; address: string }[]): Recipient[] => list.map(a => ({ name: a.name, address: a.address }));

/** Everything a save (or a move to another account) sends about the draft. */
const draftFields = (d: ComposerDraft, signature: string | null) => ({
    ...message(d, signature),
    replyTo: d.replyTo ?? null,
    inReplyTo: d.inReplyTo ?? null,
    references: d.references ?? [],
    attachments: d.attachments.map(a => a.id).filter((id): id is string => !!id),
    // A reply from another account than its original's: where its conversation is, for reopening.
    originalAccount: d.original && d.original.accountId !== d.fromAccountId ? d.original.accountId : null,
    // A forward: the message it forwards, so reopening the draft finds it (a private header)
    forwardOf: d.type === 'forward' ? d.forwardOf ?? null : null,
});

const signatureOf = (accounts: { id: string; signature: string | null }[], accountId: string) =>
    accounts.find(a => a.id === accountId)?.signature ?? null;

/** What is saved and sent: the typed text, the From account's signature, then the quote (never shown). */
const message = (d: ComposerDraft, signature: string | null) => ({
    to: people(d.to), cc: people(d.cc), bcc: people(d.bcc),
    subject: d.subject,
    html: `<div class="em-body">${textToHtml(d.body)}</div>${signatureHtml(signature)}${d.quotedHtml}`,
    text: d.body + signatureText(signature) + d.quotedText,
});

const blank = (fromAccountId: string): ComposerDraft => ({
    id: crypto.randomUUID(), fromAccountId, original: null, type: null,
    to: [], cc: [], bcc: [], showCc: false, showBcc: false,
    subject: '', subjectEdited: false, body: '', quotedHtml: '', quotedText: '',
    attachments: [], draftKey: crypto.randomUUID(), expanded: true, place: 'docked',
});

export const ComposerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { accounts, activeAccountId, send: sendMessage, showToast } = useMail();
    const [draft, setDraftState] = useState<ComposerDraft | null>(null);
    const draftRef = useRef<ComposerDraft | null>(null);
    const [status, setStatusState] = useState<SaveStatus>('unsaved');
    const statusRef = useRef<SaveStatus>('unsaved');
    const [sending, setSending] = useState(false);
    const [waiting, setWaitingState] = useState(false);
    const waitingRef = useRef(false);
    const [keptLocally, setKeptLocally] = useState(false);
    const keepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [recentDraft, setRecentDraft] = useState<string | null>(null);
    const [discarding, setDiscarding] = useState<string[]>([]);
    // The draft's copy on the server, per composition: its newest message key, and a draft from
    // another app that the first save replaces.
    const server = useRef(new Map<string, { msgKey: string | null; replaces: string | null }>());
    // Changes made to the open draft, and how many of them the server has.
    const track = useRef({ id: '', edits: 0, saved: 0 });
    const saving = useRef<Promise<boolean> | null>(null);
    const saveAgain = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sentListeners = useRef(new Set<(sent: SentMessage) => void>());

    const myAddresses = useMemo(() => accounts.map(a => a.email.toLowerCase()), [accounts]);
    // The accounts as they are now, for each save's signature (saves outlive renders).
    const accountsRef = useRef(accounts);
    useEffect(() => { accountsRef.current = accounts; }, [accounts]);

    const setDraft = useCallback((next: ComposerDraft | null) => {
        draftRef.current = next;
        setDraftState(next);
    }, []);
    const setStatus = useCallback((next: SaveStatus) => {
        statusRef.current = next;
        setStatusState(next);
    }, []);
    const setWaiting = useCallback((next: boolean) => {
        waitingRef.current = next;
        setWaitingState(next);
    }, []);

    // The open draft, kept on this computer while the server can't have it (utils/keptDraft.ts)
    const keepNow = useCallback(() => {
        const d = draftRef.current;
        if (!d) return;
        keepDraft(d, server.current.get(d.id) ?? { msgKey: null, replaces: null }, waitingRef.current);
        setKeptLocally(true);
    }, []);
    const forgetKept = useCallback((id: string) => {
        forgetDraft(id);
        setKeptLocally(false);
    }, []);

    // Saves never overlap: a change made while saving is saved right after. Resolves to whether
    // the copy on the server is now this draft as it was when the save started.
    const saveDraft = useCallback((d: ComposerDraft): Promise<boolean> => {
        if (saving.current) {
            saveAgain.current = true;
            return saving.current;
        }
        const run = (async () => {
            const current = () => draftRef.current?.id === d.id;
            const latest = current() ? draftRef.current! : d;
            const through = track.current.id === d.id ? track.current.edits : 0;
            const copy = server.current.get(d.id) ?? { msgKey: null, replaces: null };
            if (current()) setStatus('saving');
            try {
                const saved = await api.put<{ msgKey: string }>(paths.draft(latest.fromAccountId, latest.draftKey), {
                    ...draftFields(latest, signatureOf(accountsRef.current, latest.fromAccountId)),
                    replaces: copy.replaces,
                });
                server.current.set(d.id, { msgKey: saved.msgKey, replaces: null });
                if (track.current.id === d.id) track.current.saved = Math.max(track.current.saved, through);
                if (current()) setStatus(track.current.edits > track.current.saved ? 'unsaved' : 'saved');
                if (track.current.id !== d.id || track.current.edits <= track.current.saved) forgetKept(d.id);
                return true;
            } catch (err) {
                console.error('Draft save failed:', err);
                if (current()) setStatus('failed');
                if (err instanceof ApiError && err.status === 0 && current()) keepNow();
                return false;
            } finally {
                saving.current = null;
                if (saveAgain.current) {
                    saveAgain.current = false;
                    const next = draftRef.current;
                    if (next && track.current.id === next.id && track.current.edits > track.current.saved) void saveDraft(next);
                }
            }
        })();
        saving.current = run;
        return run;
    }, [setStatus, keepNow, forgetKept]);

    const schedule = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            const d = draftRef.current;
            if (d && track.current.edits > track.current.saved && !d.attachments.some(isUploading)) void saveDraft(d);
        }, DRAFT_SAVE_DELAY_MS);
    }, [saveDraft]);

    const update = useCallback((patch: Partial<ComposerDraft> | ((d: ComposerDraft) => Partial<ComposerDraft>), edit = true) => {
        const d = draftRef.current;
        if (!d) return;
        setDraft({ ...d, ...(typeof patch === 'function' ? patch(d) : patch) });
        if (!edit) return;
        track.current.edits++;
        if (!saving.current) setStatus('unsaved');
        schedule();
        // While the server can't be reached, each change is kept here too (a moment after typing)
        if (reachability.isFailing()) {
            if (keepTimer.current) clearTimeout(keepTimer.current);
            keepTimer.current = setTimeout(keepNow, 300);
        }
    }, [setDraft, setStatus, schedule, keepNow]);

    /** Notice after closing: Open shows the draft again, as it was. */
    const reopenFrom = useRef<(d: ComposerDraft, unsaved: boolean) => void>(() => {});

    const close = useCallback(async () => {
        const d = draftRef.current;
        if (!d) return;
        if (timer.current) clearTimeout(timer.current);
        setWaiting(false);
        setDraft(null);
        if (saving.current) await saving.current;
        let ok = true;
        if (track.current.id === d.id && track.current.edits > track.current.saved) ok = await saveDraft(d);
        const msgKey = server.current.get(d.id)?.msgKey;
        if (!ok) {
            showToast({
                message: "Couldn't save the draft", tone: 'error',
                actions: [{ label: 'Open', onClick: () => reopenFrom.current(d, true) }],
            });
        } else if (msgKey) {
            setRecentDraft(msgKey);
            showToast({ message: 'Draft saved', actions: [{ label: 'Open', onClick: () => reopenFrom.current(d, false) }] });
        }
    }, [setDraft, saveDraft, showToast, setWaiting]);

    /** One draft at a time: the open one is saved and closed first. */
    const begin = useCallback(async (next: ComposerDraft, copy: { msgKey: string | null; replaces: string | null }, unsaved = false) => {
        if (draftRef.current) await close();
        server.current.set(next.id, copy);
        track.current = { id: next.id, edits: unsaved ? 1 : 0, saved: 0 };
        setStatus(unsaved ? 'unsaved' : copy.msgKey ? 'saved' : 'unsaved');
        setDraft(next);
        if (unsaved) schedule();
    }, [close, setDraft, setStatus, schedule]);

    useEffect(() => {
        reopenFrom.current = (d, unsaved) => {
            void begin({ ...d, place: 'docked' }, server.current.get(d.id) ?? { msgKey: null, replaces: null }, unsaved);
            // A reply goes back under its conversation.
            if (d.original?.threadId) {
                window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: { accountId: d.original.accountId, threadId: d.original.threadId } }));
            }
        };
    }, [begin]);

    const openNew = useCallback(async () => {
        if (!activeAccountId) return;
        await begin(blank(activeAccountId), { msgKey: null, replaces: null });
    }, [activeAccountId, begin]);

    /**
     * A forward's files: shown at once (from the original's list), copied into ordinary uploads by
     * the engine meanwhile, so they're removable, saved with the draft and tied to no account.
     */
    const copyForwardedFiles = useCallback((draftId: string, accountId: string, msgKey: string, files: { filename: string; size: number }[]) => {
        if (!files.length) return;
        const keys: string[] = files.map(() => crypto.randomUUID());
        update(d => ({ attachments: [...d.attachments, ...files.map((f, i) => ({ key: keys[i], filename: f.filename, size: f.size, forwarded: true }))] }), false);
        api.post<{ uploads: { id: string; filename: string; size: number }[] }>(paths.forwardFiles(accountId, msgKey))
            .then(({ uploads }) => {
                if (draftRef.current?.id !== draftId) return;
                update(d => ({
                    attachments: d.attachments.map(a => {
                        const i = keys.indexOf(a.key);
                        return i < 0 ? a : uploads[i] ? { ...a, id: uploads[i].id, filename: uploads[i].filename, size: uploads[i].size } : { ...a, error: "Couldn't copy it from the original" };
                    }),
                }));
            })
            .catch(err => {
                if (draftRef.current?.id !== draftId) return;
                update(d => ({ attachments: d.attachments.map(a => (keys.includes(a.key) ? { ...a, error: `Couldn't copy it from the original: ${errorText(err)}` } : a)) }), false);
            });
    }, [update]);

    const openReply = useCallback(async ({ accountId, threadId, email, type }: { accountId: string; threadId: string; email: Email; type: ReplyType }) => {
        const start = await buildReply(accountId, email, type, myAddresses);
        const next: ComposerDraft = {
            ...blank(accountId),
            original: { accountId, threadId, email },
            type,
            to: start.to, cc: start.cc, showCc: start.cc.length > 0,
            subject: start.subject,
            quotedHtml: start.quotedHtml, quotedText: start.quotedText,
            replyTo: start.replyTo, forwardOf: start.forwardOf,
            expanded: false,
        };
        await begin(next, { msgKey: null, replaces: null });
        copyForwardedFiles(next.id, accountId, email.msgKey, start.files);
    }, [myAddresses, begin, copyForwardedFiles]);

    const openSaved = useCallback(async ({ accountId, content, threadId, email, originalAccountId }: { accountId: string; content: DraftContent; threadId: string | null; email?: Email | null; originalAccountId?: string }) => {
        // The quote and threading come back as they were saved (Explore 2, part 1).
        const parts = draftParts(content.html, content.text);
        const type: ReplyType | null = parts.forward ? 'forward' : content.inReplyTo ? (content.cc.length ? 'replyAll' : 'reply') : null;
        await begin({
            ...blank(accountId),
            original: type ? { accountId: originalAccountId ?? accountId, threadId, email: email ?? null } : null,
            type,
            to: fromDraft(content.to), cc: fromDraft(content.cc), bcc: fromDraft(content.bcc),
            showCc: content.cc.length > 0, showBcc: content.bcc.length > 0,
            subject: content.subject, subjectEdited: true,
            body: parts.body, quotedHtml: parts.quotedHtml, quotedText: parts.quotedText,
            inReplyTo: content.inReplyTo ?? undefined, references: content.references,
            forwardOf: parts.forward ? email?.msgKey ?? content.forwardOf ?? undefined : undefined,
            attachments: content.attachments.map(a => ({ key: a.id, id: a.id, filename: a.filename, size: a.size })),
            draftKey: content.draftKey ?? crypto.randomUUID(),
            expanded: !type,
        }, { msgKey: content.msgKey, replaces: content.draftKey ? null : content.msgKey });
    }, [begin]);

    const changeType = useCallback(async (type: ReplyType) => {
        const d = draftRef.current;
        if (!d?.original?.email || d.type === type) return;
        const start = await buildReply(d.original.accountId, d.original.email, type, myAddresses);
        if (draftRef.current?.id !== d.id) return;
        // Keep everyone you added yourself and a subject you typed; drop what the old type filled in
        // (a forward's files too).
        update(current => ({
            type,
            to: withRecipients(start.to, current.to.filter(r => !r.auto)),
            cc: withRecipients(start.cc, current.cc.filter(r => !r.auto)),
            showCc: current.showCc || start.cc.length > 0,
            subject: current.subjectEdited ? current.subject : start.subject,
            quotedHtml: start.quotedHtml, quotedText: start.quotedText,
            replyTo: start.replyTo, forwardOf: start.forwardOf, inReplyTo: undefined, references: undefined,
            attachments: current.attachments.filter(a => !a.forwarded),
        }));
        if (type === 'forward') copyForwardedFiles(d.id, d.original.accountId, d.original.email.msgKey, start.files);
    }, [myAddresses, update, copyForwardedFiles]);

    const retarget = useCallback(async (email: Email) => {
        const d = draftRef.current;
        if (!d?.original || !d.type || d.original.email?.msgKey === email.msgKey) return null;
        const type = d.type;
        const start = await buildReply(d.original.accountId, email, type, myAddresses);
        const now = draftRef.current;
        if (!now || now.id !== d.id || now.type !== type) return null;
        // What Undo puts back (the text typed meanwhile stays)
        const before: Partial<ComposerDraft> = {
            original: now.original, to: now.to, cc: now.cc, showCc: now.showCc, subject: now.subject,
            quotedHtml: now.quotedHtml, quotedText: now.quotedText, replyTo: now.replyTo, forwardOf: now.forwardOf,
            inReplyTo: now.inReplyTo, references: now.references, attachments: now.attachments,
        };
        update(current => ({
            original: current.original && { ...current.original, email },
            to: withRecipients(start.to, current.to.filter(r => !r.auto)),
            cc: withRecipients(start.cc, current.cc.filter(r => !r.auto)),
            showCc: current.showCc || start.cc.length > 0,
            subject: current.subjectEdited ? current.subject : start.subject,
            quotedHtml: start.quotedHtml, quotedText: start.quotedText,
            replyTo: start.replyTo, forwardOf: start.forwardOf, inReplyTo: undefined, references: undefined,
            attachments: type === 'forward' ? current.attachments.filter(a => !a.forwarded) : current.attachments,
        }));
        if (type === 'forward') copyForwardedFiles(d.id, d.original.accountId, email.msgKey, start.files);
        return () => {
            if (draftRef.current?.id !== d.id) return;
            update(before);
        };
    }, [myAddresses, update, copyForwardedFiles]);

    // Saves and moves share one queue: a move waits for a save in progress, and saves wait for it.
    const changeFrom = useCallback(async (accountId: string) => {
        const d = draftRef.current;
        if (!d || d.fromAccountId === accountId) return;
        if (timer.current) clearTimeout(timer.current);
        if (saving.current) await saving.current;
        const before = d.fromAccountId;
        update({ fromAccountId: accountId }, false); // the new From and its signature show at once
        const copy = server.current.get(d.id);
        if (!copy?.msgKey) {
            // Nothing on the server yet: the next save simply goes to the new account.
            if (track.current.edits > track.current.saved) schedule();
            return;
        }
        const run = (async () => {
            const latest = draftRef.current?.id === d.id ? draftRef.current : { ...d, fromAccountId: accountId };
            const through = track.current.edits;
            setStatus('saving');
            try {
                const moved = await api.post<{ msgKey: string; oldCopyKept: boolean }>(`${paths.draft(before, latest.draftKey)}/move`, {
                    ...draftFields(latest, signatureOf(accountsRef.current, accountId)),
                    replaces: copy.replaces,
                    toAccount: accountId,
                });
                server.current.set(d.id, { msgKey: moved.msgKey, replaces: null });
                if (track.current.id === d.id) track.current.saved = Math.max(track.current.saved, through);
                if (draftRef.current?.id === d.id) setStatus(track.current.edits > track.current.saved ? 'unsaved' : 'saved');
                if (moved.oldCopyKept) {
                    const old = accountsRef.current.find(a => a.id === before)?.email ?? 'the other account';
                    showToast({ message: `The draft moved, but its old copy is still in ${old}'s Drafts`, tone: 'error' });
                }
                return true;
            } catch (err) {
                // Not moved: it stays where it was, from where it was.
                if (draftRef.current?.id === d.id) {
                    update({ fromAccountId: before }, false);
                    setStatus('failed');
                }
                showToast({ message: `Couldn't move the draft: ${errorText(err)}`, tone: 'error' });
                return false;
            } finally {
                saving.current = null;
                if (saveAgain.current) {
                    saveAgain.current = false;
                    const next = draftRef.current;
                    if (next && track.current.id === next.id && track.current.edits > track.current.saved) void saveDraft(next);
                }
            }
        })();
        saving.current = run;
        await run;
    }, [update, schedule, setStatus, showToast, saveDraft]);

    const dock = useCallback(() => {
        const d = draftRef.current;
        if (!d) return;
        update({ place: 'docked' }, false);
        if (d.original?.threadId) {
            window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: { accountId: d.original.accountId, threadId: d.original.threadId } }));
        }
    }, [update]);

    /** Shows a hidden draft again exactly as it was (Undo); a reply goes back under its conversation. */
    const showAgain = useCallback(async (d: ComposerDraft, unsaved: boolean) => {
        await begin(d, server.current.get(d.id) ?? { msgKey: null, replaces: null }, unsaved);
        if (d.place === 'docked' && d.original?.threadId) {
            window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: { accountId: d.original.accountId, threadId: d.original.threadId } }));
        }
    }, [begin]);

    // No confirmation: the draft goes, with Undo on the notice. Its copy on the server is deleted
    // only when the notice runs out (closing the tab meanwhile keeps it).
    const discard = useCallback(async () => {
        const d = draftRef.current;
        if (!d) return;
        if (timer.current) clearTimeout(timer.current);
        const unsaved = track.current.id === d.id && track.current.edits > track.current.saved;
        setWaiting(false);
        forgetKept(d.id);
        setDraft(null);
        if (!unsaved && !server.current.get(d.id)?.msgKey) return; // nothing written: nothing to undo
        const msgKeyNow = server.current.get(d.id)?.msgKey ?? null;
        if (msgKeyNow) setDiscarding(list => [...list, msgKeyNow]);
        let undone = false;
        const deleteLater = setTimeout(async () => {
            if (undone) return;
            if (saving.current) await saving.current;
            const msgKey = server.current.get(d.id)?.msgKey;
            try {
                if (msgKey) await api.del(paths.draft(d.fromAccountId, msgKey));
            } catch (err) {
                showToast({ message: `Couldn't delete the draft: ${errorText(err)}`, tone: 'error' });
            } finally {
                if (msgKeyNow) setDiscarding(list => list.filter(k => k !== msgKeyNow));
            }
        }, DISCARD_NOTICE_MS);
        showToast({
            message: 'Draft discarded', durationMs: DISCARD_NOTICE_MS,
            actions: [{
                label: 'Undo', onClick: () => {
                    undone = true;
                    clearTimeout(deleteLater);
                    if (msgKeyNow) setDiscarding(list => list.filter(k => k !== msgKeyNow));
                    void showAgain(d, unsaved);
                },
            }],
        });
    }, [setDraft, showToast, showAgain, setWaiting, forgetKept]);

    const send = useCallback(async () => {
        const d = draftRef.current;
        if (!d || sending) return;
        const wait = () => {
            setWaiting(true);
            keepNow();
        };
        if (reachability.isFailing()) {
            wait();
            return;
        }
        setSending(true);
        try {
            if (timer.current) clearTimeout(timer.current);
            if (saving.current) await saving.current;
            // Continuing another app's draft: replace it first, so sending removes it too.
            if (server.current.get(d.id)?.replaces) await saveDraft(draftRef.current ?? d);
            const current = draftRef.current?.id === d.id ? draftRef.current : d;
            const copy = server.current.get(d.id);
            const unsaved = track.current.id === d.id && track.current.edits > track.current.saved;
            const content = message(current, signatureOf(accountsRef.current, current.fromAccountId));
            const tell = (event: SentMessage) => { for (const listener of sentListeners.current) listener(event); };
            const fromAccount = accountsRef.current.find(a => a.id === current.fromAccountId);
            const about = {
                accountId: current.original?.accountId ?? null, threadId: current.original?.threadId ?? null,
                fromAccountId: current.fromAccountId,
                from: { name: fromAccount?.displayName ?? null, address: fromAccount?.email ?? '' },
                subject: current.subject, html: content.html, text: current.body, to: content.to, cc: content.cc,
                targetKey: current.original?.email?.msgKey ?? null,
            };
            // Undo: take it back while the engine still holds it, then show the draft as it was.
            const undo = async (item: OutboxItem) => {
                try {
                    await api.post(`${paths.outboxItem(current.fromAccountId, item.id)}/cancel`);
                } catch (err) {
                    const gone = (err as { status?: number }).status === 409;
                    showToast({ message: gone ? 'Already sent' : `Couldn't take it back: ${errorText(err)}`, tone: gone ? 'info' : 'error' });
                    return;
                }
                tell({ kind: 'undone', item, ...about });
                await showAgain(current, unsaved);
            };
            const item = await sendMessage({
                ...content,
                replyTo: current.replyTo,
                inReplyTo: current.inReplyTo,
                references: current.references,
                // A forward's files are already uploads (copied when forwarding).
                attachments: current.attachments.filter(a => a.id).map(a => a.id!),
                // The draft is removed once the sent copy is safely in Sent.
                draftKey: copy?.msgKey && !copy.replaces ? current.draftKey : undefined,
                holdMs: HOLD_MS,
            }, current.fromAccountId, item => void undo(item));
            if (item === 'unreachable') {
                wait();
                return;
            }
            if (!item) return; // refused: the composer stays open (the notice says why)
            setWaiting(false);
            forgetKept(d.id);
            if (draftRef.current?.id === d.id) setDraft(null);
            tell({ kind: 'sent', item, ...about });
        } finally {
            setSending(false);
        }
    }, [sending, saveDraft, sendMessage, setDraft, showToast, showAgain, setWaiting, keepNow, forgetKept]);

    const retrySave = useCallback(() => {
        const d = draftRef.current;
        if (d) void saveDraft(d);
    }, [saveDraft]);

    // Files dropped or picked: each uploads at once, its progress under its chip. Trouble shows in
    // the strip, never in a dialog.
    const addFiles = useCallback((files: File[]) => {
        const d = draftRef.current;
        if (!d || !files.length) return;
        let total = d.attachments.filter(a => !a.error).reduce((n, a) => n + a.size, 0);
        for (const file of files) {
            const key = crypto.randomUUID();
            total += file.size;
            if (total > MAX_ATTACHMENTS_MB * 1024 * 1024) {
                total -= file.size;
                update(current => ({ attachments: [...current.attachments, { key, filename: file.name, size: file.size, error: `Over the ${MAX_ATTACHMENTS_MB} MB limit for all attachments together` }] }), false);
                continue;
            }
            update(current => ({ attachments: [...current.attachments, { key, filename: file.name, size: file.size, progress: 0 }] }));
            uploadFile(file, fraction => {
                if (draftRef.current?.id === d.id) update(current => ({ attachments: current.attachments.map(a => (a.key === key ? { ...a, progress: fraction } : a)) }), false);
            })
                .then(info => {
                    if (draftRef.current?.id !== d.id) return;
                    update(current => ({ attachments: current.attachments.map(a => (a.key === key ? { ...a, id: info.id, progress: undefined } : a)) }));
                })
                .catch(err => {
                    if (draftRef.current?.id !== d.id) return;
                    update(current => ({ attachments: current.attachments.map(a => (a.key === key ? { ...a, progress: undefined, error: `Couldn't attach it: ${errorText(err)}` } : a)) }), false);
                });
        }
    }, [update]);

    const removeAttachment = useCallback((key: string) => {
        update(current => ({ attachments: current.attachments.filter(a => a.key !== key) }));
    }, [update]);

    const onSent = useCallback((listener: (sent: SentMessage) => void) => {
        sentListeners.current.add(listener);
        return () => { sentListeners.current.delete(listener); };
    }, []);

    // A file dropped next to the composer, not on it, mustn't make the browser open it in place of
    // the app: only the composer takes dropped files.
    useEffect(() => {
        const guard = (e: DragEvent) => {
            if (e.defaultPrevented || !Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
            e.preventDefault();
            if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        };
        window.addEventListener('dragover', guard);
        window.addEventListener('drop', guard);
        return () => {
            window.removeEventListener('dragover', guard);
            window.removeEventListener('drop', guard);
        };
    }, []);

    // Warn before closing the tab with changes the server doesn't have yet
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (draftRef.current && track.current.edits > track.current.saved) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // A draft kept on this computer from before (the page was reloaded or closed meanwhile): offered
    // back once, with Open or Discard (which forgets only this computer's copy).
    const offered = useRef<string | null>(null);
    const offerKept = useCallback(() => {
        const kept = keptDraft();
        if (!kept || draftRef.current?.id === kept.draft.id || offered.current === kept.keptAt) return;
        if (!accountsRef.current.some(a => a.id === kept.draft.fromAccountId)) return;
        offered.current = kept.keptAt;
        showToast({
            message: kept.waitingToSend ? 'A message waiting to send was kept on this computer' : 'A draft you were writing was kept on this computer',
            durationMs: null,
            actions: [
                {
                    label: 'Open', onClick: () => {
                        server.current.set(kept.draft.id, kept.copy);
                        setKeptLocally(true);
                        reopenFrom.current({ ...kept.draft, place: 'docked' }, true);
                    },
                },
                { label: 'Discard', onClick: () => forgetDraft(kept.draft.id) },
            ],
        });
    }, [showToast]);
    useEffect(() => {
        if (accounts.length) offerKept();
    }, [accounts.length, offerKept]);

    // The session ended: what's being written is kept here before anything else happens
    useEffect(() => {
        const keep = () => {
            if (draftRef.current) keepNow();
        };
        window.addEventListener(AUTH_REQUIRED_EVENT, keep);
        return () => window.removeEventListener(AUTH_REQUIRED_EVENT, keep);
    }, [keepNow]);

    // The server answers again, or signed in again after the session ended: a save that failed
    // meanwhile is tried again, a waiting Send goes, and a kept draft is offered back.
    const sendRef = useRef(send);
    useEffect(() => { sendRef.current = send; }, [send]);
    useEffect(() => {
        const back = () => {
            if (statusRef.current === 'failed') retrySave();
            if (waitingRef.current && draftRef.current) {
                setWaiting(false);
                void sendRef.current();
            }
            offerKept();
        };
        window.addEventListener(SESSION_RESTORED_EVENT, back);
        const offRecovered = reachability.onRecovered(back);
        return () => {
            window.removeEventListener(SESSION_RESTORED_EVENT, back);
            offRecovered();
        };
    }, [retrySave, setWaiting, offerKept]);

    const value = useMemo(() => ({
        draft, status, sending, waiting, keptLocally, myAddresses, recentDraft, discarding,
        update, openNew, openReply, openSaved, changeType, retarget, changeFrom, dock, close, discard, send, retrySave, addFiles, removeAttachment, onSent,
    }), [draft, status, sending, waiting, keptLocally, myAddresses, recentDraft, discarding, update, openNew, openReply, openSaved, changeType, retarget, changeFrom, dock, close, discard, send, retrySave, addFiles, removeAttachment, onSent]);

    return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useComposer = () => {
    const context = useContext(ComposerContext);
    if (!context) throw new Error('useComposer must be used within a ComposerProvider');
    return context;
};
