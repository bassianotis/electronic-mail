/**
 * A conversation as a tree, for the thread panel (docs/design/reading-navigation-spec.md §2): each
 * message under the one it answers (its parentKey, from In-Reply-To / References); a message whose
 * parent isn't in the conversation is a top-level row. Siblings keep time order. Rows deeper than
 * MAX_DEPTH stay at that depth.
 */
export const MAX_DEPTH = 5;

export interface TreeMessage {
    msgKey: string;
    parentKey?: string | null;
}

export interface TreeRow<T extends TreeMessage> {
    message: T;
    /** Indent level, 0 for a top-level row (at most MAX_DEPTH). */
    depth: number;
    /** The last of its siblings (its guide line stops at its tick). */
    last: boolean;
    /**
     * For each ancestor, by its level (index 0 = the top-level one): whether it has a later sibling
     * below, so a guide line runs through this row at that level. Top-level rows have no guide
     * line, so index 0 is never drawn.
     */
    rails: boolean[];
}

/** Rows in tree order. `messages` is in time order, oldest first. */
export function threadTree<T extends TreeMessage>(messages: T[]): TreeRow<T>[] {
    const here = new Set(messages.map(m => m.msgKey));
    const children = new Map<string | null, T[]>();
    for (const m of messages) {
        const parent = m.parentKey && m.parentKey !== m.msgKey && here.has(m.parentKey) ? m.parentKey : null;
        const list = children.get(parent) ?? [];
        list.push(m);
        children.set(parent, list);
    }
    const rows: TreeRow<T>[] = [];
    const seen = new Set<string>();
    const walk = (parent: string | null, depth: number, rails: boolean[]) => {
        const kids = (children.get(parent) ?? []).filter(m => !seen.has(m.msgKey));
        kids.forEach((m, i) => {
            seen.add(m.msgKey);
            const last = i === kids.length - 1;
            const shown = Math.min(depth, MAX_DEPTH);
            rows.push({ message: m, depth: shown, last, rails: rails.slice(0, shown) });
            walk(m.msgKey, depth + 1, depth < MAX_DEPTH ? [...rails, !last] : rails);
        });
    };
    walk(null, 0, []);
    // A loop of parents (never in real mail, but a cache can be wrong): what's left is top-level
    for (const m of messages) if (!seen.has(m.msgKey)) { seen.add(m.msgKey); rows.push({ message: m, depth: 0, last: true, rails: [] }); }
    return rows;
}
