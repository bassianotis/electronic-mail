// Auto-archive per bucket (feature batch 1): a bucket can archive its own old items, "Archive
// items older than N days". Age is the conversation's newest received message (the date its card
// shows), so a reply that brings it back to the Inbox restarts the clock, as Thunderbird's
// per-folder retention counts it. A sweep runs once a day and queues ordinary, undoable moves
// (tagged "autoArchive", as sender rules tag theirs "rule"), at most SWEEP_CAP, oldest first; a
// full batch means more are waiting, so the next comes an hour later and a big first run still
// finishes within a few hours. Each sweep is recorded as a batch, so the app can say so once and
// undo it all, and so a restart knows when the last one ran.
// Undo restarts the clock of what it brings back, as a reply does: it stays another N days.
// Only one engine should sweep a given mailbox: two would queue the same moves. Keep that in mind
// when the live engine moves to the Pi.
import type { Store } from '../store/store.ts';
import { enqueueMoveThread, enqueueUndo, getTask } from '../tasks/tasks.ts';

export interface AutoArchiveRule {
    /** The bucket's name, for the notice. */
    name: string;
    path: string;
    days: number;
}

/** What the app shows once after sweeps: "Archived 14 older items from Reads · Undo". */
export interface SweepNotice {
    ids: number[];
    count: number;
    buckets: string[];
    /** False once any of the batches is older than UNDO_DAYS (its items stay in Archive). */
    undoable: boolean;
}

interface SweepMove {
    taskId: number;
    bucket: string;
}

export const SWEEP_CAP = 200;
/** After a full batch, the next sweep comes this soon (ms), not a day later. */
export const CATCH_UP_MS = 60 * 60_000;
export const UNDO_DAYS = 7;
export const MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60_000;

const cutoff = (days: number, now: Date) => new Date(now.getTime() - days * DAY_MS).toISOString();

/** Conversations in `folder` older than `days` (by their newest received message), oldest first. */
function oldThreads(store: Store, account: string, folder: string, days: number, now: Date, limit: number): { threadId: string; date: string; faceKey: string }[] {
    return store.db.prepare(`SELECT thread_id AS threadId, face_date AS date, face_msg_key AS faceKey FROM thread
        WHERE account = ? AND location = ? AND face_date IS NOT NULL AND face_date < ?
        ORDER BY face_date, thread_id LIMIT ?`).all(account, folder, cutoff(days, now), limit) as { threadId: string; date: string; faceKey: string }[];
}

/** When Undo last brought each message back (its clock starts again from then). */
function undoneAt(store: Store, account: string): Map<string, string> {
    const at = new Map<string, string>();
    const rows = store.db.prepare('SELECT moves, undone_at FROM sweep WHERE account = ? AND undone_at IS NOT NULL ORDER BY undone_at')
        .all(account) as { moves: string; undone_at: string }[];
    for (const r of rows) {
        for (const m of JSON.parse(r.moves) as SweepMove[]) {
            const task = getTask(store, m.taskId);
            if (task) for (const key of (JSON.parse(task.payload) as { msgKeys: string[] }).msgKeys) at.set(key, r.undone_at);
        }
    }
    return at;
}

/** A bucket's items past its age, counting from an Undo when that was later. */
function dueThreads(store: Store, account: string, rule: { path: string; days: number }, now: Date, limit: number, undone: Map<string, string>) {
    const before = cutoff(rule.days, now);
    return oldThreads(store, account, rule.path, rule.days, now, limit < 0 ? limit : limit + undone.size)
        .filter(t => (undone.get(t.faceKey) ?? '') < before)
        .slice(0, limit < 0 ? undefined : limit);
}

/** How many items a setting would archive now (shown before it's saved). */
export function countOld(store: Store, account: string, folder: string, days: number, now = new Date()): number {
    return dueThreads(store, account, { path: folder, days }, now, -1, undoneAt(store, account)).length;
}

/** Queues the oldest items past their bucket's age for Archive; returns the batch, if anything went. */
export function sweep(store: Store, account: string, rules: AutoArchiveRule[], now = new Date(), cap = SWEEP_CAP): { id: number; moved: number } | null {
    const archive = store.listFolders(account).find(f => f.role === 'archive')?.path;
    if (!archive || !rules.length) return null;
    const undone = undoneAt(store, account);
    const due = rules
        .flatMap(r => dueThreads(store, account, r, now, cap, undone).map(t => ({ ...t, bucket: r.name })))
        .sort((a, b) => a.date.localeCompare(b.date) || a.threadId.localeCompare(b.threadId))
        .slice(0, cap);
    const moves: SweepMove[] = [];
    for (const t of due) {
        try {
            moves.push({ taskId: enqueueMoveThread(store, account, t.threadId, archive, 'autoArchive'), bucket: t.bucket });
        } catch {
            // Gone since it was found: the next sweep looks again.
        }
    }
    if (!moves.length) {
        // Nothing went: note the check anyway (one such note per account), for lastSweep().
        store.db.prepare(`DELETE FROM sweep WHERE account = ? AND moves = '[]'`).run(account);
        store.db.prepare(`INSERT INTO sweep (account, created_at, moves, seen) VALUES (?, ?, '[]', 1)`).run(account, now.toISOString());
        return null;
    }
    const r = store.db.prepare('INSERT INTO sweep (account, created_at, moves) VALUES (?, ?, ?)').run(account, now.toISOString(), JSON.stringify(moves));
    return { id: Number(r.lastInsertRowid), moved: moves.length };
}

/** When the account's last sweep ran and how much it moved, so a restart doesn't sweep again early. */
export function lastSweep(store: Store, account: string): { at: number; moved: number } | null {
    const row = store.db.prepare('SELECT created_at, moves FROM sweep WHERE account = ? ORDER BY id DESC LIMIT 1')
        .get(account) as { created_at: string; moves: string } | undefined;
    return row ? { at: Date.parse(row.created_at), moved: (JSON.parse(row.moves) as SweepMove[]).length } : null;
}

/** The sweeps not yet shown, combined; null when none moved anything. */
export function sweepNotice(store: Store, account: string, now = new Date()): SweepNotice | null {
    const rows = store.db.prepare('SELECT id, created_at, moves FROM sweep WHERE account = ? AND seen = 0 AND undone_at IS NULL ORDER BY id')
        .all(account) as { id: number; created_at: string; moves: string }[];
    if (!rows.length) return null;
    const moved = rows.flatMap(r => JSON.parse(r.moves) as SweepMove[]).filter(m => isLive(store, m.taskId));
    if (!moved.length) {
        markSeen(store, account, rows.map(r => r.id)); // every move failed: nothing to say
        return null;
    }
    return {
        ids: rows.map(r => r.id),
        count: moved.length,
        buckets: [...new Set(moved.map(m => m.bucket))],
        undoable: rows.every(r => now.getTime() - Date.parse(r.created_at) < UNDO_DAYS * DAY_MS),
    };
}

export function markSeen(store: Store, account: string, ids: number[]): void {
    const seen = store.db.prepare('UPDATE sweep SET seen = 1 WHERE account = ? AND id = ?');
    for (const id of ids) seen.run(account, id);
}

/** Undoes whole batches (within UNDO_DAYS); returns how many items are going back. */
export function undoSweeps(store: Store, account: string, ids: number[], now = new Date()): number {
    let undone = 0;
    for (const id of ids) {
        const row = store.db.prepare('SELECT created_at, moves FROM sweep WHERE account = ? AND id = ? AND undone_at IS NULL')
            .get(account, id) as { created_at: string; moves: string } | undefined;
        if (!row || now.getTime() - Date.parse(row.created_at) >= UNDO_DAYS * DAY_MS) continue;
        for (const m of JSON.parse(row.moves) as SweepMove[]) {
            if (!isLive(store, m.taskId)) continue;
            try {
                enqueueUndo(store, account, m.taskId);
                undone++;
            } catch {
                // Changed since (e.g. a failed move): leave it.
            }
        }
        store.db.prepare('UPDATE sweep SET undone_at = ?, seen = 1 WHERE id = ?').run(now.toISOString(), id);
    }
    return undone;
}

/** A move that went through, or still will. */
function isLive(store: Store, taskId: number): boolean {
    const status = getTask(store, taskId)?.status;
    return status === 'done' || status === 'pending';
}
