import React, { useState } from 'react';
import { Search, Settings, PenSquare } from 'lucide-react';
import { useDragDrop } from '../../context/DragDropContext';
import { SettingsModal } from '../Rules/SettingsModal';

interface TopNavbarProps {
    onSearchClick: () => void;
    onNavigate: (view: string) => void;
    onComposeClick?: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({ onSearchClick, onNavigate, onComposeClick }) => {
    const { hoveredBucketId } = useDragDrop();
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
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
            {/* Logo / Brand - Home Link */}
            <button
                id="inbox-target"
                onClick={() => onNavigate('inbox')}
                style={{
                    fontWeight: 700,
                    fontSize: 'var(--font-size-xl)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '8px 12px',
                    borderRadius: '12px',
                    backgroundColor: isHovered ? 'var(--color-accent-primary)' : 'transparent',
                    color: isHovered ? '#fff' : 'var(--color-text-main)',
                    transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                    transition: 'all 0.2s ease',
                    boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
                    width: 'fit-content',
                    justifySelf: 'start'
                }}
            >
                Electronic Mail
            </button>

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
                    <Search size={18} />
                </div>
                <div
                    style={{
                        width: '100%',
                        padding: '10px 12px 10px 44px',
                        borderRadius: 'var(--radius-full)',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-bg-subtle)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-muted)',
                        transition: 'all 0.2s ease'
                    }}
                >
                    Search...
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
                            gap: '6px',
                            padding: '8px 14px',
                            borderRadius: 'var(--radius-full)',
                            backgroundColor: 'var(--color-accent-secondary)',
                            border: 'none',
                            color: '#fff',
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-1px)';
                            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    >
                        <PenSquare size={16} />
                        Compose
                    </button>
                )}

                {/* Settings Button */}
                <button
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
                    <Settings size={20} />
                </button>
            </div>

            <SettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
            />
        </header>
    );
};
