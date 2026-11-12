import React, { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Search, Settings, PenSquare, ChevronRight } from 'lucide-react';
import { useDragDrop } from '../../context/DragDropContext';
import { useMail } from '../../context/MailContext';
import { useConnection, useStatuses } from '../../api/events';
import { SettingsDialog } from '../Settings/SettingsDialog';
import { clockTime, lastSection, type SettingsTarget } from '../Settings/useSettings';
import { tabLabel } from '../../utils/accountLabel';
import '../Settings/settings.css';

interface TopNavbarProps {
    onSearchClick: () => void;
    onNavigate: (view: string) => void;
    onComposeClick?: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({ onSearchClick, onNavigate, onComposeClick }) => {
    const { hoveredBucketId } = useDragDrop();
    const { activeAccountId, activeAccount, accounts } = useMail();
    const connection = useConnection(activeAccountId) ?? activeAccount?.state;
    // Settings: where it opens (the gear: the last section used; the pill: that account's password)
    const [settings, setSettings] = useState<(SettingsTarget & { n: number }) | null>(null);
    const openSettings = (at: SettingsTarget) => setSettings(prev => ({ ...at, n: (prev?.n ?? 0) + 1 }));
    // A rejected password is one pill for every account, and a button (settings-spec.md §9)
    const statuses = useStatuses(accounts);
    const rejected = accounts.filter(a => statuses.get(a.id)?.state === 'auth-failed');
    const pill = passwordPill(rejected, activeAccountId, accounts, statuses);
    // Otherwise shown only when something is wrong: mail on screen may be out of date until it reconnects.
    const connectionNote = !pill && connection === 'offline' ? 'Offline: showing saved mail' : null;
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
                        // As a drop target: the dock rows' fill and amber ring
                        backgroundColor: isHovered ? 'var(--color-bg-hover)' : 'transparent',
                        color: 'var(--color-text-main)',
                        boxShadow: isHovered ? 'inset 0 0 0 1px var(--color-action)' : 'none',
                        transition: 'background-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)',
                        width: 'fit-content'
                    }}
                >
                    Electronic Mail
                </button>

                {pill && (
                    <button type="button" className="st-pill" title={pill.title} aria-label={pill.title}
                        onClick={() => openSettings(pill.opens)}>
                        {pill.text}
                        <ChevronRight size={12} aria-hidden="true" />
                    </button>
                )}

                {connectionNote && (
                    <span
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
                    onClick={() => openSettings({ section: lastSection(), accountId: activeAccountId })}
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

            <AnimatePresence>
                {settings && <SettingsDialog key={settings.n} at={settings} onClose={() => setSettings(null)} />}
            </AnimatePresence>
        </header>
    );
};

type Named = { id: string; email: string; tabName: string | null };

/**
 * The pill's words, its name and where it opens: "Password rejected · Update" for the open account,
 * "Work: password rejected · Update" for another, "2 accounts: password rejected · Update" (Accounts).
 */
function passwordPill(rejected: Named[], openId: string | null, all: Named[], statuses: Map<string, { rejectedAt: string | null }>): { text: string; title: string; opens: SettingsTarget } | null {
    if (!rejected.length) return null;
    if (rejected.length > 1) {
        const names = rejected.map(a => tabLabel(a, all));
        return {
            text: `${rejected.length} accounts: password rejected · Update`,
            title: `The mail server rejected the passwords for ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`,
            opens: { section: 'accounts' },
        };
    }
    const [account] = rejected;
    const name = tabLabel(account, all);
    const at = clockTime(statuses.get(account.id)?.rejectedAt ?? null);
    return {
        text: account.id === openId ? 'Password rejected · Update' : `${name}: password rejected · Update`,
        title: `The mail server rejected ${name}\u2019s password${at ? ` at ${at}` : ''}`,
        opens: { section: 'password', accountId: account.id },
    };
}
