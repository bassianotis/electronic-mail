import type { FolderRole } from '../types.ts';

export interface Namespace {
    prefix: string;
    delimiter: string;
}

const BY_SPECIAL_USE: Record<string, FolderRole> = {
    '\\Sent': 'sent',
    '\\Drafts': 'drafts',
    '\\Archive': 'archive',
    '\\Junk': 'junk',
    '\\Trash': 'trash',
};

/** The folder that holds bucket folders: "Buckets", or "INBOX.Buckets" on servers that put every folder under INBOX. */
export function bucketsRoot(ns: Namespace): string {
    return `${ns.prefix}Buckets`;
}

/** A bucket's name becomes one folder name: no hierarchy delimiter, no leading or trailing space. */
export function bucketFolderName(label: string, delimiter: string): string {
    const clean = label.split(delimiter).join('-').replace(/[\\/]/g, '-').trim();
    if (!clean) throw new Error(`bucket label "${label}" is empty after cleaning`);
    return clean;
}

export function bucketPath(ns: Namespace, name: string): string {
    return `${bucketsRoot(ns)}${ns.delimiter}${name}`;
}

/**
 * `specialUse` is imapflow's value: the server's SPECIAL-USE flag when advertised,
 * otherwise inferred from well-known names ("Sent", "Archive", ...), as other clients do.
 */
export function folderRole(path: string, specialUse: string | undefined, ns: Namespace): FolderRole {
    if (path.toUpperCase() === 'INBOX' || specialUse === '\\Inbox') return 'inbox';
    if (path.startsWith(bucketsRoot(ns) + ns.delimiter)) return 'bucket';
    return (specialUse && BY_SPECIAL_USE[specialUse]) || 'other';
}

/** "INBOX.Buckets.Reads" -> "Reads"; null for folders that are not buckets. */
export function bucketNameOf(path: string): string | null {
    const m = /Buckets(.)(.+)$/.exec(path);
    return m ? m[2] : null;
}
