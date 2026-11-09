// Recipient suggestions (Explore 2, section 8): a live query on the addresses already cached, across
// all accounts (they share one cache), for what's being typed into To, Cc or Bcc. Ranking: people
// on mail in your Sent folders first (people you've written to), then how often they appear, then
// how recently. Names come from mail they sent (the cache keeps no names for addresses you've only
// written to; that waits for a future cache rebuild).
import type { Store } from '../store/store.ts';

export interface Contact {
    name: string | null;
    address: string;
}

const LIMIT = 8;

/** A LIKE pattern matching text that starts with `prefix`. */
const startsWith = (prefix: string) => `${prefix.replace(/[\\%_]/g, c => `\\${c}`)}%`;

export function suggestContacts(store: Store, query: string, exclude: string[] = []): Contact[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const prefix = startsWith(q);
    // A name matches at the start of any word ("da" finds "Dana Whitfield" and "Ali Davis").
    const word = `% ${prefix}`;
    // One pass over the cached addresses for the matches and their counts; names are looked up only
    // for the few kept (on the live cache: 50–190ms on a laptop, the single-letter case slowest).
    const rows = store.db.prepare(`
        WITH named AS (
            SELECT DISTINCT from_addr AS address FROM message
            WHERE from_addr IS NOT NULL AND (lower(from_name) LIKE :prefix ESCAPE '\\' OR lower(from_name) LIKE :word ESCAPE '\\')
        ),
        top AS (
            SELECT j.value AS address, COUNT(*) AS seen, MAX(m.date) AS last,
                SUM(EXISTS (SELECT 1 FROM placement p JOIN folder f ON f.account = p.account AND f.path = p.folder
                            WHERE p.account = m.account AND p.msg_key = m.msg_key AND f.role = 'sent')) AS sent
            FROM message m, json_each(m.addresses) j
            WHERE j.value LIKE :prefix ESCAPE '\\' OR j.value IN (SELECT address FROM named)
            GROUP BY j.value
            ORDER BY sent > 0 DESC, seen DESC, last DESC
            LIMIT :limit
        )
        SELECT address, (SELECT n.from_name FROM message n WHERE n.from_addr = top.address AND n.from_name IS NOT NULL AND n.from_name != ''
                         ORDER BY n.date DESC LIMIT 1) AS name
        FROM top ORDER BY sent > 0 DESC, seen DESC, last DESC`).all({ prefix, word, limit: LIMIT + exclude.length }) as { address: string; name: string | null }[];
    const mine = new Set(exclude.map(a => a.toLowerCase()));
    return rows.filter(r => !mine.has(r.address)).slice(0, LIMIT).map(r => ({ name: r.name, address: r.address }));
}
