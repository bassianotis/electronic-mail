import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Plus, Loader, Check } from 'lucide-react';
import { useMail } from '../../context/MailContext';
import { BucketSelector } from './BucketSelector';

// Sync Configuration Section Component
const SyncConfigSection: React.FC = () => {
    const [sentFolderName, setSentFolderName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [startDate, setStartDate] = useState('');
    const [importStarred, setImportStarred] = useState(true);

    // SMTP settings
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState('587');
    const [smtpSecure, setSmtpSecure] = useState(false);
    const [smtpUser, setSmtpUser] = useState('');
    const [smtpPassword, setSmtpPassword] = useState('');
    const [showSmtpPassword, setShowSmtpPassword] = useState(false);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [error, setError] = useState('');

    // Fetch current sync settings on mount
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch('/api/setup/sync-settings');
                if (response.ok) {
                    const data = await response.json();
                    setSentFolderName(data.sentFolderName || '');
                    setDisplayName(data.displayName || '');
                    setStartDate(data.startDate ? data.startDate.split('T')[0] : '');
                    setImportStarred(data.importStarred !== false); // Default true

                    // Load SMTP settings if present
                    if (data.smtp) {
                        setSmtpHost(data.smtp.host || '');
                        setSmtpPort(String(data.smtp.port || 587));
                        setSmtpSecure(data.smtp.secure || false);
                        setSmtpUser(data.smtp.user || '');
                        // Don't load password for security
                    }
                }
            } catch (err) {
                console.error('Failed to fetch sync settings:', err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        setError('');
        setSaveSuccess(false);

        try {
            const response = await fetch('/api/setup/sync-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sentFolderName,
                    displayName,
                    startDate: startDate ? new Date(startDate + 'T00:00:00').toISOString() : null,
                    importStarred,
                    smtp: smtpHost ? {
                        host: smtpHost,
                        port: parseInt(smtpPort) || 587,
                        secure: smtpSecure,
                        user: smtpUser || undefined,
                        password: smtpPassword || undefined
                    } : undefined
                })
            });

            if (response.ok) {
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 2000);
            } else {
                const data = await response.json();
                setError(data.error || 'Failed to save settings');
            }
        } catch (err: any) {
            setError('Failed to save: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-muted)' }}>
                    <Loader size={16} className="animate-spin" />
                    Loading sync settings...
                </div>
            </div>
        );
    }

    return (
        <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid var(--color-border)' }}>
            <div style={{ marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600 }}>Sync Configuration</h3>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    Configure email syncing and display settings
                </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                        Display Name
                    </label>
                    <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your name (shown in sent emails)"
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            fontSize: '14px',
                            backgroundColor: 'var(--color-bg-subtle)'
                        }}
                    />
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                        Sent Folder Name
                    </label>
                    <input
                        type="text"
                        value={sentFolderName}
                        onChange={(e) => setSentFolderName(e.target.value)}
                        placeholder="e.g., [Gmail]/Sent Mail, Sent"
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            fontSize: '14px',
                            backgroundColor: 'var(--color-bg-subtle)'
                        }}
                    />
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        IMAP folder name for syncing sent emails. Leave blank to disable.
                    </div>
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                        Sync Start Date
                    </label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            fontSize: '14px',
                            backgroundColor: 'var(--color-bg-subtle)'
                        }}
                    />
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        Only sync inbox and sent emails from this date onwards. Bucketed emails are not affected.
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                        type="checkbox"
                        id="importStarred"
                        checked={importStarred}
                        onChange={(e) => setImportStarred(e.target.checked)}
                        style={{
                            width: '16px',
                            height: '16px',
                            cursor: 'pointer'
                        }}
                    />
                    <label htmlFor="importStarred" style={{ fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>
                        Include starred emails (regardless of date)
                    </label>
                </div>

                {/* SMTP Configuration */}
                <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--color-border)' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 600 }}>SMTP Settings (for sending)</h4>
                    <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        Configure outgoing mail server. If left blank, SMTP is derived from IMAP settings.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                                SMTP Host
                            </label>
                            <input
                                type="text"
                                value={smtpHost}
                                onChange={(e) => setSmtpHost(e.target.value)}
                                placeholder="smtp.gmail.com"
                                style={{
                                    width: '100%',
                                    padding: '8px 10px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--color-border)',
                                    fontSize: '13px',
                                    backgroundColor: 'var(--color-bg-subtle)'
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                                Port
                            </label>
                            <input
                                type="number"
                                value={smtpPort}
                                onChange={(e) => setSmtpPort(e.target.value)}
                                placeholder="587"
                                style={{
                                    width: '100%',
                                    padding: '8px 10px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--color-border)',
                                    fontSize: '13px',
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
                                width: '14px',
                                height: '14px',
                                cursor: 'pointer'
                            }}
                        />
                        <label htmlFor="smtpSecure" style={{ fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>
                            Use SSL/TLS (port 465). Uncheck for STARTTLS (port 587).
                        </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                                Username (optional)
                            </label>
                            <input
                                type="text"
                                value={smtpUser}
                                onChange={(e) => setSmtpUser(e.target.value)}
                                placeholder="Same as IMAP if blank"
                                style={{
                                    width: '100%',
                                    padding: '8px 10px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--color-border)',
                                    fontSize: '13px',
                                    backgroundColor: 'var(--color-bg-subtle)'
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                                Password (optional)
                            </label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showSmtpPassword ? 'text' : 'password'}
                                    value={smtpPassword}
                                    onChange={(e) => setSmtpPassword(e.target.value)}
                                    placeholder="Same as IMAP if blank"
                                    style={{
                                        width: '100%',
                                        padding: '8px 10px',
                                        paddingRight: '40px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--color-border)',
                                        fontSize: '13px',
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
                                        fontSize: '12px',
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
                        padding: '10px',
                        backgroundColor: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '8px',
                        color: '#b91c1c',
                        fontSize: '13px'
                    }}>
                        {error}
                    </div>
                )}

                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    style={{
                        padding: '10px 16px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: saveSuccess ? '#16a34a' : 'var(--color-primary)',
                        color: '#fff',
                        fontSize: '14px',
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
                            <Loader size={14} className="animate-spin" />
                            Saving...
                        </>
                    ) : saveSuccess ? (
                        <>
                            <Check size={14} />
                            Saved!
                        </>
                    ) : (
                        'Save Sync Settings'
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
    const { rules, buckets, addRule, deleteRule } = useMail();
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
        return bucket ? bucket.color : '#ccc';
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
                            backgroundColor: 'rgba(0,0,0,0.2)',
                            backdropFilter: 'blur(4px)',
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
                            backgroundColor: '#fff',
                            borderRadius: '16px',
                            width: '90%',
                            maxWidth: '600px',
                            maxHeight: '80vh',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: 'var(--shadow-lg)',
                            zIndex: 201,
                            border: '1px solid var(--color-border)',
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
                            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Settings</h2>
                            <button
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
                                <X size={20} />
                            </button>
                        </div>

                        {/* Content - Scrollable List */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

                            {/* Section: Email Rules */}
                            <div style={{ marginBottom: '0' }}>
                                <div style={{ marginBottom: '16px' }}>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600 }}>Email Rules</h3>
                                    <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                        Automatically move new emails to buckets based on the sender.
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
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: '14px', fontWeight: 500 }}>
                                                        {rule.senderPattern}
                                                    </div>
                                                </div>
                                                <div style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>→</div>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    backgroundColor: '#fff',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    border: '1px solid var(--color-border)',
                                                    fontSize: '13px'
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
                                                title="Delete Rule"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}

                                    {isAddingRule ? (
                                        <form onSubmit={handleAddRule} style={{
                                            padding: '16px',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}>
                                            <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 600 }}>New Rule</h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                                                        Sender Email
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={newSender}
                                                        onChange={(e) => setNewSender(e.target.value)}
                                                        placeholder="newsletter@example.com"
                                                        autoFocus
                                                        style={{
                                                            width: '100%',
                                                            padding: '10px 12px',
                                                            borderRadius: '8px',
                                                            border: '1px solid var(--color-border)',
                                                            fontSize: '14px',
                                                            outline: 'none'
                                                        }}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                                                        Move to Bucket
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
                                                        borderRadius: '6px',
                                                        border: '1px solid var(--color-border)',
                                                        backgroundColor: '#fff',
                                                        fontSize: '14px',
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
                                                        borderRadius: '6px',
                                                        border: 'none',
                                                        backgroundColor: 'var(--color-primary)',
                                                        color: '#fff',
                                                        fontSize: '14px',
                                                        cursor: newSender.trim() && newBucketId ? 'pointer' : 'not-allowed',
                                                        opacity: newSender.trim() && newBucketId ? 1 : 0.5
                                                    }}
                                                >
                                                    Save Rule
                                                </button>
                                            </div>
                                        </form>
                                    ) : (
                                        <button
                                            onClick={() => setIsAddingRule(true)}
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                borderRadius: '8px',
                                                border: '1px dashed var(--color-border)',
                                                backgroundColor: 'transparent',
                                                color: 'var(--color-text-secondary)',
                                                fontSize: '14px',
                                                fontWeight: 500,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '8px',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                                e.currentTarget.style.borderColor = 'var(--color-primary)';
                                                e.currentTarget.style.color = 'var(--color-primary)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.borderColor = 'var(--color-border)';
                                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                                            }}
                                        >
                                            <Plus size={16} />
                                            Add New Rule
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Section: Sync Configuration */}
                            <SyncConfigSection />

                            {/* Section: Account Settings */}
                            <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid var(--color-border)' }}>
                                <div style={{ marginBottom: '16px' }}>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600 }}>Account Settings</h3>
                                    <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                        Manage your email account configuration
                                    </p>
                                </div>

                                {/* Data Management */}
                                <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                                    <button
                                        onClick={() => {
                                            window.open('/api/setup/export', '_blank');
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: '10px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-primary)',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        📥 Export Data
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
                                                        const response = await fetch('/api/setup/import', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify(content)
                                                        });
                                                        const data = await response.json();
                                                        if (data.success) {
                                                            alert('Data imported successfully! The page will reload.');
                                                            window.location.reload();
                                                        } else {
                                                            alert('Import failed: ' + data.error);
                                                        }
                                                    } catch (error: any) {
                                                        alert('Import failed: ' + error.message);
                                                    }
                                                };
                                                reader.readAsText(file);
                                            };
                                            input.click();
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: '10px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-primary)',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        📤 Import Data
                                    </button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <button
                                        onClick={async () => {
                                            try {
                                                const response = await fetch('/api/auth/logout', {
                                                    method: 'POST'
                                                });
                                                const data = await response.json();
                                                if (data.success) {
                                                    window.location.reload();
                                                } else {
                                                    alert('Logout failed: ' + data.error);
                                                }
                                            } catch (error: any) {
                                                alert('Logout failed: ' + error.message);
                                            }
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: '#f3f4f6',
                                            color: '#374151',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        Log Out of This Device
                                    </button>

                                    <button
                                        onClick={async () => {
                                            const warningMessage =
                                                `⚠️ Warning: This will wipe all data from the server
                                                
Logging out will permanently delete all local data, including:
• Custom Buckets
• Email Rules
• Notes & Due Dates

Please Export Data first if you want to save this information.

Are you sure you want to proceed?`;

                                            if (confirm(warningMessage)) {
                                                try {
                                                    const response = await fetch('/api/setup/logout', {
                                                        method: 'POST'
                                                    });
                                                    const data = await response.json();
                                                    if (data.success) {
                                                        window.location.reload();
                                                    } else {
                                                        alert('Logout failed: ' + data.error);
                                                    }
                                                } catch (error: any) {
                                                    alert('Logout failed: ' + error.message);
                                                }
                                            }
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            backgroundColor: '#ef4444',
                                            color: '#fff',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px',
                                            transition: 'background-color 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ef4444'}
                                    >
                                        Reset Server & Clear Data
                                    </button>
                                </div>

                                <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '16px', textAlign: 'center', lineHeight: '1.5' }}>
                                    <strong>Log Out:</strong> Signs you out of this browser only.<br />
                                    <strong>Reset Server:</strong> Wipes all data and disconnects IMAP.
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
