/**
 * Where a dragged card is over: the Archive tile, the wordmark (Inbox) or a bucket's dock tile,
 * found the way the Inbox and bucket cards find them (by their element ids).
 */
const inside = (id: string, p: { x: number; y: number }) => {
    const r = document.getElementById(id)?.getBoundingClientRect();
    return !!r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
};

/**
 * Whether a point is inside the dock's scrolling bucket strip (the dark theme's slim bar), so a bucket
 * scrolled out of sight isn't a drop target. Without a strip (the tile dock), every point is.
 */
export function inDockStrip(point: { x: number; y: number }): boolean {
    return !document.getElementById('bucket-strip') || inside('bucket-strip', point);
}

export function dropTargetAt(point: { x: number; y: number }, bucketIds: string[], withInbox: boolean): string | null {
    if (inside('archive-target', point)) return 'archive';
    if (withInbox && inside('inbox-target', point)) return 'inbox';
    if (!inDockStrip(point)) return null;
    return bucketIds.find(id => inside(`bucket-target-${id}`, point)) ?? null;
}
