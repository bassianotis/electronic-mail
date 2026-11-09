// User actions as two-phase tasks (docs/architecture.md, rules 1, 6, 8; borrowed from Mailspring):
//   local phase  — enqueue*() records the task and the view changes immediately
//   remote phase — runPendingTasks() performs it on the server, then resyncs what it touched
// Tasks are persisted, so a crash or restart resumes them. Transient (network) failures are
// retried; anything else fails the task cleanly so the queue can never wedge (Mailspring
// PR #143). A thread move "ends whole": if part of it fails, the parts already moved are
// moved back using the UIDs the server reported (UIDPLUS COPYUID).
import type { ImapFlow } from 'imapflow';
import type { Store } from '../store/store.ts';
import { ChangeSet } from '../store/changes.ts';
import { syncFolder } from '../sync/folderSync.ts';
import { updateThreads } from '../threads/threads.ts';

export type TaskStatus = 'pending' | 'done' | 'failed' | 'cancelled';
export type TaskKind = 'moveThread' | 'undoMove' | 'setSeen';

export interface TaskRow {
    id: number;
    account: string;
    kind: TaskKind;
    payload: string;
    status: TaskStatus;
    attempts: number;
    error: string | null;
    progress: string;
}

interface MovePayload {
    threadId: string;
    /** Thread members at enqueue time; replies that join later move too. */
    msgKeys: string[];
    to: string;
    /** Where the thread was, for undo. */
    from: string | null;
    /** Who asked: the user (absent), a sender rule ("rule") or a bucket's auto-archive ("autoArchive"). */
    origin?: MoveOrigin;
}

export type MoveOrigin = 'rule' | 'autoArchive';

interface UndoPayload {
    taskId: number;
    msgKeys: string[];
    restoreTo: string | null;
}

interface SeenPayload {
    threadId: string;
    msgKeys: string[];
    seen: boolean;
}

/** One folder's worth of a move: [source uid, destination uid] pairs. */
interface MoveStep {
    from: string;
    to: string;
    uids: [number, number][];
}

const MOVABLE_ROLES = new Set(['inbox', 'bucket', 'archive']);
const MAX_ATTEMPTS = 3;
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'NoConnection', 'ClosedAfterConnectTLS']);

export class TaskError extends Error {}

// ---------------------------------------------------------------- local phase

export function enqueueMoveThread(store: Store, account: string, threadId: string, to: string, origin?: MoveOrigin): number {
    const thread = store.db.prepare('SELECT location FROM thread WHERE account = ? AND thread_id = ?')
        .get(account, threadId) as { location: string | null } | undefined;
    if (!thread) throw new TaskError(`unknown thread ${threadId}`);
    if (!store.getFolder(account, to)) throw new TaskError(`unknown folder ${to}`);
    const payload: MovePayload = { threadId, msgKeys: threadMessageKeys(store, account, threadId), to, from: thread.location, ...(origin ? { origin } : {}) };
    return store.transaction(() => {
        const id = insertTask(store, account, 'moveThread', payload);
        showLocation(store, account, threadId, to);
        return id;
    });
}

/**
 * Undo a move. Before its remote phase ran, the move is simply cancelled (nothing touched the
 * server). Afterwards, an undo task moves the exact messages back where each one came from.
 */
export function enqueueUndo(store: Store, account: string, taskId: number): number | null {
    const original = getTask(store, taskId);
    if (!original || original.kind !== 'moveThread') throw new TaskError(`task ${taskId} is not a move`);
    const p = JSON.parse(original.payload) as MovePayload;
    const threadId = currentThreadId(store, account, p.msgKeys);
    return store.transaction(() => {
        if (original.status === 'pending') {
            setStatus(store, taskId, 'cancelled', null);
            if (threadId) showLocation(store, account, threadId, p.from);
            return null;
        }
        if (original.status !== 'done') throw new TaskError(`task ${taskId} is ${original.status}; nothing to undo`);
        const id = insertTask(store, account, 'undoMove', { taskId, msgKeys: p.msgKeys, restoreTo: p.from } satisfies UndoPayload);
        if (threadId) showLocation(store, account, threadId, p.from);
        return id;
    });
}

/**
 * Mark a thread read (every message, on every copy) or unread (its newest received message,
 * like Gmail). Opening a thread in the UI marks it read.
 */
export function enqueueSetSeen(store: Store, account: string, threadId: string, seen: boolean): number {
    const thread = store.db.prepare('SELECT latest_msg_key FROM thread WHERE account = ? AND thread_id = ?')
        .get(account, threadId) as { latest_msg_key: string } | undefined;
    if (!thread) throw new TaskError(`unknown thread ${threadId}`);
    const msgKeys = seen ? threadMessageKeys(store, account, threadId) : [newestReceivedKey(store, account, threadId) ?? thread.latest_msg_key];
    return store.transaction(() => {
        const id = insertTask(store, account, 'setSeen', { threadId, msgKeys, seen } satisfies SeenPayload);
        const setPlacement = store.db.prepare('UPDATE placement SET seen = ? WHERE account = ? AND msg_key = ?');
        for (const key of msgKeys) setPlacement.run(seen ? 1 : 0, account, key);
        store.db.prepare(`UPDATE thread SET unread = ${seen ? '0' : 'MAX(unread, 1)'} WHERE account = ? AND thread_id = ?`)
            .run(account, threadId);
        return id;
    });
}

export function getTask(store: Store, id: number): TaskRow | undefined {
    return store.db.prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow | undefined;
}

export function hasPendingTasks(store: Store, account: string): boolean {
    return !!store.db.prepare(`SELECT 1 FROM task WHERE account = ? AND status = 'pending' LIMIT 1`).get(account);
}

// ---------------------------------------------------------------- remote phase

export interface TaskOutcome {
    id: number;
    kind: TaskKind;
    status: TaskStatus;
    error: string | null;
}

/** `into` (optional) receives everything the tasks' syncs changed, e.g. for sender rules. */
export async function runPendingTasks(client: ImapFlow, store: Store, account: string, into?: ChangeSet): Promise<TaskOutcome[]> {
    const tasks = store.db.prepare(`SELECT * FROM task WHERE account = ? AND status = 'pending' ORDER BY id`)
        .all(account) as unknown as TaskRow[];
    const outcomes: TaskOutcome[] = [];
    const touched = new Set<string>();
    const changes = new ChangeSet();

    for (const task of tasks) {
        // Whatever happens, this task's threads must be re-summarized (its overlay ends or changes).
        for (const key of (JSON.parse(task.payload) as { msgKeys: string[] }).msgKeys) changes.touched.add(key);
        try {
            if (task.kind === 'moveThread') await performMove(client, store, account, task, touched, changes);
            else if (task.kind === 'undoMove') await performUndo(client, store, account, task, touched);
            else await performSetSeen(client, store, account, task, touched);
            setStatus(store, task.id, 'done', null);
            outcomes.push({ id: task.id, kind: task.kind, status: 'done', error: null });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const attempts = task.attempts + 1;
            if (isTransient(client, err) && attempts < MAX_ATTEMPTS) {
                // Keep it pending (and its progress) for the next run; later tasks wait behind it.
                store.db.prepare('UPDATE task SET attempts = ?, error = ?, updated_at = ? WHERE id = ?')
                    .run(attempts, message, new Date().toISOString(), task.id);
                outcomes.push({ id: task.id, kind: task.kind, status: 'pending', error: message });
                break;
            }
            setStatus(store, task.id, 'failed', message);
            outcomes.push({ id: task.id, kind: task.kind, status: 'failed', error: message });
        }
    }

    // Refresh what the tasks touched. A folder that vanished on the server is dropped from the
    // cache; any other trouble is left to the next background sync, never thrown at the caller.
    if (client.usable) {
        for (const folder of touched) {
            if (!store.getFolder(account, folder)) continue;
            try {
                await syncFolder(client, store, account, folder, changes);
            } catch (err) {
                if (isMissingFolder(err)) {
                    store.transaction(() => { for (const k of store.removeFolder(account, folder)) changes.touched.add(k); });
                } else if (!client.usable) break;
            }
        }
    }
    updateThreads(store, account, changes);
    into?.merge(changes);
    return outcomes;
}

async function performMove(client: ImapFlow, store: Store, account: string, task: TaskRow, touched: Set<string>, changes: ChangeSet): Promise<void> {
    const p = JSON.parse(task.payload) as MovePayload;
    const progress = JSON.parse(task.progress) as MoveStep[];
    touched.add(p.to);

    // Refresh the folders involved first, so we move the UIDs that exist right now
    // (another client may have moved things since the task was queued).
    for (const folder of new Set([...movablePlacements(store, account, p).map(x => x.folder), p.to])) {
        touched.add(folder);
        try {
            await syncFolder(client, store, account, folder, changes);
        } catch (err) {
            if (isMissingFolder(err)) throw new TaskError(`folder ${folder} no longer exists on the server`);
            throw err;
        }
    }
    // Messages that arrived in the meantime may have joined (or bridged) the thread.
    updateThreads(store, account, changes);

    const byFolder = new Map<string, number[]>();
    for (const { folder, uid } of movablePlacements(store, account, p)) {
        if (folder === p.to) continue;
        byFolder.set(folder, [...(byFolder.get(folder) ?? []), uid]);
    }

    try {
        for (const [folder, uids] of [...byFolder].sort(([a], [b]) => a.localeCompare(b))) {
            const step = await moveUids(client, folder, uids, p.to);
            progress.push(step);
            saveProgress(store, task.id, progress);
        }
    } catch (err) {
        if (isTransient(client, err)) throw err; // resume later from saved progress
        await rollBack(client, progress);
        saveProgress(store, task.id, []);
        throw err;
    }
}

async function performUndo(client: ImapFlow, store: Store, account: string, task: TaskRow, touched: Set<string>): Promise<void> {
    const p = JSON.parse(task.payload) as UndoPayload;
    const original = getTask(store, p.taskId);
    if (!original) throw new TaskError(`task ${p.taskId} not found`);
    const steps = JSON.parse(original.progress) as MoveStep[];
    for (const s of steps) { touched.add(s.from); touched.add(s.to); }
    await rollBack(client, steps);
}

/** Read state fans out to every copy of the message (Mailspring: mark-read-fans-out-to-all-placements). */
async function performSetSeen(client: ImapFlow, store: Store, account: string, task: TaskRow, touched: Set<string>): Promise<void> {
    const p = JSON.parse(task.payload) as SeenPayload;
    const byFolder = new Map<string, number[]>();
    const rows = store.db.prepare(`SELECT folder, uid FROM placement WHERE account = ? AND msg_key = ?`);
    for (const key of p.msgKeys) {
        for (const { folder, uid } of rows.all(account, key) as { folder: string; uid: number }[]) {
            byFolder.set(folder, [...(byFolder.get(folder) ?? []), uid]);
        }
    }
    for (const [folder, uids] of byFolder) {
        touched.add(folder);
        await withWritable(client, folder, async () => {
            const ok = p.seen
                ? await client.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true })
                : await client.messageFlagsRemove(uids.join(','), ['\\Seen'], { uid: true });
            if (!ok) throw new TaskError(`server refused to change read state in ${folder}`);
        });
    }
}

/** Moves each step's messages back from its destination to its source, newest step first. */
async function rollBack(client: ImapFlow, steps: MoveStep[]): Promise<void> {
    for (const s of [...steps].reverse()) {
        const destUids = s.uids.map(([, dest]) => dest);
        if (destUids.length) await moveUids(client, s.to, destUids, s.from);
    }
}

async function moveUids(client: ImapFlow, folder: string, uids: number[], to: string): Promise<MoveStep> {
    return withWritable(client, folder, async () => {
        const result = await client.messageMove(uids.join(','), to, { uid: true });
        if (!result) throw new TaskError(`server refused to move messages from ${folder} to ${to}`);
        return { from: folder, to, uids: [...(result.uidMap ?? new Map<number, number>())] };
    });
}

/** Sync opens folders read-only (EXAMINE); changing anything needs a read-write SELECT. */
async function withWritable<T>(client: ImapFlow, folder: string, fn: () => Promise<T>): Promise<T> {
    if (client.mailbox && client.mailbox.path === folder && client.mailbox.readOnly) await client.mailboxClose();
    const lock = await client.getMailboxLock(folder);
    try {
        return await fn();
    } finally {
        lock.release();
    }
}

// ---------------------------------------------------------------- helpers

function threadMessageKeys(store: Store, account: string, threadId: string): string[] {
    return (store.db.prepare('SELECT msg_key FROM message WHERE account = ? AND thread_id = ?')
        .all(account, threadId) as { msg_key: string }[]).map(r => r.msg_key);
}

function newestReceivedKey(store: Store, account: string, threadId: string): string | null {
    const row = store.db.prepare(`SELECT m.msg_key FROM message m
        JOIN placement p ON p.account = m.account AND p.msg_key = m.msg_key
        JOIN folder f ON f.account = p.account AND f.path = p.folder
        WHERE m.account = ? AND m.thread_id = ? AND f.role IN ('inbox', 'bucket', 'archive', 'other')
        ORDER BY m.date DESC LIMIT 1`).get(account, threadId) as { msg_key: string } | undefined;
    return row?.msg_key ?? null;
}

function movablePlacements(store: Store, account: string, p: MovePayload): { folder: string; uid: number }[] {
    const threadId = currentThreadId(store, account, p.msgKeys);
    if (!threadId) return [];
    return (store.db.prepare(`SELECT p.folder, p.uid, f.role FROM placement p
        JOIN folder f ON f.account = p.account AND f.path = p.folder
        JOIN message m ON m.account = p.account AND m.msg_key = p.msg_key
        WHERE p.account = ? AND m.thread_id = ?`).all(account, threadId) as { folder: string; uid: number; role: string }[])
        .filter(r => MOVABLE_ROLES.has(r.role) || r.folder === p.from);
}

function currentThreadId(store: Store, account: string, msgKeys: string[]): string | null {
    for (const key of msgKeys) {
        const row = store.db.prepare('SELECT thread_id FROM message WHERE account = ? AND msg_key = ?')
            .get(account, key) as { thread_id: string | null } | undefined;
        if (row?.thread_id) return row.thread_id;
    }
    return null;
}

function showLocation(store: Store, account: string, threadId: string, location: string | null): void {
    store.db.prepare(`UPDATE thread SET location = ?,
        location_role = (SELECT role FROM folder WHERE account = ? AND path = ?)
        WHERE account = ? AND thread_id = ?`).run(location, account, location, account, threadId);
}

function insertTask(store: Store, account: string, kind: TaskKind, payload: object): number {
    const now = new Date().toISOString();
    const r = store.db.prepare(`INSERT INTO task (account, kind, payload, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?)`).run(account, kind, JSON.stringify(payload), now, now);
    return Number(r.lastInsertRowid);
}

function setStatus(store: Store, id: number, status: TaskStatus, error: string | null): void {
    store.db.prepare('UPDATE task SET status = ?, error = ?, updated_at = ? WHERE id = ?')
        .run(status, error, new Date().toISOString(), id);
}

function saveProgress(store: Store, id: number, steps: MoveStep[]): void {
    store.db.prepare('UPDATE task SET progress = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(steps), new Date().toISOString(), id);
}

export function isMissingFolder(err: unknown): boolean {
    const e = err as { mailboxMissing?: boolean; serverResponseCode?: string; responseText?: string };
    return e?.mailboxMissing === true || e?.serverResponseCode === 'NONEXISTENT' || /doesn't exist|does not exist|NONEXISTENT/i.test(e?.responseText ?? '');
}

export function isTransient(client: ImapFlow, err: unknown): boolean {
    if (err instanceof TaskError) return false;
    const code = (err as { code?: string })?.code;
    return !client.usable || (!!code && TRANSIENT_CODES.has(code));
}
