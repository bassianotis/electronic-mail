/**
 * Bucket for organizing emails
 */
export interface Bucket {
    /** Unique bucket identifier (lowercase, sanitized from label) */
    id: string;
    /** Display label */
    label: string;
    /** Number of emails in bucket */
    count: number;
    /** Order in bucket list */
    sortOrder?: number;
    /** Hex color for bucket display */
    color: string;
    /** Whether to show alert indicator */
    alert?: boolean;
}

/**
 * Bucket as returned from API
 */
export interface ApiBucketResponse {
    id: string;
    label: string;
    count: number;
    sort_order?: number;
    color: string;
}
