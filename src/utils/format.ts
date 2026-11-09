/** Counts and totals, in the reader's locale, with thousands separators ("18,852"). */
export const formatCount = (n: number) => n.toLocaleString();

/** The one file size format for the app: "820 KB", "2.4 MB". */
export function formatSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
