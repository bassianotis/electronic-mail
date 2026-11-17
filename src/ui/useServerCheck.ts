import { useCallback, useRef, useState } from 'react';

/**
 * A server check the fields stay editable through (board C1-field, "Checking"; owner, 2026-11-13).
 * The button says "Checking…" (rule A6) while it runs; a change to the fields meanwhile makes its
 * answer stale: the screen drops it (no "Saved", no problem shown, nothing closes) and the button is
 * back at once, to be pressed again for what's there now.
 *   const token = check.begin(); … await the server …; if (!check.current(token)) return; …; check.end(token)
 * Call `changed()` from every field's onChange (and from anything else that changes what's checked).
 */
export function useServerCheck() {
    const [checking, setChecking] = useState(false);
    // The check under way: a change, or a newer check, retires it
    const run = useRef(0);
    const begin = useCallback(() => {
        setChecking(true);
        return ++run.current;
    }, []);
    /** Its answer is still about what's in the fields */
    const current = useCallback((token: number) => run.current === token, []);
    const end = useCallback((token: number) => { if (run.current === token) setChecking(false); }, []);
    const changed = useCallback(() => {
        run.current++;
        setChecking(false);
    }, []);
    return { checking, begin, current, end, changed };
}
