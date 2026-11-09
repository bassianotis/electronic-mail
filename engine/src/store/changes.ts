/**
 * What a sync or task changed, so threads can be updated incrementally instead of rebuilt
 * from scratch (a full rebuild is ~0.6 s per account on a Mac and several seconds on the Pi).
 */
export class ChangeSet {
    /** Message rows created by this change (they still need linking into threads). */
    readonly inserted = new Set<string>();
    /** Message keys whose placements (folder, flags) changed or disappeared. */
    readonly touched = new Set<string>();
    /** Thread ids to re-summarize regardless (e.g. their messages were pruned). */
    readonly threads = new Set<string>();
    /**
     * Messages that newly arrived in the Inbox, seen by an incremental Inbox sync (never by a
     * full listing). Sender rules act on exactly these, whichever job happened to sync them.
     */
    readonly arrivedInInbox = new Set<string>();

    get empty(): boolean {
        return this.inserted.size === 0 && this.touched.size === 0 && this.threads.size === 0;
    }

    merge(other: ChangeSet): this {
        for (const k of other.inserted) this.inserted.add(k);
        for (const k of other.touched) this.touched.add(k);
        for (const t of other.threads) this.threads.add(t);
        for (const k of other.arrivedInInbox) this.arrivedInInbox.add(k);
        return this;
    }
}
