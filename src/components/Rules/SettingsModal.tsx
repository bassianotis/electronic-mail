import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, X, Trash2, Plus, Loader, Check, Download, Upload } from 'lucide-react';
import { useMail } from '../../context/MailContext';
import { BucketSelector } from './BucketSelector';
import { api, acct, errorText, urls } from '../../api/client';
import { useFamily } from '../../api/family';
import type { AccountSettings } from '../../api/types';
import { setDragStyle, setFont, setTheme, useDragStyle, useFont, useTheme, type DragStyle, type Font, type Theme } from '../../utils/theme';

/** Nested radius: controls sit 24px (or more) inside the dialog's corner, so inner = outer − padding
 * gives them the 4px minimum. */
const INNER_RADIUS = 'max(4px, calc(var(--radius-tile) - 24px))';

/** A tab name's longest length (the engine refuses longer: it is written down a narrow tab). */
const TAB_NAME_MAX = 12;

// The account's tab on the rail (Layout/AccountRail.tsx); saved when you leave the field
const TabNameField: React.FC = () => {
    const { activeAccount, fetchAccounts } = useMail();
    const saved = activeAccount?.tabName ?? '';
    const fallback = activeAccount?.email.split('@')[0] ?? '';
    const [value, setValue] = useState(saved);

    const save = async () => {
        if (!activeAccount || value.trim() === saved) return;
        try {
            await api.patch(acct(activeAccount.id), { tabName: value.trim() || null });
            await fetchAccounts();
        } catch (error) {
            alert('Error saving the tab name: ' + errorText(error));
        }
    };

    return (
        <div style={{ marginBottom: '24px' }}>
            <label htmlFor="account-tab-name" style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px' }}>
                Tab name
            </label>
            <input
                id="account-tab-name"
                type="text"
                value={value}
                maxLength={TAB_NAME_MAX}
                placeholder={fallback}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => void save()}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: INNER_RADIUS,
                    border: '1px solid var(--color-border)',
                    fontSize: 'var(--font-size-sm)',
                    backgroundColor: 'var(--color-bg-subtle)'
                }}
            />
            <p style={{ margin: '8px 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Shown on this account’s tab. Up to {TAB_NAME_MAX} characters.
            </p>
        </div>
    );
};

/** Appearance (the Instrument dark trial): theme, font and (in dark) drag, each remembered by this browser only. */
const AppearanceSection: React.FC = () => {
    const theme = useTheme();
    const font = useFont();
    const drag = useDragStyle();
    const choice = <T extends string>(label: string, value: T, options: [T, string][], set: (v: T) => void) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ width: '56px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{label}</span>
            <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: '8px', flex: 1, maxWidth: '280px' }}>
                {options.map(([v, text]) => (
                    <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={value === v}
                        onClick={() => set(v)}
                        style={{
                            flex: 1,
                            padding: '8px 12px',
                            borderRadius: INNER_RADIUS,
                            border: `1px solid ${value === v ? 'var(--selected-border)' : 'var(--border-strong)'}`,
                            backgroundColor: value === v ? 'var(--selected-bg)' : 'var(--color-bg-subtle)',
                            color: value === v ? 'var(--selected-text)' : 'var(--unselected-text)',
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 500,
                            cursor: 'pointer'
                        }}
                    >
                        {text}
                    </button>
                ))}
            </div>
        </div>
    );
    return (
        <div style={{ marginBottom: '32px', paddingBottom: '32px', borderBottom: '1px solid var(--color-border)' }}>
            <h3 style={{ margin: '0 0 4px 0', fontSize: 'var(--font-size-base)', fontWeight: 'var(--weight-semibold)' }}>Appearance</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                On this browser only
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {choice<Theme>('Theme', theme, [['light', 'Light'], ['dark', 'Dark']], setTheme)}
                {choice<Font>('Font', font, [['system', 'System'], ['inter', 'Inter']], setFont)}
                {theme === 'dark' && choice<DragStyle>('Drag', drag, [['current', 'Current'], ['new', 'New']], setDragStyle)}
            </div>
        </div>
    );
};

// The account's signature (Explore 2, section 6): plain text, added under everything written from
// it; saved when you leave the field
const SignatureField: React.FC = () => {
    const { activeAccount, fetchAccounts, showToast } = useMail();
    const saved = activeAccount?.signature ?? '';
    const [value, setValue] = useState(saved);

    const save = async () => {
        if (!activeAccount || value.trim() === saved.trim()) return;
        try {
            await api.patch(acct(activeAccount.id), { signature: value.trim() ? value : null });
            await fetchAccounts();
        } catch (error) {
            showToast({ message: `Couldn't save the signature: ${errorText(error)}`, tone: 'error' });
        }
    };

    return (
        <div>
            <label htmlFor="account-signature" style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px' }}>
                Signature
            </label>
            <textarea
                id="account-signature"
                value={value}
                rows={3}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => void save()}
                style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    borderRadius: INNER_RADIUS,
                    border: '1px solid var(--color-border)',
                    fontFamily: 'inherit',
                    fontSize: 'var(--font-size-sm)',
                    lineHeight: 1.5,
                    resize: 'vertical',
                    backgroundColor: 'var(--color-bg-subtle)'
                }}
            />
            <p style={{ margin: '8px 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Added under everything you write from {activeAccount?.email}. Leave it empty for none.
            </p>
        </div>
    );
};

// Name and Sending Section Component
const SyncConfigSection: React.FC = () => {
    const { activeAccountId, fetchAccounts } = useMail();
    const [displayName, setDisplayName] = useState('');

    // SMTP settings
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState('465');
    const [smtpSecure, setSmtpSecure] = useState(true);
    const [smtpUser, setSmtpUser] = useState('');
    const [smtpPassword, setSmtpPassword] = useState('');
    const [showSmtpPassword, setShowSmtpPassword] = useState(false);
    const [hadSmtp, setHadSmtp] = useState(false);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [error, setError] = useState('');

    // Fetch current settings on mount
    useEffect(() => {
        if (!activeAccountId) return;
        setIsLoading(true);
        api.get<{ settings: AccountSettings }>(`${acct(activeAccountId)}/settings`)
            .then(({ settings }) => {
                setDisplayName(settings.displayName || '');
                setHadSmtp(!!settings.smtp);
                if (settings.smtp) {
                    setSmtpHost(settings.smtp.host);
                    setSmtpPort(String(settings.smtp.port));
                    setSmtpSecure(settings.smtp.secure);
                    setSmtpUser(settings.smtp.user);
                }
                // The password is never sent back
            })
            .catch(err => setError('Could not load the settings: ' + errorText(err)))
            .finally(() => setIsLoading(false));
    }, [activeAccountId]);

    const handleSave = async () => {
        if (!activeAccountId) return;
        setIsSaving(true);
        setError('');
        setSaveSuccess(false);

        try {
            const body: Record<string, unknown> = { displayName: displayName.trim() || null };
            if (smtpHost.trim()) {
                // The new server is tried before anything is saved.
                body.smtp = {
                    host: smtpHost.trim(),
                    port: parseInt(smtpPort) || 465,
                    secure: smtpSecure,
                    user: smtpUser.trim(),
                    pass: smtpPassword || undefined
                };
            } else if (hadSmtp) {
                body.smtp = null;
            }
            await api.patch(acct(activeAccountId), body);
            setSmtpPassword('');
            setHadSmtp(!!smtpHost.trim());
            await fetchAccounts();
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-muted)' }}>
                    <Loader size={16} className="animate-spin" />
                    Loading
                </div>
            </div>
        );
    }

    return (
        <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid var(--color-border)' }}>
            <div style={{ marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 4px 0', fontSize: 'var(--font-size-base)', fontWeight: 'var(--weight-semibold)' }}>Name and sending</h3>
                <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                    Your name on sent mail, and the server mail is sent from
                </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                    <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px' }}>
                        Display name
                    </label>
                    <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your name (shown in sent emails)"
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: INNER_RADIUS,
                            border: '1px solid var(--color-border)',
                            fontSize: 'var(--font-size-sm)',
                            backgroundColor: 'var(--color-bg-subtle)'
                        }}
                    />
                </div>

                <SignatureField key={activeAccountId ?? ''} />

                {/* SMTP Configuration */}
                <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--color-border)' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--weight-semibold)' }}>Outgoing server (SMTP)</h4>
                    <p style={{ margin: '0 0 16px 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                        The outgoing mail server. It is tried before saving. Leave the password blank to keep the saved one.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 500, marginBottom: '4px' }}>
                                SMTP host
                            </label>
                            <input
                                type="text"
                                value={smtpHost}
                                onChange={(e) => setSmtpHost(e.target.value)}
                                placeholder="smtp.gmail.com"
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    borderRadius: INNER_RADIUS,
                                    border: '1px solid var(--color-border)',
                                    fontSize: 'var(--font-size-sm)',
                                    backgroundColor: 'var(--color-bg-subtle)'
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 500, marginBottom: '4px' }}>
                                Port
                            </label>
                            <input
                                type="number"
                                value={smtpPort}
                                onChange={(e) => setSmtpPort(e.target.value)}
                                placeholder="587"
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    borderRadius: INNER_RADIUS,
                                    border: '1px solid var(--color-border)',
                                    fontSize: 'var(--font-size-sm)',
                                    backgroundColor: 'var(--color-bg-subtle)'
                                }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <input
                            type="checkbox"
                            id="smtpSecure"
                            checked={smtpSecure}
                            onChange={(e) => setSmtpSecure(e.target.checked)}
                            style={{
                                width: '16px',
                                height: '16px',
                                cursor: 'pointer'
                            }}
                        />
                        <label htmlFor="smtpSecure" style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500, cursor: 'pointer' }}>
                            Use SSL/TLS (port 465). Uncheck for STARTTLS (port 587).
                        </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 500, marginBottom: '4px' }}>
                                Username
                            </label>
                            <input
                                type="text"
                                value={smtpUser}
                                onChange={(e) => setSmtpUser(e.target.value)}
                                placeholder="usually your email address"
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    borderRadius: INNER_RADIUS,
                                    border: '1px solid var(--color-border)',
                                    fontSize: 'var(--font-size-sm)',
                                    backgroundColor: 'var(--color-bg-subtle)'
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 500, marginBottom: '4px' }}>
                                Password
                            </label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showSmtpPassword ? 'text' : 'password'}
                                    value={smtpPassword}
                                    onChange={(e) => setSmtpPassword(e.target.value)}
                                    placeholder={hadSmtp ? 'unchanged' : ''}
                                    style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        paddingRight: '40px',
                                        borderRadius: INNER_RADIUS,
                                        border: '1px solid var(--color-border)',
                                        fontSize: 'var(--font-size-sm)',
                                        backgroundColor: 'var(--color-bg-subtle)'
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                                    style={{
                                        position: 'absolute',
                                        right: '8px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: 'var(--font-size-xs)',
                                        color: 'var(--color-text-muted)'
                                    }}
                                >
                                    {showSmtpPassword ? 'Hide' : 'Show'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {error && (
                    <div style={{
                        padding: '8px',
                        backgroundColor: 'var(--error-bg)',
                        border: '1px solid var(--error-border)',
                        borderRadius: INNER_RADIUS,
                        color: 'var(--error-text)',
                        fontSize: 'var(--font-size-sm)'
                    }}>
                        {error}
                    </div>
                )}

                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    style={{
                        padding: '8px 16px',
                        borderRadius: INNER_RADIUS,
                        border: 'none',
                        backgroundColor: saveSuccess ? 'var(--color-success)' : 'var(--color-action)',
                        color: saveSuccess ? 'var(--color-on-success)' : 'var(--color-on-action)',
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 500,
                        cursor: isSaving ? 'wait' : 'pointer',
                        opacity: isSaving ? 0.7 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        alignSelf: 'flex-start'
                    }}
                >
                    {isSaving ? (
                        <>
                            <Loader size={16} className="animate-spin" />
                            Saving…
                        </>
                    ) : saveSuccess ? (
                        <>
                            <Check size={16} />
                            Saved!
                        </>
                    ) : (
                        'Save'
                    )}
                </button>
            </div>
        </div>
    );
};


interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const { rules, buckets, addRule, deleteRule, setIsAddingAccount, activeAccount, activeAccountId, fetchAccounts, download } = useMail();
    // With the shared Bassapps sign-in, signing out lives in one place: the apps menu
    const sharedSignIn = !!useFamily();

    // Escape closes it (unless something inside handled it first, like an open list)
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !e.defaultPrevented) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);
    const [isAddingRule, setIsAddingRule] = useState(false);
    const [newSender, setNewSender] = useState('');
    const [newBucketId, setNewBucketId] = useState('');


    const handleAddRule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newSender.trim() && newBucketId) {
            await addRule(newSender.trim(), newBucketId);
            setNewSender('');
            setNewBucketId('');
            setIsAddingRule(false);
        }
    };

    const getBucketLabel = (bucketId: string) => {
        const bucket = buckets.find(b => b.id === bucketId);
        return bucket ? bucket.label : 'Unknown Bucket';
    };

    const getBucketColor = (bucketId: string) => {
        const bucket = buckets.find(b => b.id === bucketId);
        return bucket ? bucket.color : 'var(--bucket-gray)';
    };

    const viewPreference = activeAccount?.inboxView || 'expand';

    const handlePreferenceChange = async (newPref: 'expand' | 'thread') => {
        if (!activeAccountId || viewPreference === newPref) return;
        try {
            await api.patch(acct(activeAccountId), { inboxView: newPref });
            await fetchAccounts();
        } catch (error) {
            alert('Error updating preference: ' + errorText(error));
        }
    };

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 200,
                    pointerEvents: 'none' // Allow clicks to pass through container to backdrop
                }}>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: 'var(--modal-scrim)',
                            backdropFilter: 'blur(var(--blur-modal))',
                            pointerEvents: 'auto' // Re-enable pointer events
                        }}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        style={{
                            position: 'relative', // Relative to flex container
                            backgroundColor: 'var(--surface-raised)',
                            borderRadius: 'var(--radius-tile)',
                            width: '90%',
                            maxWidth: '600px',
                            maxHeight: '80vh',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: 'var(--shadow-dialog)',
                            zIndex: 201,
                            border: '1px solid var(--border-strong)',
                            overflow: 'hidden',
                            pointerEvents: 'auto' // Re-enable pointer events
                        }}
                    >
                        {/* Header */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '20px 24px',
                            borderBottom: '1px solid var(--color-border)'
                        }}>
                            <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 'var(--weight-semibold)' }}>Settings</h2>
                            <button
                                type="button"
                                aria-label="Close settings"
                                onClick={onClose}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    color: 'var(--color-text-muted)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                            >
                                <X size={16} aria-hidden="true" />
                            </button>
                        </div>

                        {/* Content - Scrollable List */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

                            <AppearanceSection />

                            {/* Section: Email Rules */}
                            <div style={{ marginBottom: '0' }}>
                                <div style={{ marginBottom: '16px' }}>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: 'var(--font-size-base)', fontWeight: 'var(--weight-semibold)' }}>Email rules</h3>
                                    <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                                        Automatically move new mail to buckets based on the sender
                                    </p>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {rules.map(rule => (
                                        <div key={rule.id} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '12px',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            borderRadius: INNER_RADIUS,
                                            border: '1px solid var(--color-border)'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                                                        {rule.senderPattern}
                                                    </div>
                                                </div>
                                                <ArrowRight size={16} aria-label="to" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    backgroundColor: 'var(--surface-card)',
                                                    padding: '4px 8px',
                                                    borderRadius: INNER_RADIUS,
                                                    border: '1px solid var(--color-border)',
                                                    fontSize: 'var(--font-size-sm)'
                                                }}>
                                                    <div style={{
                                                        width: '8px',
                                                        height: '8px',
                                                        borderRadius: '50%',
                                                        backgroundColor: getBucketColor(rule.bucketId)
                                                    }} />
                                                    {getBucketLabel(rule.bucketId)}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => deleteRule(rule.id)}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    padding: '8px',
                                                    color: 'var(--color-text-muted)',
                                                    marginLeft: '12px'
                                                }}
                                                title="Delete rule"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}

                                    {isAddingRule ? (
                                        <form onSubmit={handleAddRule} style={{
                                            padding: '16px',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            borderRadius: INNER_RADIUS,
                                            border: '1px solid var(--color-border)'
                                        }}>
                                            <h4 style={{ margin: '0 0 16px 0', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--weight-semibold)' }}>New rule</h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-muted)' }}>
                                                        Sender email
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={newSender}
                                                        onChange={(e) => setNewSender(e.target.value)}
                                                        placeholder="newsletter@example.com"
                                                        autoFocus
                                                        style={{
                                                            width: '100%',
                                                            padding: '8px 12px',
                                                            borderRadius: INNER_RADIUS,
                                                            border: '1px solid var(--color-border)',
                                                            fontSize: 'var(--font-size-sm)',
                                                            outline: 'none'
                                                        }}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-muted)' }}>
                                                        Move to bucket
                                                    </label>
                                                    <BucketSelector
                                                        value={newBucketId}
                                                        onChange={setNewBucketId}
                                                    />
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setIsAddingRule(false)}
                                                    style={{
                                                        padding: '8px 16px',
                                                        borderRadius: INNER_RADIUS,
                                                        border: '1px solid var(--color-border)',
                                                        backgroundColor: 'var(--surface-card)',
                                                        fontSize: 'var(--font-size-sm)',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="submit"
                                                    disabled={!newSender.trim() || !newBucketId}
                                                    style={{
                                                        padding: '8px 16px',
                                                        borderRadius: INNER_RADIUS,
                                                        border: 'none',
                                                        backgroundColor: 'var(--color-action)',
                                                        color: 'var(--color-on-action)',
                                                        fontSize: 'var(--font-size-sm)',
                                                        cursor: newSender.trim() && newBucketId ? 'pointer' : 'not-allowed',
                                                        opacity: newSender.trim() && newBucketId ? 1 : 0.5
                                                    }}
                                                >
                                                    Save rule
                                                </button>
                                            </div>
                                        </form>
                                    ) : (
                                        <button
                                            onClick={() => setIsAddingRule(true)}
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                borderRadius: INNER_RADIUS,
                                                border: '1px dashed var(--color-border)',
                                                backgroundColor: 'transparent',
                                                color: 'var(--color-text-muted)',
                                                fontSize: 'var(--font-size-sm)',
                                                fontWeight: 500,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '8px',
                                                transition: 'background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                                e.currentTarget.style.borderColor = 'var(--color-primary)';
                                                e.currentTarget.style.color = 'var(--color-primary)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.borderColor = 'var(--color-border)';
                                                e.currentTarget.style.color = 'var(--color-text-muted)';
                                            }}
                                        >
                                            <Plus size={16} />
                                            Add rule
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Section: Sync Configuration */}
                            <SyncConfigSection />

                            {/* Section: Account Settings */}
                            <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid var(--color-border)' }}>
                                <div style={{ marginBottom: '16px' }}>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: 'var(--font-size-base)', fontWeight: 'var(--weight-semibold)' }}>Account settings</h3>
                                    <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                                        Settings for this email account
                                    </p>
                                </div>

                                <TabNameField key={activeAccountId ?? ''} />

                                {/* Data Management */}
                                <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                                    <button
                                        onClick={() => download(urls.exportSettings, 'electronic-mail-settings.json')}
                                        style={{
                                            flex: 1,
                                            padding: '8px',
                                            borderRadius: INNER_RADIUS,
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-main)',
                                            fontSize: 'var(--font-size-sm)',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        <Download size={16} aria-hidden="true" />Export data
                                    </button>
                                    <button
                                        onClick={() => {
                                            const input = document.createElement('input');
                                            input.type = 'file';
                                            input.accept = '.json';
                                            input.onchange = async (e) => {
                                                const file = (e.target as HTMLInputElement).files?.[0];
                                                if (!file) return;

                                                const reader = new FileReader();
                                                reader.onload = async (e) => {
                                                    try {
                                                        const content = JSON.parse(e.target?.result as string);
                                                        const { summary } = await api.post<{ summary: { updatedAccounts: string[]; skippedAccounts: string[]; buckets: number; rules: number } }>('/settings/import', content);
                                                        alert(`Imported settings for ${summary.updatedAccounts.length} account(s): ${summary.buckets} bucket look(s), ${summary.rules} new rule(s).`
                                                            + (summary.skippedAccounts.length ? `\n\nSkipped (not set up here): ${summary.skippedAccounts.join(', ')}` : '')
                                                            + '\n\nThe page will reload.');
                                                        window.location.reload();
                                                    } catch (error) {
                                                        alert('Import failed: ' + errorText(error));
                                                    }
                                                };
                                                reader.readAsText(file);
                                            };
                                            input.click();
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: '8px',
                                            borderRadius: INNER_RADIUS,
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-main)',
                                            fontSize: 'var(--font-size-sm)',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        <Upload size={16} aria-hidden="true" />Import data
                                    </button>
                                </div>

                                <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--color-bg-subtle)', borderRadius: INNER_RADIUS, border: '1px solid var(--color-border)' }}>
                                    <h4 style={{ margin: '0 0 12px 0', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--weight-semibold)' }}>Inbox click behavior</h4>
                                    <p style={{ margin: '0 0 16px 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                                        Choose what happens when you click an email card in the Inbox for this account
                                    </p>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <button
                                            onClick={() => handlePreferenceChange('expand')}
                                            style={{
                                                padding: '12px',
                                                borderRadius: INNER_RADIUS,
                                                border: `1px solid ${viewPreference === 'expand' ? 'var(--selected-border)' : 'var(--border-strong)'}`,
                                                backgroundColor: viewPreference === 'expand' ? 'var(--selected-bg)' : 'var(--color-bg-subtle)',
                                                color: viewPreference === 'expand' ? 'var(--selected-text)' : 'var(--unselected-text)',
                                                fontSize: 'var(--font-size-sm)',
                                                fontWeight: 500,
                                                cursor: 'pointer',
                                                textAlign: 'center',
                                                transition: 'background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease)',
                                                boxShadow: viewPreference === 'expand' ? 'var(--shadow-selected)' : 'none',
                                                transform: viewPreference === 'expand' ? 'translateY(-1px)' : 'none'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (viewPreference !== 'expand') {
                                                    e.currentTarget.style.backgroundColor = 'var(--surface-card)';
                                                    e.currentTarget.style.borderColor = 'var(--color-text-muted)';
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                if (viewPreference !== 'expand') {
                                                    e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                                                }
                                            }}
                                        >
                                            Expand message
                                            <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 400, marginTop: '4px', color: viewPreference === 'expand' ? 'var(--selected-subtext)' : 'var(--color-text-muted)' }}>
                                                Read it in place (default)
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => handlePreferenceChange('thread')}
                                            style={{
                                                padding: '12px',
                                                borderRadius: INNER_RADIUS,
                                                border: `1px solid ${viewPreference === 'thread' ? 'var(--selected-border)' : 'var(--border-strong)'}`,
                                                backgroundColor: viewPreference === 'thread' ? 'var(--selected-bg)' : 'var(--color-bg-subtle)',
                                                color: viewPreference === 'thread' ? 'var(--selected-text)' : 'var(--unselected-text)',
                                                fontSize: 'var(--font-size-sm)',
                                                fontWeight: 500,
                                                cursor: 'pointer',
                                                textAlign: 'center',
                                                transition: 'background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease)',
                                                boxShadow: viewPreference === 'thread' ? 'var(--shadow-selected)' : 'none',
                                                transform: viewPreference === 'thread' ? 'translateY(-1px)' : 'none'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (viewPreference !== 'thread') {
                                                    e.currentTarget.style.backgroundColor = 'var(--surface-card)';
                                                    e.currentTarget.style.borderColor = 'var(--color-text-muted)';
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                if (viewPreference !== 'thread') {
                                                    e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                                                }
                                            }}
                                        >
                                            Open thread
                                            <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 400, marginTop: '4px', color: viewPreference === 'thread' ? 'var(--selected-subtext)' : 'var(--color-text-muted)' }}>
                                                See the whole thread
                                            </div>
                                        </button>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <button
                                        onClick={() => {
                                            setIsAddingAccount(true);
                                            onClose();
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: INNER_RADIUS,
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-primary)',
                                            fontSize: 'var(--font-size-sm)',
                                            fontWeight: 'var(--weight-semibold)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        <Plus size={16} />
                                        Add another email account
                                    </button>

                                    {!sharedSignIn && <button
                                        onClick={async () => {
                                            try {
                                                await api.post('/auth/logout');
                                                window.location.reload();
                                            } catch (error) {
                                                alert('Logout failed: ' + errorText(error));
                                            }
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: INNER_RADIUS,
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-main)',
                                            fontSize: 'var(--font-size-sm)',
                                            fontWeight: 'var(--weight-semibold)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        Log out of this device
                                    </button>}

                                    <button
                                        onClick={async () => {
                                            const warningMessage =
                                                `This will remove ${activeAccount?.email ?? 'this email account'} from the app

The app will forget its rules, how its buckets look, and its saved copy of the mail.
Your mail itself stays on the mail server, buckets included, and can be added back later.

Your other email accounts will not be affected.

Are you sure you want to proceed?`;

                                            if (activeAccountId && confirm(warningMessage)) {
                                                try {
                                                    await api.del(acct(activeAccountId));
                                                    // Clear the active account so the remaining ones are picked up
                                                    try { localStorage.removeItem('activeAccountId'); } catch { /* fine */ }
                                                    window.location.reload();
                                                } catch (error) {
                                                    alert('Account removal failed: ' + errorText(error));
                                                }
                                            }
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: INNER_RADIUS,
                                            border: 'none',
                                            backgroundColor: 'var(--color-danger)',
                                            color: 'var(--color-on-danger)',
                                            fontSize: 'var(--font-size-sm)',
                                            fontWeight: 'var(--weight-semibold)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px',
                                            transition: 'background-color var(--dur-fast) var(--ease)'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-danger-hover)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-danger)'}
                                    >
                                        Remove this account
                                    </button>
                                </div>

                                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '16px', textAlign: 'center', lineHeight: '1.5' }}>
                                    {!sharedSignIn && <><strong>Log out:</strong> Signs you out of this browser only.<br /></>}
                                    <strong>Remove account:</strong> Forgets this account in the app; the mail stays on the server.
                                </p>
                            </div>

                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );

    return ReactDOM.createPortal(modalContent, document.body);
};
