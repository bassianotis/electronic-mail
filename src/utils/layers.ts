/**
 * Layers (design system v2, rules L2–L5, K7): what Esc closes, how a modal keeps the keyboard
 * inside it, and where focus goes when something leaves a list.
 *
 * - Esc closes the topmost layer, and only that (L4). Each open layer registers here with its
 *   named layer; one listener picks the top one. A field or menu that handles Esc itself calls
 *   preventDefault, and then nothing else closes.
 * - A modal (L3): focus moves in; Tab stays inside (and on the notices); the page behind is inert;
 *   on closing, focus goes back to whatever opened it.
 * - The layer names are the tokens' ten (page … tooltip); Z gives each use its layer's token
 *   (--layer-*, styles/tokens.css), so code names the layer and never a number.
 */
import { useEffect, useRef, type RefObject } from 'react';

export type LayerName = 'page' | 'chrome' | 'view' | 'panel' | 'dialog' | 'popover' | 'drag' | 'notice' | 'critical' | 'tooltip';
const ORDER: readonly LayerName[] = ['page', 'chrome', 'view', 'panel', 'dialog', 'popover', 'drag', 'notice', 'critical', 'tooltip'];

/**
 * Every app-level z-index, by its named layer (rule L2): each is its layer's token. Within a layer,
 * the page's order decides (the bucket dialog's scrim comes before the dialog). CSS files use the
 * tokens directly: .server-banner (chrome), trials.css (panel), ui.css (the dialog, the tooltip and
 * the notices), apps-menu.css (popover), .signed-out-scrim (critical).
 */
const layer = (name: LayerName) => `var(--layer-${name})`;
export const Z = {
    chrome: { rail: layer('chrome'), dock: layer('chrome') },
    view: { thread: layer('view'), search: layer('view') },
    panel: { corner: layer('panel'), playground: layer('panel') },
    dialog: { newMessage: layer('dialog'), tour: layer('dialog') },
    popover: { dockMenu: layer('popover') },
    drag: { card: layer('drag') },
    critical: { sessionEnded: layer('critical') },
} as const;

// ---- Esc (L4)

interface EscEntry { rank: number; seq: number; run: () => void; within?: () => HTMLElement | null }
const escEntries = new Set<EscEntry>();
let escSeq = 0;

/** Esc for whatever is on top (a frame's forwarded Esc arrives here too: MailFrame dispatches it). */
function onEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const active = document.activeElement;
    let top: EscEntry | null = null;
    for (const entry of escEntries) {
        // A non-modal panel (the corner window) hears Esc only while the focus is in it
        if (entry.within && !entry.within()?.contains(active)) continue;
        if (!top || entry.rank > top.rank || (entry.rank === top.rank && entry.seq > top.seq)) top = entry;
    }
    if (!top) return;
    e.preventDefault();
    top.run();
}
if (typeof window !== 'undefined') window.addEventListener('keydown', onEscape);

/**
 * While `open`, Esc runs `onEsc` when this is the topmost open layer. `step` orders layers that
 * share a name (a reply docked in a thread is a step above the thread). `within`: only while the
 * focus is inside that element (a panel that isn't modal).
 */
export function useEscape(open: boolean, layer: LayerName, onEsc: () => void, opts: { step?: number; within?: RefObject<HTMLElement | null> } = {}) {
    const run = useRef(onEsc);
    useEffect(() => { run.current = onEsc; });
    const { step = 0, within } = opts;
    useEffect(() => {
        if (!open) return;
        const entry: EscEntry = { rank: ORDER.indexOf(layer) * 10 + step, seq: ++escSeq, run: () => run.current(), within: within ? () => within.current : undefined };
        escEntries.add(entry);
        return () => { escEntries.delete(entry); };
    }, [open, layer, step, within]);
}

// ---- Focus

const TABBABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, iframe, [tabindex], [contenteditable="true"]';

/** What Tab can reach inside `root`, in order. */
export function tabbables(root: Element): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(el =>
        el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest('[inert]') && el.getClientRects().length > 0
        && getComputedStyle(el).visibility !== 'hidden');
}

// The last few things that had the focus, newest first: a modal's opener is the newest one outside it
// (a field inside it may already have taken the focus by the time it knows it's open).
// A click on nothing in particular leaves the focus on the page itself: then there's no opener.
let focusHistory: HTMLElement[] = [];
const remember = (el: HTMLElement) => { focusHistory = [el, ...focusHistory.filter(x => x !== el)].slice(0, 8); };
if (typeof document !== 'undefined') {
    document.addEventListener('focusin', e => remember(e.target as HTMLElement), true);
    document.addEventListener('focusout', e => { if (!e.relatedTarget) remember(document.body); }, true);
}
function openerOf(root: Element): HTMLElement | null {
    for (const el of focusHistory) {
        if (el === document.body) return null;
        if (el.isConnected && !root.contains(el)) return el;
    }
    return null;
}

/** Makes everything inert except `keep` (and what holds them); returns how to undo just that. */
function inertOthers(keep: Element[]): () => void {
    const holders = new Set<Element>();
    for (const k of keep) for (let n: Element | null = k; n && n !== document.body; n = n.parentElement) holders.add(n);
    const changed: Element[] = [];
    const walk = (parent: Element) => {
        for (const child of Array.from(parent.children)) {
            if (keep.includes(child)) continue;
            if (holders.has(child)) { walk(child); continue; }
            if (child.hasAttribute('inert') || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
            child.setAttribute('inert', '');
            changed.push(child);
        }
    };
    walk(document.body);
    return () => changed.forEach(el => el.removeAttribute('inert'));
}

// Open modals, oldest first: only the newest keeps Tab
const modals: Element[] = [];

/** Notices stay usable over any modal (their Undo is a real button); a view also keeps the panels
 * (the corner window works while a thread is open) and the server band. */
export const KEEP_OVER_DIALOG = '[data-layer="notice"], [data-layer="critical"]';
export const KEEP_OVER_VIEW = `${KEEP_OVER_DIALOG}, [data-layer="panel"], .server-banner`;

/**
 * L3 for `ref` while `open`: focus moves in (to `initial`, else the first thing Tab reaches, else the
 * layer itself), Tab cycles inside it and the notices, everything else is inert, and on closing
 * focus returns to the opener (or `fallback` when the opener has gone).
 */
export function useModal(ref: RefObject<HTMLElement | null>, open: boolean, opts: { keep?: string; initial?: () => HTMLElement | null | undefined; fallback?: () => HTMLElement | null | undefined } = {}) {
    const options = useRef(opts);
    useEffect(() => { options.current = opts; });
    useEffect(() => {
        const root = ref.current;
        if (!open || !root) return;
        const { keep = KEEP_OVER_DIALOG } = options.current;
        const opener = openerOf(root);
        if (!root.contains(document.activeElement)) {
            const first = options.current.initial?.() ?? tabbables(root)[0] ?? root;
            if (first === root && root.tabIndex < 0 && !root.hasAttribute('tabindex')) root.tabIndex = -1;
            first.focus({ preventScroll: true });
        }
        const kept = () => [root, ...Array.from(document.querySelectorAll(keep))];
        const undoInert = inertOthers(kept());
        modals.push(root);
        // Tab and Shift+Tab wrap around: the layer's own stops, then the notices'
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Tab' || e.defaultPrevented || modals[modals.length - 1] !== root) return;
            const stops = kept().flatMap(tabbables);
            if (!stops.length) { e.preventDefault(); return; }
            const at = stops.indexOf(document.activeElement as HTMLElement);
            if (at === -1) {
                e.preventDefault();
                (e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
            } else if (!e.shiftKey && at === stops.length - 1) {
                e.preventDefault();
                stops[0].focus();
            } else if (e.shiftKey && at === 0) {
                e.preventDefault();
                stops[stops.length - 1].focus();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            modals.splice(modals.indexOf(root), 1);
            undoInert();
            // Back to the opener, unless the focus has already gone somewhere on purpose
            const active = document.activeElement;
            if (active && active !== document.body && !root.contains(active)) return;
            const back = opener?.isConnected && !opener.closest('[inert]') ? opener : options.current.fallback?.();
            back?.focus({ preventScroll: true });
        };
    }, [open, ref]);
}

// ---- K7: after something leaves a list, focus goes to the next item (the previous at the end)

/** Call just before `item` leaves its list (`[data-thread-list]`): if the focus is in it, it moves
 * to the next item's link (`[data-thread-link]`), or the previous one at the end. */
export function focusNextBeforeLeaving(item: Element | null) {
    if (!item || !item.contains(document.activeElement)) return;
    const list = item.closest('[data-thread-list]') ?? document;
    const links = Array.from(list.querySelectorAll<HTMLElement>('[data-thread-link]')).filter(l => !l.closest('[inert]'));
    const mine = links.findIndex(l => item.contains(l));
    const rest = links.filter(l => !item.contains(l));
    const next = mine >= 0 ? rest[mine] ?? rest[mine - 1] : rest[0];
    // From the keyboard, the page scrolls to it if it has to; after a click it stays where it is
    next?.focus({ preventScroll: !document.activeElement?.matches(':focus-visible') });
}

// ---- Menus (WAI-ARIA menu button): arrows move, Home / End, Tab leaves, Esc closes (via useEscape)

/** Arrow keys between a menu's items; the first (or the checked) item takes the focus on opening. */
export function useMenuKeys(ref: RefObject<HTMLElement | null>, open: boolean, onTab: (e: KeyboardEvent) => void) {
    const tab = useRef(onTab);
    useEffect(() => { tab.current = onTab; });
    useEffect(() => {
        const menu = ref.current;
        if (!open || !menu) return;
        const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')).filter(el => !(el as HTMLButtonElement).disabled);
        const list = items();
        (list.find(el => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
        const onKey = (e: KeyboardEvent) => {
            const all = items();
            const at = all.indexOf(document.activeElement as HTMLElement);
            let to: number | null = null;
            if (e.key === 'ArrowDown') to = (at + 1) % all.length;
            else if (e.key === 'ArrowUp') to = (at - 1 + all.length) % all.length;
            else if (e.key === 'Home') to = 0;
            else if (e.key === 'End') to = all.length - 1;
            else if (e.key === 'Tab') { tab.current(e); return; }
            if (to === null) return;
            e.preventDefault();
            e.stopPropagation(); // not the thread's own arrow keys
            all[to]?.focus();
        };
        menu.addEventListener('keydown', onKey);
        return () => menu.removeEventListener('keydown', onKey);
    }, [open, ref]);
}
