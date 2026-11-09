import React, { useEffect, useState } from 'react';
import { Search, Settings, PenSquare } from 'lucide-react';
import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { useConnection } from '../../api/events';
import { SettingsModal } from '../Rules/SettingsModal';
import { useTheme } from '../../utils/theme';

interface TopNavbarProps {
    onSearchClick: () => void;
    onNavigate: (view: string) => void;
    onComposeClick?: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({ onSearchClick, onNavigate, onComposeClick }) => {
    const { hoveredBucketId, landed } = useDragDrop();
    const dark = useTheme() === 'dark';
    // A card landing on the app name ("New" drag) flashes it
    const [flashing, setFlashing] = useState(false);
    useEffect(() => {
        if (landed?.target !== 'inbox') return;
        setFlashing(true); // eslint-disable-line react-hooks/set-state-in-effect -- a timed flash
        const t = setTimeout(() => setFlashing(false), 450);
        return () => clearTimeout(t);
    }, [landed]);
    const { activeAccountId, activeAccount } = useMail();
    const connection = useConnection(activeAccountId) ?? activeAccount?.state;
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    // Shown only when something is wrong: mail on screen may be out of date until it reconnects.
    const connectionNote = connection === 'offline' ? 'Offline: showing saved mail'
        : connection === 'auth-failed' ? 'Password rejected: update it in Settings'
        : null;
    const isHovered = hoveredBucketId === 'inbox';

    return (
        <header style={{
            height: '64px',
            display: 'grid',
            gridTemplateColumns: '1fr minmax(auto, 480px) 1fr',
            alignItems: 'center',
            padding: '0 var(--space-lg)',
            borderBottom: '1px solid transparent',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', justifySelf: 'start' }}>
                {/* Logo / Brand - Home Link */}
                <button
                    id="inbox-target"
                    onClick={() => onNavigate('inbox')}
                    style={{
                        fontWeight: 'var(--weight-bold)',
                        fontSize: 'var(--size-app-name)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-md)',
                        // As a drop target: green and growing in light; in dark, the dock rows' fill and amber ring
                        ...(dark ? {
                            backgroundColor: flashing ? 'color-mix(in srgb, var(--color-action) 16%, transparent)' : isHovered ? 'var(--color-bg-hover)' : 'transparent',
                            color: 'var(--color-text-main)',
                            boxShadow: isHovered || flashing ? 'inset 0 0 0 1px var(--color-action)' : 'none',
                            transition: 'background-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)',
                        } : {
                            backgroundColor: isHovered ? 'var(--color-accent-primary)' : 'transparent',
                            color: isHovered ? 'var(--color-on-accent)' : 'var(--color-text-main)',
                            transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                            transition: 'background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)',
                            boxShadow: isHovered ? 'var(--shadow-lift)' : 'none',
                        }),
                        width: 'fit-content'
                    }}
                >
                    Electronic Mail
                </button>

                {connectionNote && (
                    <span
                        title={activeAccount?.error ?? undefined}
                        style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--note-warn-text)',
                            backgroundColor: 'var(--note-warn-bg)',
                            border: '1px solid var(--note-warn-border)',
                            borderRadius: 'var(--radius-full)',
                            padding: '2px 12px',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {connectionNote}
                    </span>
                )}
            </div>

            {/* Search Bar */}
            <div
                onClick={onSearchClick}
                style={{
                    width: '100%',
                    position: 'relative',
                    cursor: 'pointer'
                }}
            >
                <div style={{
                    position: 'absolute',
                    left: 'var(--space-md)',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--color-text-muted)',
                    display: 'flex'
                }}>
                    <Search size={16} />
                </div>
                <div
                    style={{
                        width: '100%',
                        padding: '8px 12px 8px 44px',
                        borderRadius: 'var(--radius-pill)',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-bg-subtle)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-muted)',
                        transition: 'background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)'
                    }}
                >
                    Search
                </div>
            </div>

            {/* Right Section: Compose + Settings */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm)',
                justifySelf: 'end'
            }}>
                {/* Compose Button */}
                {onComposeClick && (
                    <button
                        onClick={onComposeClick}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-pill)',
                            backgroundColor: 'var(--compose-bg)',
                            border: 'var(--compose-border)',
                            color: 'var(--compose-text)',
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 'var(--weight-semibold)',
                            cursor: 'pointer',
                            transition: 'background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)'
                        }}
                        // A colour change on hover, no lift
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--compose-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--compose-bg)'; }}
                    >
                        <PenSquare size={16} style={{ color: 'var(--compose-icon)' }} />
                        Compose
                    </button>
                )}

                {/* Settings Button */}
                <button
                    aria-label="Settings"
                    onClick={() => setIsSettingsModalOpen(true)}
                    style={{
                        padding: 'var(--space-sm)',
                        color: 'var(--color-text-muted)',
                        borderRadius: 'var(--radius-full)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Settings size={16} />
                </button>
            </div>

            <SettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
            />
        </header>
    );
};
