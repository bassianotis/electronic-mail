import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, AlertCircle, Loader, ArrowRight } from 'lucide-react';
import { api, errorText } from '../../api/client';
import type { Account } from '../../api/types';

interface SetupWizardProps {
    onComplete: () => void;
    isNewAccount?: boolean;
    /** Lets the user back out of adding another account. */
    onCancel?: () => void;
}

interface FormData {
    email: string;
    password: string;
    host: string;
    port: string;
    secure: boolean;
    displayName: string;
    webPassword?: string;
    smtpHost: string;
    smtpPort: string;
    smtpSecure: boolean;
}

/** Well-known providers (Thunderbird's autoconfig does the same for these). */
const PROVIDERS: { match: RegExp; imap: string; smtp: string; smtpPort: string; smtpSecure: boolean }[] = [
    { match: /gmail|googlemail/, imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', smtpPort: '465', smtpSecure: true },
    { match: /outlook|hotmail|live/, imap: 'outlook.office365.com', smtp: 'smtp.office365.com', smtpPort: '587', smtpSecure: false },
    { match: /yahoo/, imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com', smtpPort: '465', smtpSecure: true },
    { match: /icloud|me\.com|mac\.com/, imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: '587', smtpSecure: false },
];

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete, isNewAccount, onCancel }) => {
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState<FormData>({
        email: '',
        password: '',
        webPassword: '',
        host: '',
        port: '993',
        secure: true,
        displayName: '',
        smtpHost: '',
        smtpPort: '465',
        smtpSecure: true
    });
    const [validating, setValidating] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loginCreated, setLoginCreated] = useState(false);
    const [connectionSuccess, setConnectionSuccess] = useState(false);
    const [error, setError] = useState('');

    const updateField = (field: keyof FormData, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setError('');
    };

    // Auto-detect server settings based on email domain
    const detectIMAPSettings = (email: string) => {
        const domain = email.split('@')[1]?.toLowerCase() ?? '';
        const provider = PROVIDERS.find(p => p.match.test(domain));
        if (provider) {
            setFormData(prev => ({
                ...prev, host: provider.imap, port: '993', secure: true,
                smtpHost: provider.smtp, smtpPort: provider.smtpPort, smtpSecure: provider.smtpSecure,
            }));
        }
    };

    const handleEmailChange = (email: string) => {
        updateField('email', email);
        if (email.includes('@')) {
            detectIMAPSettings(email);
        }
    };

    const imapSettings = () => ({
        host: formData.host.trim(),
        port: Number(formData.port),
        secure: formData.secure,
        user: formData.email.trim(),
        pass: formData.password
    });

    const validateCredentials = async () => {
        setValidating(true);
        setError('');
        try {
            const { check } = await api.post<{ check: { imap: { ok: boolean; error?: string } } }>('/accounts/test', { imap: imapSettings() });
            if (!check.imap.ok) {
                setError(check.imap.error || 'Invalid credentials');
                return false;
            }
            return true;
        } catch (err) {
            setError('Validation failed: ' + errorText(err));
            return false;
        } finally {
            setValidating(false);
        }
    };

    const handleNextStep = async () => {
        if (step === 1) {
            if (!formData.email || !formData.password || !formData.host) {
                setError('Please fill in all required fields');
                return;
            }

            const isValid = await validateCredentials();
            if (isValid) {
                // Most hosts send from the same server name: start from that.
                if (!formData.smtpHost) setFormData(prev => ({ ...prev, smtpHost: prev.host }));
                setConnectionSuccess(true);
                setTimeout(() => {
                    setConnectionSuccess(false);
                    setStep(2);
                }, 1500);
            }
        } else if (step === 2) {
            if (!formData.smtpHost.trim()) {
                setError('Please enter the outgoing mail server');
                return;
            }
            if (isNewAccount) {
                void submitSetup();
            } else {
                setStep(3);
            }
        } else if (step === 3) {
            if (!formData.webPassword || formData.webPassword.length < 8) {
                setError('Please create a web access password of at least 8 characters');
                return;
            }
            void submitSetup();
        }
    };

    /** Creates the login (first run only), then the account; the engine tries both servers first. */
    const submitSetup = async () => {
        setSubmitting(true);
        setError('');
        try {
            if (!isNewAccount && !loginCreated) {
                await api.post('/auth/setup', { identifier: formData.email.trim(), passphrase: formData.webPassword });
                setLoginCreated(true);
            }
            await api.post<{ account: Account }>('/accounts', {
                email: formData.email.trim(),
                displayName: formData.displayName.trim() || formData.email.split('@')[0],
                imap: imapSettings(),
                smtp: {
                    host: formData.smtpHost.trim(),
                    port: Number(formData.smtpPort),
                    secure: formData.smtpSecure,
                    user: formData.email.trim(),
                    pass: formData.password
                }
            });
            setStep(4);
        } catch (err) {
            const message = errorText(err);
            setError(message);
            setStep(/Outgoing mail|SMTP/i.test(message) ? 2 : /Incoming mail|IMAP/i.test(message) ? 1 : step);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            backgroundColor: 'var(--color-bg)',
            padding: '20px'
        }}>
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                    width: '100%',
                    maxWidth: '480px',
                    padding: '40px'
                }}
            >
                <AnimatePresence mode="wait">
                    {step === 1 && (
                        <motion.div
                            key="step1"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                        >
                            <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: '8px', textAlign: 'center' }}>
                                Set up Electronic Mail
                            </h1>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '32px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px' }}>
                                        Email address
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => handleEmailChange(e.target.value)}
                                        placeholder="you@example.com"
                                        style={{
                                            width: '100%',
                                            padding: '8px 12px',
                                            borderRadius: 'var(--radius-control)',
                                            border: '1px solid var(--color-border)',
                                            fontSize: 'var(--font-size-sm)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-main)'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px' }}>
                                        Email password
                                    </label>
                                    <input
                                        type="password"
                                        value={formData.password}
                                        onChange={(e) => updateField('password', e.target.value)}
                                        placeholder="••••••••••••"
                                        style={{
                                            width: '100%',
                                            padding: '8px 12px',
                                            borderRadius: 'var(--radius-control)',
                                            border: '1px solid var(--color-border)',
                                            fontSize: 'var(--font-size-sm)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-main)'
                                        }}
                                    />
                                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                        Use an <strong>App Password</strong> if you use Gmail, Outlook, or iCloud
                                    </div>
                                </div>

                                {/* Advanced Settings - Always Visible */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '2fr 1fr',
                                    gap: '12px',
                                    paddingTop: '12px',
                                    borderTop: '1px solid var(--color-border)'
                                }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 500, marginBottom: '4px', color: 'var(--color-text-muted)' }}>
                                            IMAP host
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.host}
                                            onChange={(e) => updateField('host', e.target.value)}
                                            placeholder="imap.example.com"
                                            style={{
                                                width: '100%',
                                                padding: '8px 12px',
                                                borderRadius: 'var(--radius-sm)',
                                                border: '1px solid var(--color-border)',
                                                fontSize: 'var(--font-size-sm)',
                                                backgroundColor: 'var(--color-bg-subtle)',
                                                color: 'var(--color-text-main)'
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 500, marginBottom: '4px', color: 'var(--color-text-muted)' }}>
                                            Port
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.port}
                                            onChange={(e) => updateField('port', e.target.value)}
                                            placeholder="993"
                                            style={{
                                                width: '100%',
                                                padding: '8px 12px',
                                                borderRadius: 'var(--radius-sm)',
                                                border: '1px solid var(--color-border)',
                                                fontSize: 'var(--font-size-sm)',
                                                backgroundColor: 'var(--color-bg-subtle)',
                                                color: 'var(--color-text-main)'
                                            }}
                                        />
                                    </div>
                                </div>

                                {error && (
                                    <div style={{
                                        padding: '12px',
                                        backgroundColor: 'var(--error-bg)',
                                        border: '1px solid var(--error-border)',
                                        borderRadius: 'var(--radius-control)',
                                        color: 'var(--error-text)',
                                        fontSize: 'var(--font-size-sm)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <AlertCircle size={16} />
                                        {error}
                                    </div>
                                )}

                                <button
                                    onClick={handleNextStep}
                                    disabled={validating}
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        backgroundColor: 'var(--color-action)',
                                        color: 'var(--color-on-action)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-control)',
                                        fontSize: 'var(--font-size-sm)',
                                        fontWeight: 'var(--weight-semibold)',
                                        cursor: validating ? 'wait' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                        marginTop: '8px',
                                        opacity: validating ? 0.7 : 1
                                    }}
                                >
                                    {validating ? (
                                        <>
                                            <Loader className="animate-spin" size={16} />
                                            Verifying…
                                        </>
                                    ) : connectionSuccess ? (
                                        <>
                                            <Check size={16} />
                                            Connection successful
                                        </>
                                    ) : (
                                        <>
                                            Next
                                            <ArrowRight size={16} />
                                        </>
                                    )}
                                </button>
                                {onCancel && (
                                    <button
                                        onClick={onCancel}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--color-text-muted)',
                                            fontSize: 'var(--font-size-sm)',
                                            cursor: 'pointer',
                                            alignSelf: 'center'
                                        }}
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {step === 2 && (
                        <motion.div
                            key="step2"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                        >
                            <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: '8px', textAlign: 'center' }}>
                                Sending mail
                            </h1>
                            <p style={{
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-muted)',
                                textAlign: 'center',
                                marginBottom: '32px'
                            }}>
                                Your name on sent mail, and where mail is sent from
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px' }}>
                                        Your name
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.displayName}
                                        onChange={(e) => updateField('displayName', e.target.value)}
                                        placeholder={formData.email.split('@')[0]}
                                        style={{
                                            width: '100%',
                                            padding: '8px 12px',
                                            borderRadius: 'var(--radius-control)',
                                            border: '1px solid var(--color-border)',
                                            fontSize: 'var(--font-size-sm)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-main)'
                                        }}
                                    />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 500, marginBottom: '4px', color: 'var(--color-text-muted)' }}>
                                            Outgoing mail server (SMTP)
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.smtpHost}
                                            onChange={(e) => updateField('smtpHost', e.target.value)}
                                            placeholder="smtp.example.com"
                                            style={{
                                                width: '100%',
                                                padding: '8px 12px',
                                                borderRadius: 'var(--radius-control)',
                                                border: '1px solid var(--color-border)',
                                                fontSize: 'var(--font-size-sm)',
                                                backgroundColor: 'var(--color-bg-subtle)',
                                                color: 'var(--color-text-main)'
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 500, marginBottom: '4px', color: 'var(--color-text-muted)' }}>
                                            Port
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.smtpPort}
                                            onChange={(e) => updateField('smtpPort', e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '8px 12px',
                                                borderRadius: 'var(--radius-control)',
                                                border: '1px solid var(--color-border)',
                                                fontSize: 'var(--font-size-sm)',
                                                backgroundColor: 'var(--color-bg-subtle)',
                                                color: 'var(--color-text-main)'
                                            }}
                                        />
                                    </div>
                                </div>

                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '12px',
                                    backgroundColor: 'var(--color-bg-subtle)',
                                    borderRadius: 'var(--radius-control)',
                                    border: '1px solid var(--color-border)'
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.smtpSecure}
                                        onChange={(e) => updateField('smtpSecure', e.target.checked)}
                                        style={{ width: '16px', height: '16px' }}
                                    />
                                    <div>
                                        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Use SSL/TLS</div>
                                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                                            Usually port 465. Uncheck for STARTTLS (usually port 587). Your email password is used here too.
                                        </div>
                                    </div>
                                </div>

                                {error && (
                                    <div style={{
                                        padding: '12px',
                                        backgroundColor: 'var(--error-bg)',
                                        border: '1px solid var(--error-border)',
                                        borderRadius: 'var(--radius-control)',
                                        color: 'var(--error-text)',
                                        fontSize: 'var(--font-size-sm)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <AlertCircle size={16} />
                                        {error}
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                                    <button
                                        onClick={() => setStep(1)}
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            backgroundColor: 'transparent',
                                            color: 'var(--color-text-main)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-control)',
                                            fontSize: 'var(--font-size-sm)',
                                            fontWeight: 'var(--weight-semibold)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleNextStep}
                                        disabled={submitting}
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            backgroundColor: 'var(--color-action)',
                                            color: 'var(--color-on-action)',
                                            border: 'none',
                                            borderRadius: 'var(--radius-control)',
                                            fontSize: 'var(--font-size-sm)',
                                            fontWeight: 'var(--weight-semibold)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        {submitting ? (
                                            <>
                                                <Loader className="animate-spin" size={16} />
                                                Checking…
                                            </>
                                        ) : (
                                            <>
                                                {step === 2 && isNewAccount ? 'Add account' : 'Next'}
                                                <ArrowRight size={16} />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 3 && (
                        <motion.div
                            key="step3"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                        >
                            <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: '8px', textAlign: 'center' }}>
                                Secure your Electronic Mail
                            </h1>
                            <p style={{
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-muted)',
                                textAlign: 'center',
                                marginBottom: '32px'
                            }}>
                                Create a password to access your electronic mail on the web
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: '8px' }}>
                                        Web access password
                                    </label>
                                    <input
                                        type="password"
                                        value={formData.webPassword}
                                        onChange={(e) => updateField('webPassword', e.target.value)}
                                        placeholder="Create a secure password"
                                        autoFocus
                                        style={{
                                            width: '100%',
                                            padding: '8px 12px',
                                            borderRadius: 'var(--radius-control)',
                                            border: '1px solid var(--color-border)',
                                            fontSize: 'var(--font-size-sm)',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-main)'
                                        }}
                                    />
                                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '8px', lineHeight: '1.4' }}>
                                        This is separate from your provider password. Use this password to read your electronic mail from any browser.
                                    </div>
                                </div>

                                {error && (
                                    <div style={{
                                        padding: '12px',
                                        backgroundColor: 'var(--error-bg)',
                                        border: '1px solid var(--error-border)',
                                        borderRadius: 'var(--radius-control)',
                                        color: 'var(--error-text)',
                                        fontSize: 'var(--font-size-sm)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <AlertCircle size={16} />
                                        {error}
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                                    <button
                                        onClick={() => setStep(2)}
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            backgroundColor: 'transparent',
                                            color: 'var(--color-text-main)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-control)',
                                            fontSize: 'var(--font-size-sm)',
                                            fontWeight: 'var(--weight-semibold)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleNextStep}
                                        disabled={submitting}
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            backgroundColor: 'var(--color-action)',
                                            color: 'var(--color-on-action)',
                                            border: 'none',
                                            borderRadius: 'var(--radius-control)',
                                            fontSize: 'var(--font-size-sm)',
                                            fontWeight: 'var(--weight-semibold)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        {submitting ? (
                                            <>
                                                <Loader className="animate-spin" size={16} />
                                                Checking…
                                            </>
                                        ) : (
                                            <>
                                                Next
                                                <ArrowRight size={16} />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 4 && (
                        <motion.div
                            key="step4"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            style={{ textAlign: 'center' }}
                        >
                            <div style={{
                                width: '64px',
                                height: '64px',
                                backgroundColor: 'var(--success-bg)',
                                color: 'var(--color-success)',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 24px auto'
                            }}>
                                <Check size={32} />
                            </div>

                            <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: '8px' }}>
                                All set!
                            </h1>
                            <p style={{
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-muted)',
                                marginBottom: '32px'
                            }}>
                                Okay, let's access your inbox.
                            </p>

                            {error && (
                                <div style={{
                                    padding: '12px',
                                    backgroundColor: 'var(--error-bg)',
                                    border: '1px solid var(--error-border)',
                                    borderRadius: 'var(--radius-control)',
                                    color: 'var(--error-text)',
                                    fontSize: 'var(--font-size-sm)',
                                    marginBottom: '20px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    justifyContent: 'center'
                                }}>
                                    <AlertCircle size={16} />
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={onComplete}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    backgroundColor: 'var(--color-action)',
                                    color: 'var(--color-on-action)',
                                    border: 'none',
                                    borderRadius: 'var(--radius-control)',
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: 'var(--weight-semibold)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px'
                                }}
                            >
                                {isNewAccount ? 'Close' : 'Go to Inbox'}
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
};
