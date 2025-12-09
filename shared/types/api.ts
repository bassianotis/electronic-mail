/**
 * Standard API response wrapper
 * Use this for consistent response shapes across all endpoints
 */
export interface ApiResponse<T> {
    data: T;
    error?: string;
    meta?: ApiMeta;
}

/**
 * Metadata for paginated or counted responses
 */
export interface ApiMeta {
    count?: number;
    total?: number;
    page?: number;
    pageSize?: number;
    nextCursor?: string;
}

/**
 * Error response shape
 */
export interface ApiError {
    error: string;
    code?: string;
    details?: Record<string, string>;
}
