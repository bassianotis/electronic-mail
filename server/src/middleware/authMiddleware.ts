import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    // Check if auth is enabled
    const isEnabled = await authService.isAuthEnabled();
    if (!isEnabled) {
        return next();
    }

    const token = req.cookies?.auth_token;

    if (!token) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const decoded = authService.verifyToken(token);
    if (!decoded) {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }

    // Attach user info to request if needed
    // (req as any).user = decoded;

    next();
};
