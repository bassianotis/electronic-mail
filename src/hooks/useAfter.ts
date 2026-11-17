import { useEffect, useState } from 'react';

/** Skeletons wait this long: a fast answer never flashes one (rules N3 and T7: nothing for 300ms). */
export const SKELETON_DELAY_MS = 300;

/** True once `ms` have passed since the component mounted. */
export function useAfter(ms = SKELETON_DELAY_MS): boolean {
    const [passed, setPassed] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setPassed(true), ms);
        return () => clearTimeout(timer);
    }, [ms]);
    return passed;
}
