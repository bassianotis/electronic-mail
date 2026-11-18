import React, { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Search, Settings, PenSquare, TriangleAlert } from 'lucide-react';
import { Button, IconButton } from '../../ui/Button';
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
            padding: '0 var(--space-6)',
            borderBottom: '1px solid transparent',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', justifySelf: 'start' }}>
                {/* Logo / Brand - Home Link */}
                <button
                    id="inbox-target"
                    onClick={() => onNavigate('inbox')}
                    style={{
                        fontWeight: 'var(--weight-medium)',
                        fontSize: 'var(--size-wordmark)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        // 40, a field's height, as Search beside it (board P5-buttons-sorted, row 4)
                        height: 'var(--field)',
                        padding: '0 var(--space-3)',
                        borderRadius: 'var(--radius-3)',
                        // As a drop target: the dock rows' fill and amber ring
                        backgroundColor: isHovered ? 'var(--fill-hover)' : 'transparent',
                        color: 'var(--text-1)',
                        boxShadow: isHovered ? 'inset 0 0 0 1px var(--action)' : 'none',
                        transition: 'background-color var(--dur-instant) var(--ease-in), box-shadow var(--dur-instant) var(--ease-in)',
                        width: 'fit-content'
                    }}
                >
                    Electronic Mail
                </button>

                {pill && (
                    // A quiet 28 button, no pill: the warning in amber, the words in text-1 (board P5-buttons-sorted, row 6)
                    <Button kind="quiet" size="sm" className="st-pill" title={pill.title} aria-label={pill.title}
                        icon={<TriangleAlert size={14} aria-hidden="true" style={{ color: 'var(--action)' }} />}
                        onClick={() => openSettings(pill.opens)}>
                        {pill.text}
                    </Button>
                )}

                {connectionNote && (
                    <span
                        style={{
                            fontSize: 'var(--size-caption)',
                            color: 'var(--action)',
                            backgroundColor: 'var(--action-tint)',
                            border: '1px solid color-mix(in srgb, var(--action) 30%, transparent)',
                            borderRadius: 'var(--radius-full)',
                            padding: '2px var(--space-3)',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {connectionNote}
                    </span>
                )}
            </div>

            {/* Search: a button that looks like a field (rule K1) */}
            <button
                type="button"
                onClick={onSearchClick}
                style={{
                    display: 'block',
                    width: '100%',
                    position: 'relative',
                    cursor: 'pointer',
                    padding: 0,
                    border: 0,
                    background: 'none',
                    color: 'inherit',
                    textAlign: 'left',
                    lineHeight: 'inherit',
                    borderRadius: 'var(--radius-2)'
                }}
            >
                <span style={{
                    position: 'absolute',
                    left: 'var(--space-4)',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-3)',
                    display: 'flex'
                }}>
                    <Search size={16} aria-hidden="true" />
                </span>
                <span
                    style={{
                        // 40, a field's height (board P5-buttons-sorted, row 4)
                        display: 'flex',
                        alignItems: 'center',
                        width: '100%',
                        height: 'var(--field)',
                        padding: '0 var(--space-3) 0 44px',
                        borderRadius: 'var(--radius-2)',
                        border: '1px solid var(--line-1)',
                        backgroundColor: 'var(--surface-1)',
                        fontSize: 'var(--size-body)',
                        color: 'var(--text-3)',
                        transition: 'background-color var(--dur-instant) var(--ease-in), border-color var(--dur-instant) var(--ease-in)'
                    }}
                >
                    Search
                </span>
            </button>

            {/* Right Section: Compose + Settings */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                justifySelf: 'end'
            }}>
                {/* Compose: the shared secondary Button with its amber icon (the frame's primary action) */}
                {onComposeClick && (
                    <Button icon={<PenSquare size={16} aria-hidden="true" style={{ color: 'var(--action)' }} />} onClick={onComposeClick}>
                        Compose
                    </Button>
                )}

                <IconButton label="Settings" icon={<Settings size={16} aria-hidden="true" />}
                    onClick={() => openSettings({ section: lastSection(), accountId: activeAccountId })} />
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
