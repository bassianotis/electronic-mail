/**
 * Sender rule: new mail from this sender (or @domain) goes straight to a bucket.
 */
export interface Rule {
    id: string;
    /** An address, or @domain for everyone at that domain */
    senderPattern: string;
    /** The bucket's id (its folder) */
    bucketId: string;
    /** When the rule was created */
    createdAt: string;
}
