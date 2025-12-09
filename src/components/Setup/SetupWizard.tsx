import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, AlertCircle, Loader, ArrowRight } from 'lucide-react';

interface SetupWizardProps {
    onComplete: () => void;
}

interface FormData {
    email: string;
    password: string;
    host: string;
    port: string;
    secure: boolean;
    startDate: string;
    displayName: string;
    importStarred: boolean;
    webPassword?: string;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState<FormData>({
        email: '',
        password: '',
        webPassword: '',
        host: '',
        port: '993',
        secure: true,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days ago
        displayName: '',
        importStarred: true
    });
    const [validating, setValidating] = useState(false);
    const [connectionSuccess, setConnectionSuccess] = useState(false);
    const [error, setError] = useState('');

    const updateField = (field: keyof FormData, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setError('');
    };

    // Auto-detect IMAP settings based on email domain
    const detectIMAPSettings = (email: string) => {
        const domain = email.split('@')[1]?.toLowerCase();

        if (domain?.includes('gmail')) {
            updateField('host', 'imap.gmail.com');
            updateField('port', '993');
            updateField('secure', true);
        } else if (domain?.includes('outlook') || domain?.includes('hotmail') || domain?.includes('live')) {
            updateField('host', 'outlook.office365.com');
            updateField('port', '993');
            updateField('secure', true);
        } else if (domain?.includes('yahoo')) {
            updateField('host', 'imap.mail.yahoo.com');
            updateField('port', '993');
            updateField('secure', true);
        } else if (domain?.includes('icloud')) {
            updateField('host', 'imap.mail.me.com');
            updateField('port', '993');
            updateField('secure', true);
        }
    };

    const handleEmailChange = (email: string) => {
        updateField('email', email);
        if (email.includes('@')) {
            detectIMAPSettings(email);
        }
    };

    const validateCredentials = async () => {
        setValidating(true);
        setError('');

        try {
            const validateResponse = await fetch('/api/setup/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host: formData.host,
                    port: formData.port,
                    secure: formData.secure,
                    user: formData.email,
                    password: formData.password
                })
            });

            const validateData = await validateResponse.json();

            if (!validateData.valid) {
                setError(validateData.error || 'Invalid credentials');
                setValidating(false);
                return false;
            }

            setValidating(false);
            return true;
        } catch (err: any) {
            setError('Validation failed: ' + err.message);
            setValidating(false);
            return false;
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
                setConnectionSuccess(true);
                setTimeout(() => {
                    setConnectionSuccess(false);
                    setStep(2);
                }, 1500);
            }
        } else if (step === 2) {
            setStep(3);
        } else if (step === 3) {
            if (!formData.webPassword) {
                setError('Please create a web access password');
                return;
            }

            // Fire the save API immediately (fire-and-forget) so sync starts NOW
            // User will see "All Set!" while sync runs in background
            setStep(4);

            // Trigger save in background - don't await, let it run while user reads confirmation
            fetch('/api/setup/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    host: formData.host,
                    port: formData.port,
                    secure: formData.secure,
                    user: formData.email,
                    password: formData.password,
                    startDate: formData.startDate,
                    displayName: formData.displayName || formData.email.split('@')[0],
                    importStarred: formData.importStarred,
                    webPassword: formData.webPassword
                })
            }).then(res => res.json()).then(data => {
                if (!data.success) {
                    console.error('Background save failed:', data.error);
                }
            }).catch(err => {
                console.error('Background save error:', err);
            });
        }
    };

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            backgroundColor: 'var(--color-bg-default)',
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
                            <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', textAlign: 'center' }}>
                                Setup Your Electronic Mail
                            </h1>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '32px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                        Email Address
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => handleEmailChange(e.target.value)}
                                        placeholder="you@example.com"
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            fontSize: '14px',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-primary)'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                        Email Password
                                    </label>
                                    <input
                                        type="password"
                                        value={formData.password}
                                        onChange={(e) => updateField('password', e.target.value)}
                                        placeholder="••••••••••••"
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            fontSize: '14px',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-primary)'
                                        }}
                                    />
                                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                        Use an <strong>App Password</strong> if you use Gmail, Outlook, or iCloud.
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
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: 'var(--color-text-muted)' }}>
                                            IMAP Host
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.host}
                                            onChange={(e) => updateField('host', e.target.value)}
                                            placeholder="imap.example.com"
                                            style={{
                                                width: '100%',
                                                padding: '8px 10px',
                                                borderRadius: '6px',
                                                border: '1px solid var(--color-border)',
                                                fontSize: '13px',
                                                backgroundColor: 'var(--color-bg-subtle)',
                                                color: 'var(--color-text-primary)'
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: 'var(--color-text-muted)' }}>
                                            Port
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.port}
                                            onChange={(e) => updateField('port', e.target.value)}
                                            placeholder="993"
                                            style={{
                                                width: '100%',
                                                padding: '8px 10px',
                                                borderRadius: '6px',
                                                border: '1px solid var(--color-border)',
                                                fontSize: '13px',
                                                backgroundColor: 'var(--color-bg-subtle)',
                                                color: 'var(--color-text-primary)'
                                            }}
                                        />
                                    </div>
                                </div>

                                {error && (
                                    <div style={{
                                        padding: '12px',
                                        backgroundColor: '#fef2f2',
                                        border: '1px solid #fecaca',
                                        borderRadius: '8px',
                                        color: '#b91c1c',
                                        fontSize: '13px',
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
                                        backgroundColor: '#667eea',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        cursor: validating ? 'wait' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                        marginTop: '10px',
                                        opacity: validating ? 0.7 : 1
                                    }}
                                >
                                    {validating ? (
                                        <>
                                            <Loader className="animate-spin" size={16} />
                                            Verifying Credentials...
                                        </>
                                    ) : connectionSuccess ? (
                                        <>
                                            <Check size={16} />
                                            Connection Successful
                                        </>
                                    ) : (
                                        <>
                                            Next
                                            <ArrowRight size={16} />
                                        </>
                                    )}
                                </button>
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
                            <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', textAlign: 'center' }}>
                                Sync Settings
                            </h1>
                            <p style={{
                                fontSize: '14px',
                                color: 'var(--color-text-muted)',
                                textAlign: 'center',
                                marginBottom: '32px'
                            }}>
                                Choose how much history to import.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                        Begin Fetching Emails From
                                    </label>
                                    <input
                                        type="date"
                                        value={formData.startDate}
                                        onChange={(e) => updateField('startDate', e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            fontSize: '14px',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-primary)'
                                        }}
                                    />
                                </div>

                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '12px',
                                    backgroundColor: 'var(--color-bg-subtle)',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)'
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.importStarred}
                                        onChange={(e) => updateField('importStarred', e.target.checked)}
                                        style={{ width: '16px', height: '16px' }}
                                    />
                                    <div>
                                        <div style={{ fontSize: '14px', fontWeight: 500 }}>Fetch Starred Emails</div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                            Always fetch flagged/starred emails, regardless of date.
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                                    <button
                                        onClick={() => setStep(1)}
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            backgroundColor: 'transparent',
                                            color: '#1f2937',
                                            border: '1px solid #e5e7eb',
                                            borderRadius: '8px',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleNextStep}
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            backgroundColor: '#667eea',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        Next
                                        <ArrowRight size={16} />
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
                            <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', textAlign: 'center' }}>
                                Secure Your Electronic Mail
                            </h1>
                            <p style={{
                                fontSize: '14px',
                                color: 'var(--color-text-muted)',
                                textAlign: 'center',
                                marginBottom: '32px'
                            }}>
                                Create a password to access your electronic mail on the web.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                        Web Access Password
                                    </label>
                                    <input
                                        type="password"
                                        value={formData.webPassword}
                                        onChange={(e) => updateField('webPassword', e.target.value)}
                                        placeholder="Create a secure password"
                                        autoFocus
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            fontSize: '14px',
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            color: 'var(--color-text-primary)'
                                        }}
                                    />
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '8px', lineHeight: '1.4' }}>
                                        This is separate from your provider password. Use this password to read your electronic mail from any browser.
                                    </div>
                                </div>

                                {error && (
                                    <div style={{
                                        padding: '12px',
                                        backgroundColor: '#fef2f2',
                                        border: '1px solid #fecaca',
                                        borderRadius: '8px',
                                        color: '#b91c1c',
                                        fontSize: '13px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <AlertCircle size={16} />
                                        {error}
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                                    <button
                                        onClick={() => setStep(2)}
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            backgroundColor: 'transparent',
                                            color: '#1f2937',
                                            border: '1px solid #e5e7eb',
                                            borderRadius: '8px',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleNextStep}
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            backgroundColor: '#667eea',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        Next
                                        <ArrowRight size={16} />
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
                                backgroundColor: '#dcfce7',
                                color: '#16a34a',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 24px auto'
                            }}>
                                <Check size={32} />
                            </div>

                            <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>
                                All Set!
                            </h1>
                            <p style={{
                                fontSize: '14px',
                                color: 'var(--color-text-muted)',
                                marginBottom: '32px'
                            }}>
                                Okay, let's access your inbox.
                            </p>

                            {error && (
                                <div style={{
                                    padding: '12px',
                                    backgroundColor: '#fef2f2',
                                    border: '1px solid #fecaca',
                                    borderRadius: '8px',
                                    color: '#b91c1c',
                                    fontSize: '13px',
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
                                    backgroundColor: '#667eea',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px'
                                }}
                            >
                                Go to Inbox
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
};
