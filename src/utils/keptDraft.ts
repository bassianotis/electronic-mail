/**
 * The open draft, kept on this computer (localStorage) while the server can't have it: when it
 * can't be reached, or the session ended. It's offered back once the server answers again (or
 * after signing in) and forgotten as soon as the server has a copy, or it's sent or discarded.
 * One draft at a time, like the composer.
 */
import type { ComposerDraft } from '../context/ComposerContext';

const KEY = 'mail_kept_draft';

export interface KeptDraft {
    draft: ComposerDraft;
    /** Its copy on the server, if it had one (the next save replaces it). */
    copy: { msgKey: string | null; replaces: string | null };
    keptAt: string;
    /** Send was pressed while the server couldn't be reached. */
    waitingToSend?: boolean;
}

export function keepDraft(draft: ComposerDraft, copy: KeptDraft['copy'], waitingToSend = false): void {
    // Files still uploading (or that failed) can't come back; uploaded ones are on the server.
    const kept: KeptDraft = {
        draft: { ...draft, attachments: draft.attachments.filter(a => a.id && !a.error).map(a => ({ ...a, progress: undefined })) },
        copy, keptAt: new Date().toISOString(), waitingToSend,
    };
    try {
        localStorage.setItem(KEY, JSON.stringify(kept));
    } catch {
        // Storage full or blocked: the server copy (if any) is all there is
    }
}

export function keptDraft(): KeptDraft | null {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as KeptDraft) : null;
    } catch {
        return null;
    }
}

/** Forgets the kept draft (only if it's that composition, when `id` is given). */
export function forgetDraft(id?: string): void {
    try {
        if (id !== undefined && keptDraft()?.draft.id !== id) return;
        localStorage.removeItem(KEY);
    } catch {
        // nothing kept
    }
}
