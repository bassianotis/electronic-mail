/**
 * Parse a date string (YYYY-MM-DD) as a local date, not UTC
 * This prevents the common issue where "2025-11-26" is interpreted as
 * UTC midnight and becomes the previous day when converted to local time
 */
export const parseLocalDate = (dateString: string | undefined | null): Date | undefined => {
    if (!dateString) return undefined;

    // Split the date string to get year, month, day
    const parts = dateString.split('-');
    if (parts.length !== 3) return undefined;

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed in JavaScript
    const day = parseInt(parts[2], 10);

    // Create a Date object in local timezone (not UTC)
    return new Date(year, month, day);
};
