/**
 * Mail on its own (no Bassapps): its built-in login for one person, on the same sign-in card as
 * Bassapps (src/shared/SignInCard.tsx, one build; board P6, change 4): Mail's name and mark, no
 * Bassapps footer line. Also shown over the app when the session ended while it was open.
 */
import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { SignInCard, type SignInProblem } from '../../shared/SignInCard';

interface LoginProps {
    onLogin: () => void;
    /** Shown over the app when the session ended while it was open. */
    sessionEnded?: boolean;
}

export const Login: React.FC<LoginProps> = ({ onLogin, sessionEnded }) => {
    const [username, setUsername] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [signing, setSigning] = useState(false);
    const [problem, setProblem] = useState<SignInProblem | null>(null);

    const submit = async () => {
        if (signing || !username.trim() || !passphrase) return;
        setSigning(true);
        try {
            await api.post('/auth/login', { identifier: username, passphrase });
            onLogin();
        } catch (err) {
            const status = err instanceof ApiError ? err.status : 0;
            // Never which part: the passphrase is cleared, and the focus goes back to it
            if (status === 401) setPassphrase('');
            setProblem(status === 401 ? { kind: 'wrong' }
                : status === 429 ? { kind: 'locked', until: null }
                : { kind: 'offline' });
        } finally {
            setSigning(false);
        }
    };

    return (
        <SignInCard
            brand={<span className="si-brand"><Mail size={16} aria-hidden="true" />Electronic Mail</span>}
            notice={sessionEnded ? 'ended' : null}
            userLabel="Email address"
            username={username}
            onUsername={setUsername}
            passphrase={passphrase}
            onPassphrase={setPassphrase}
            problem={problem}
            signing={signing}
            onSubmit={() => void submit()}
            forgot={{ command: 'docker compose exec -it mail node engine/bin/set-passphrase.ts <username>', protects: 'your mail' }}
        />
    );
};
