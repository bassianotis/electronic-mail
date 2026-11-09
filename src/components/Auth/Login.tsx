import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader, AlertCircle, Lock } from 'lucide-react';
import { api, ApiError } from '../../api/client';

interface LoginProps {
    onLogin: () => void;
    /** Shown over the app when the session ended while it was open. */
    sessionEnded?: boolean;
}

export const Login: React.FC<LoginProps> = ({ onLogin, sessionEnded }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await api.post('/auth/login', { identifier: email, passphrase: password });
            onLogin();
        } catch (err) {
            const status = err instanceof ApiError ? err.status : 0;
            setError(status === 401 ? 'Wrong email or password'
                : status === 429 ? 'Too many attempts. Wait a few minutes, then try again.'
                : status === 0 ? 'Failed to connect to server'
                : (err as Error).message || 'Login failed');
        } finally {
            setLoading(false);
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
                    maxWidth: '400px',
                    padding: '40px',
                    textAlign: 'center'
                }}
            >
                <div style={{
                    width: '64px',
                    height: '64px',
                    backgroundColor: 'var(--color-bg-subtle)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 24px auto'
                }}>
                    <Lock size={32} color="var(--color-text-muted)" />
                </div>

                <h2 style={{
                    fontSize: 'var(--font-size-2xl)',
                    fontWeight: 'var(--weight-bold)',
                    marginBottom: '8px',
                    color: 'var(--color-text-main)'
                }}>
                    Electronic Mail
                </h2>

                {sessionEnded && (
                    <p role="status" style={{ margin: '0 0 16px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                        You were logged out. Log in to pick up where you left off.
                    </p>
                )}

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '12px' }}>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Email address"
                            required
                            autoFocus
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: 'var(--radius-control)',
                                border: '1px solid var(--color-border)',
                                fontSize: 'var(--font-size-base)',
                                backgroundColor: 'var(--color-bg-subtle)',
                                color: 'var(--color-text-main)',
                                textAlign: 'center'
                            }}
                        />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Password"
                            required
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: 'var(--radius-control)',
                                border: '1px solid var(--color-border)',
                                fontSize: 'var(--font-size-base)',
                                backgroundColor: 'var(--color-bg-subtle)',
                                color: 'var(--color-text-main)',
                                textAlign: 'center'
                            }}
                        />
                    </div>

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
                        type="submit"
                        disabled={loading || !password || !email}
                        style={{
                            width: '100%',
                            padding: '12px',
                            backgroundColor: 'var(--color-action)',
                            color: 'var(--color-on-action)',
                            border: 'none',
                            borderRadius: 'var(--radius-control)',
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: 'var(--weight-semibold)',
                            cursor: loading || !password || !email ? 'not-allowed' : 'pointer',
                            opacity: loading || !password || !email ? 0.7 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px'
                        }}
                    >
                        {loading ? (
                            <>
                                <Loader className="animate-spin" size={16} />
                                Verifying…
                            </>
                        ) : (
                            'Log in'
                        )}
                    </button>
                </form>
            </motion.div>
        </div>
    );
};
