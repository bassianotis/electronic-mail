/**
 * "Can't reach the server" (the app's own server, not the mail servers): a 40px band across the
 * top, right of the rail, shown after about 10 seconds of failure (api/reachability.ts). It pushes
 * the top bar down rather than covering it; the page column and the overlays read --server-banner.
 * When the server answers again, the band goes and "Connected again" shows (a notice, 4 seconds) (only if
 * the band had shown).
 */
import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { reachability, useReachability } from '../api/reachability';
import { useMail } from '../context/MailContext';
import { RAIL_WIDTH } from './Layout/AccountRail';
import { Band } from '../ui/Band';
import { Button } from '../ui/Button';

export const SERVER_BANNER_HEIGHT = 40;

const countdown = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const ServerBanner: React.FC = () => {
    const { unreachable, nextTryAt } = useReachability();
    const { showToast } = useMail();
    const [now, setNow] = useState(() => Date.now());

    // The countdown ticks while the band shows
    useEffect(() => {
        if (!unreachable) return;
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, [unreachable]);

    // Everything below the band moves down by its height
    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty('--server-banner', unreachable ? `${SERVER_BANNER_HEIGHT}px` : '0px');
        if (unreachable) root.dataset.serverBanner = '';
        else delete root.dataset.serverBanner;
    }, [unreachable]);

    useEffect(() => reachability.onRecovered(afterBanner => {
        if (afterBanner) showToast({ message: 'Connected again' });
    }), [showToast]);

    if (!unreachable) return null;
    const left = nextTryAt === null ? 0 : nextTryAt - now;
    return (
        <Band className="server-banner" style={{ left: `${RAIL_WIDTH}px`, height: `${SERVER_BANNER_HEIGHT}px` }}
            icon={<WifiOff size={16} aria-hidden="true" />}
            what="Can't reach the server"
            state={nextTryAt === null || left <= 0 ? "Showing what's already open. Trying again…" : `Showing what's already open. Trying again in ${countdown(left)}`}
            action={<Button size="sm" onClick={() => reachability.tryNow()}>Try now</Button>} />
    );
};
