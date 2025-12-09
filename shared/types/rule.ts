/**
 * Auto-bucketing rule
 */
export interface Rule {
    id: string;
    /** Email address pattern to match (exact match currently) */
    senderPattern: string;
    /** Bucket to assign matching emails to */
    bucketId: string;
    /** When the rule was created */
    createdAt: string;
}

/**
 * Rule as returned from API
 */
export interface ApiRuleResponse {
    id: string;
    sender_pattern: string;
    bucket_id: string;
    created_at: string;
}
