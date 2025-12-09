import express from 'express';
import { authService } from '../services/authService';
import { configService } from '../services/configService';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 login requests per windowMs
    message: { error: 'Too many login attempts, please try again after 15 minutes' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

router.post('/login', loginLimiter, async (req, res) => {
    const { password } = req.body;

    if (!password) {
        res.status(400).json({ error: 'Password required' });
        return;
    }

    const settings = configService.getSettings();
    if (!settings.auth?.passwordHash) {
        res.status(400).json({ error: 'Auth not configured' });
        return;
    }

    const isValid = await authService.comparePassword(password, settings.auth.passwordHash);
    if (!isValid) {
        res.status(401).json({ error: 'Invalid password' });
        return;
    }

    const token = authService.generateToken({ role: 'admin' });

    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    });

    res.json({ success: true });
});

router.post('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});

router.get('/check', async (req, res) => {
    const isEnabled = await authService.isAuthEnabled();
    if (!isEnabled) {
        res.json({ authenticated: true, enabled: false });
        return;
    }

    const token = req.cookies?.auth_token;
    if (!token) {
        res.json({ authenticated: false, enabled: true });
        return;
    }

    const decoded = authService.verifyToken(token);
    res.json({ authenticated: !!decoded, enabled: true });
});

export default router;
