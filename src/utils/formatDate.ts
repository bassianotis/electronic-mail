/**
 * The one date style for the screens, in the reader's locale: "Oct 29", with the year only when it
 * isn't this year ("Oct 29, 2025"). Never seconds. Mail that goes out (reply and forward headers)
 * has its own format in compose.ts.
 */
function options(date: Date): Intl.DateTimeFormatOptions {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return opts;
}

/** "Oct 24" */
export function formatDate(date: Date): string {
    return date.toLocaleString(undefined, options(date));
}

/**
 * The one rule for every list (Inbox, Up next, bucket pages, Archive, Search): today's mail shows the
 * time ("9:40 AM"), earlier this year the date ("Oct 10"), earlier years add the year ("Oct 10, 2025").
 */
export function formatListDate(date: Date, now = new Date()): string {
    if (date.toDateString() === now.toDateString()) return date.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
    return formatDate(date);
}

/** "Thursday, October 29, 2026 at 9:12 AM" (a message's details) */
export function formatFullDateTime(date: Date): string {
    return date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
}

/** "Oct 29, 9:12 AM" */
export function formatDateTime(date: Date): string {
    return date.toLocaleString(undefined, { ...options(date), hour: 'numeric', minute: '2-digit' });
}

/** "just now", "2 min ago", "3 hr ago", "4 days ago" (how long since the last sync) */
export function formatTimeAgo(date: Date, now: Date): string {
    const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}
