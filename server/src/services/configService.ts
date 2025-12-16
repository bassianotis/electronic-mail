import { getDb } from './dbService';

export interface ImapConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
}

export interface SyncSettings {
    startDate?: string; // ISO date string
    displayName?: string;
    importStarred?: boolean;
    sentFolderName?: string; // IMAP folder name for sent emails, e.g., "[Gmail]/Sent Mail"
}

export interface AuthSettings {
    passwordHash?: string;
}

export interface AppSettings {
    imap?: ImapConfig;
    sync?: SyncSettings;
    auth?: AuthSettings;
}

class ConfigService {
    private settings: AppSettings = {};
    private initialized = false;

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const db = getDb();
            const rows = await db.all('SELECT key, value FROM app_settings');

            for (const row of rows) {
                try {
                    this.settings[row.key as keyof AppSettings] = JSON.parse(row.value);
                } catch (e) {
                    console.error(`Failed to parse settings for key ${row.key}:`, e);
                }
            }

            // Fallback to environment variables if no database config
            if (!this.settings.imap && process.env.IMAP_HOST) {
                this.settings.imap = {
                    host: process.env.IMAP_HOST,
                    port: parseInt(process.env.IMAP_PORT || '993'),
                    secure: process.env.IMAP_SECURE !== 'false',
                    user: process.env.IMAP_USER || '',
                    password: process.env.IMAP_PASSWORD || ''
                };
            }

            this.initialized = true;
            console.log('ConfigService initialized');
        } catch (error) {
            console.error('Failed to initialize ConfigService:', error);
            throw error;
        }
    }

    getSettings(): AppSettings {
        if (!this.initialized) {
            throw new Error('ConfigService not initialized');
        }
        return this.settings;
    }

    getImapConfig(): ImapConfig | undefined {
        return this.settings.imap;
    }

    getSyncSettings(): SyncSettings {
        return this.settings.sync || {};
    }

    async saveSetting(key: keyof AppSettings, value: any): Promise<void> {
        const db = getDb();
        const jsonValue = JSON.stringify(value);
        const now = new Date().toISOString();

        await db.run(
            'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
            [key, jsonValue, now]
        );

        // Update in-memory settings
        this.settings[key] = value;
    }

    async saveSettings(settings: Partial<AppSettings>): Promise<void> {
        for (const [key, value] of Object.entries(settings)) {
            await this.saveSetting(key as keyof AppSettings, value);
        }
    }

    isConfigured(): boolean {
        return !!this.settings.imap?.host && !!this.settings.imap?.user;
    }

    clearSettings(): void {
        this.settings = {};
    }
}

export const configService = new ConfigService();
