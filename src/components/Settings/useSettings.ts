/**
 * Settings' hooks and helpers (settings-spec.md §2): saving a field as you go, loading a
 * section's data for one account, and the times the password status shows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../api/client';

/** "Saving…" shows only when a save takes longer than this; "Saved" stays this long. */
const SAVING_AFTER_MS = 300;
const SAVED_FOR_MS = 2000;
/** A pause in typing this long saves the field. */
export const TYPING_PAUSE_MS = 800;

export type SaveState = 'idle' | 'saving' | 'saved';

/** An engine reason as a sentence: "the server refused…" → "The server refused…" */
export const sentence = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * Saving one field as you go. `save` resolves when the engine has it; a refusal becomes the
 * field's problem (in words), and the field keeps what was typed.
 */
export function useSaving<T>(save: (value: T) => Promise<void>) {
    const [state, setState] = useState<SaveState>('idle');
    const [problem, setProblem] = useState<string | null>(null);
    const timers = useRef<number[]>([]);
    const latest = useRef(0);
    useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

    const run = useCallback(async (value: T): Promise<boolean> => {
        const n = ++latest.current;
        const clear = () => { timers.current.forEach(t => window.clearTimeout(t)); timers.current = []; };
        clear();
        timers.current.push(window.setTimeout(() => { if (latest.current === n) setState('saving'); }, SAVING_AFTER_MS));
        try {
            await save(value);
            if (latest.current !== n) return true;
            clear();
            setProblem(null);
            setState('saved');
            timers.current.push(window.setTimeout(() => { if (latest.current === n) setState('idle'); }, SAVED_FOR_MS));
            return true;
        } catch (err) {
            if (latest.current !== n) return false;
            clear();
            setState('idle');
            setProblem(sentence(errorText(err)));
            return false;
        }
    }, [save]);

    return { state, problem, setProblem, run };
}

interface Loaded<T> { key: string; round: number; data: T | null; failed: boolean }

/**
 * Loads a section's data for one account: null while it loads (skeleton fields), `failed` when it
 * couldn't ("Couldn't load these settings"). It loads again when `key` changes (another account)
 * and on `retry`.
 */
export function useSectionData<T>(load: () => Promise<T>, key: string) {
    const [round, setRound] = useState(0);
    const [loaded, setLoaded] = useState<Loaded<T>>({ key: '', round: -1, data: null, failed: false });
    const loader = useRef(load);
    useEffect(() => { loader.current = load; });
    useEffect(() => {
        let alive = true;
        loader.current().then(
            data => { if (alive) setLoaded({ key, round, data, failed: false }); },
            () => { if (alive) setLoaded({ key, round, data: null, failed: true }); },
        );
        return () => { alive = false; };
    }, [key, round]);
    const current = loaded.key === key && loaded.round === round;
    const retry = useCallback(() => setRound(r => r + 1), []);
    /** Changes the copy on screen (after a save). */
    const setData = useCallback((update: (data: T) => T) => setLoaded(l => (l.data ? { ...l, data: update(l.data) } : l)), []);
    /** Fetches again without the skeleton (after a change); the last good copy stays if it fails. */
    const refresh = useCallback(async () => {
        try {
            const data = await loader.current();
            setLoaded(l => ({ ...l, data }));
        } catch { /* kept */ }
    }, []);
    return { data: current ? loaded.data : null, failed: current && loaded.failed, retry, setData, refresh };
}

/** "10:02 AM" today; "Nov 10, 10:02 AM" another day. */
export function clockTime(iso: string | null): string | null {
    if (!iso) return null;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const today = new Date().toDateString() === at.toDateString();
    return today ? time : `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** "just now", "2 minutes ago", "3 hours ago", else the clock time. */
export function sinceText(iso: string | null, now: number): string | null {
    if (!iso) return null;
    const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
    if (Number.isNaN(minutes)) return null;
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return clockTime(iso);
}

/** Settings' sections: this account's four, then the two for every account. */
export type SectionKey = 'name' | 'password' | 'rules' | 'opening' | 'accounts' | 'backup';
export const SECTION_KEYS: SectionKey[] = ['name', 'password', 'rules', 'opening', 'accounts', 'backup'];

/** Where Settings opens: a section (the gear opens the last one used), for an account. */
export interface SettingsTarget { section: SectionKey; accountId?: string | null }

const LAST_SECTION_KEY = 'settingsSection';

/** The section the gear opens: the last one used, else Name and signature (this browser only). */
export function lastSection(): SectionKey {
    try {
        const saved = localStorage.getItem(LAST_SECTION_KEY) as SectionKey | null;
        return saved && SECTION_KEYS.includes(saved) ? saved : 'name';
    } catch {
        return 'name';
    }
}

export function rememberSection(section: SectionKey): void {
    try { localStorage.setItem(LAST_SECTION_KEY, section); } catch { /* a private window: fine */ }
}
