import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { configService } from './configService';

const SALT_ROUNDS = 10;
// In a real app, this should be a strong secret, possibly rotated.
// For self-hosted, we can generate one or use a fixed one.
// Let's use a fixed one for now or generate one and store in DB.
// For simplicity, we'll use a hardcoded secret if not in env.
const JWT_SECRET = process.env.JWT_SECRET || 'mail-app-secret-key-change-me';

export const authService = {
    async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, SALT_ROUNDS);
    },

    async comparePassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    },

    generateToken(payload: any): string {
        return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
    },

    verifyToken(token: string): any {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch (error) {
            return null;
        }
    },

    async isAuthEnabled(): Promise<boolean> {
        const settings = configService.getSettings();
        return !!settings.auth?.passwordHash;
    }
};
