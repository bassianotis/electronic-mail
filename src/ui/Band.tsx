/**
 * Band (components.md, board C1-menu-tooltip-notice-note-band): app-wide state only (offline),
 * across the top, one at a time. What happened (500), the state things are in (text-3, tabular
 * for a countdown), and a small "Try now". A polite status.
 */
import React from 'react';

export const Band: React.FC<{
    icon: React.ReactNode;
    what: React.ReactNode;
    state?: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}> = ({ icon, what, state, action, className, style }) => (
    <div role="status" className={`ba-band${className ? ` ${className}` : ''}`} style={style}>
        <span className="ba-band__icon">{icon}</span>
        <span className="ba-band__what">{what}</span>
        {state && <span className="ba-band__state">{state}</span>}
        {action && <span className="ba-band__action">{action}</span>}
    </div>
);
