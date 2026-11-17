/**
 * Inline note (components.md, board C1-menu-tooltip-notice-note-band): inside the surface it's
 * about, always an icon and words, never colour alone. Three tones: neutral (Info, text-3),
 * warning (an amber tint, TriangleAlert) and problem (a danger tint, CircleAlert). A neutral note
 * can carry its own state icon (a success check, a spinner). `action`: a button at its right.
 */
import React from 'react';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';

export const Note: React.FC<{
    tone?: 'neutral' | 'warning' | 'problem';
    /** In place of the tone's own icon */
    icon?: React.ReactNode;
    action?: React.ReactNode;
    role?: 'status' | 'alert';
    style?: React.CSSProperties;
    children: React.ReactNode;
}> = ({ tone = 'neutral', icon, action, role, style, children }) => {
    const Icon = tone === 'warning' ? TriangleAlert : tone === 'problem' ? CircleAlert : Info;
    return (
        <div className={`ba-note ba-note--${tone}`} role={role} style={style}>
            <span className="ba-note__icon">{icon ?? <Icon size={16} aria-hidden="true" />}</span>
            <span className="ba-note__words">{children}</span>
            {action && <span className="ba-note__action">{action}</span>}
        </div>
    );
};
