import express, { Router } from 'express';
import { ImapFlow } from 'imapflow';
import { configService } from '../services/configService';
import { reconnectImap } from '../services/imapService';

const router: Router = express.Router();

// Check if the app is configured
router.get('/status', async (req, res) => {
    try {
        const isConfigured = configService.isConfigured();
        const settings = configService.getSettings();

        res.json({
            configured: isConfigured,
            hasImapConfig: !!settings.imap,
            hasSyncSettings: !!settings.sync
        });
    } catch (error) {
        console.error('Error checking setup status:', error);
        res.status(500).json({ error: 'Failed to check setup status' });
    }
});

// Validate IMAP credentials without saving
router.post('/validate', async (req, res) => {
    try {
        const { host, port, secure, user, password } = req.body;

        if (!host || !port || !user || !password) {
            return res.status(400).json({
                valid: false,
                error: 'Missing required fields: host, port, user, password'
            });
        }

        // Try to connect with the provided credentials
        const testClient = new ImapFlow({
            host,
            port: parseInt(port),
            secure: secure !== false,
            auth: { user, pass: password },
            logger: false
        });

        try {
            await testClient.connect();
            await testClient.logout();

            res.json({
                valid: true,
                message: 'Credentials validated successfully'
            });
        } catch (error: any) {
            console.error('IMAP Validation Error:', error);

            // Check for specific error codes
            if (error.responseStatus === 'NO' && error.responseText && error.responseText.includes('Temporary authentication failure')) {
                res.json({
                    valid: false,
                    error: 'Temporary authentication failure. This usually means too many concurrent connections to your email provider. Please wait a few minutes and try again.'
                });
                return;
            }

            const errorMessage = error.responseStatus ?
                `${error.message} (Server says: ${error.responseStatus})` :
                error.message || 'Failed to connect to IMAP server';

            res.json({
                valid: false,
                error: errorMessage
            });
        } finally {
            // Always ensure we try to close the connection
            if (testClient) {
                try {
                    await testClient.logout();
                } catch (e) {
                    // Ignore logout errors
                }
            }
        }
    } catch (error: any) {
        console.error('Error validating credentials:', error);
        res.status(500).json({
            valid: false,
            error: 'Server error during validation'
        });
    }
});

// Save configuration and reconnect
router.post('/save', async (req, res) => {
    try {
        const {
            host,
            port,
            secure,
            user,
            password,
            startDate,
            displayName,
            importStarred,
            sentFolderName
        } = req.body;

        if (!host || !port || !user || !password) {
            return res.status(400).json({
                success: false,
                error: 'Missing required IMAP credentials'
            });
        }

        // Save IMAP config
        await configService.saveSetting('imap', {
            host,
            port: parseInt(port),
            secure: secure !== false,
            user,
            password
        });

        // Save sync settings if provided
        if (startDate || displayName || importStarred !== undefined || sentFolderName !== undefined) {
            await configService.saveSetting('sync', {
                startDate: startDate || undefined,
                displayName: displayName || undefined,
                importStarred: importStarred !== undefined ? importStarred : true,
                sentFolderName: sentFolderName || undefined
            });
        }

        // Save web access password if provided
        if (req.body.webPassword) {
            const { authService } = await import('../services/authService');
            const passwordHash = await authService.hashPassword(req.body.webPassword);
            await configService.saveSetting('auth', {
                passwordHash
            });

            // Generate and set auth token immediately so user is logged in
            const token = authService.generateToken({ role: 'admin' });
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000, // 24 hours
                sameSite: 'lax'
            });
        }

        // Reconnect IMAP with new credentials
        try {
            await reconnectImap();
            // Start background sync immediately
            const { startSyncWorker } = await import('../services/syncWorker');
            startSyncWorker();
        } catch (error: any) {
            return res.status(500).json({
                success: false,
                error: 'Configuration saved but failed to connect to IMAP: ' + error.message
            });
        }

        // Return success immediately so frontend can show confirmation screen
        res.json({
            success: true,
            message: 'Configuration saved and IMAP connected successfully'
        });

        // Run bucket discovery and data sync in background
        // This happens WHILE user is viewing the confirmation screen
        (async () => {
            console.log('🔍 Starting background bucket discovery...');
            try {
                const { imapService } = await import('../services/imapService');
                const discoveryResult = await imapService.discoverAndCreateBuckets();
                console.log(`📊 Discovery complete: ${discoveryResult.created} buckets created`);
            } catch (error: any) {
                console.error('⚠️ Bucket discovery failed:', error.message);
            }

            console.log('🚀 Starting background data preload...');
            try {
                const { syncAllBuckets } = await import('../services/syncWorker');
                await syncAllBuckets();
                console.log('✅ Background preload complete - data ready!');
            } catch (e) {
                console.error('⚠️ Preload failed:', e);
            }
        })();
    } catch (error: any) {
        console.error('Error saving configuration:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save configuration: ' + error.message
        });
    }
});

// Manually trigger bucket discovery
router.post('/discover-buckets', async (req, res) => {
    try {
        const { imapService } = await import('../services/imapService');
        const result = await imapService.discoverAndCreateBuckets();

        res.json({
            success: true,
            discovered: result.discovered,
            created: result.created,
            message: `Discovered ${result.discovered} bucket flags, created ${result.created} new buckets`
        });
    } catch (error: any) {
        console.error('Error discovering buckets:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to discover buckets: ' + error.message
        });
    }
});

// Logout - Clear configuration
router.post('/logout', async (req, res) => {
    try {
        const { getDb } = await import('../services/dbService');
        const db = getDb();

        // Clear all user data and configuration
        await db.run('DELETE FROM app_settings');
        await db.run('DELETE FROM buckets');
        await db.run('DELETE FROM email_rules');
        await db.run('DELETE FROM email_metadata');

        // Reset in-memory config
        configService.clearSettings();

        // Also try to disconnect IMAP if possible
        try {
            const { imapService } = await import('../services/imapService');
            await imapService.disconnect();
        } catch (e) {
            console.error('Error disconnecting IMAP:', e);
        }

        res.json({
            success: true,
            message: 'Logged out successfully. All local data cleared. Please restart the server.'
        });
    } catch (error: any) {
        console.error('Error logging out:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to logout: ' + error.message
        });
    }
});

// Export Data - Backup local data
router.get('/export', async (req, res) => {
    try {
        const { getDb } = await import('../services/dbService');
        const db = getDb();

        const buckets = await db.all('SELECT * FROM buckets');
        const rules = await db.all('SELECT * FROM email_rules');
        const metadata = await db.all('SELECT * FROM email_metadata');

        // Also export sync settings (but NOT credentials)
        const settings = await db.all('SELECT * FROM app_settings WHERE key = "sync"');

        const exportData = {
            version: 1,
            timestamp: new Date().toISOString(),
            buckets,
            rules,
            metadata,
            settings
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=mail-backup-${new Date().toISOString().split('T')[0]}.json`);
        res.json(exportData);
    } catch (error: any) {
        console.error('Error exporting data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export data: ' + error.message
        });
    }
});

// Import Data - Restore local data
router.post('/import', async (req, res) => {
    try {
        const { getDb } = await import('../services/dbService');
        const db = getDb();
        const data = req.body;

        if (!data || !data.version) {
            return res.status(400).json({
                success: false,
                error: 'Invalid backup file format'
            });
        }

        // Transaction to ensure all or nothing
        await db.run('BEGIN TRANSACTION');

        try {
            // Restore Buckets
            if (data.buckets && Array.isArray(data.buckets)) {
                for (const bucket of data.buckets) {
                    await db.run(
                        'INSERT OR REPLACE INTO buckets (id, label, color, count, sort_order) VALUES (?, ?, ?, ?, ?)',
                        [bucket.id, bucket.label, bucket.color, bucket.count, bucket.sort_order]
                    );
                }
            }

            // Restore Rules
            if (data.rules && Array.isArray(data.rules)) {
                for (const rule of data.rules) {
                    await db.run(
                        'INSERT OR REPLACE INTO email_rules (id, sender_pattern, bucket_id, created_at) VALUES (?, ?, ?, ?)',
                        [rule.id, rule.sender_pattern, rule.bucket_id, rule.created_at]
                    );
                }
            }

            // Restore Metadata
            if (data.metadata && Array.isArray(data.metadata)) {
                for (const meta of data.metadata) {
                    await db.run(
                        'INSERT OR REPLACE INTO email_metadata (message_id, notes, due_date, date_archived, original_bucket, rules_processed, preview) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [meta.message_id, meta.notes, meta.due_date, meta.date_archived, meta.original_bucket, meta.rules_processed, meta.preview]
                    );
                }
            }

            // Restore Sync Settings
            if (data.settings && Array.isArray(data.settings)) {
                for (const setting of data.settings) {
                    await db.run(
                        'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
                        [setting.key, setting.value, setting.updated_at]
                    );
                }
            }

            await db.run('COMMIT');

            res.json({
                success: true,
                message: 'Data imported successfully'
            });
        } catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }
    } catch (error: any) {
        console.error('Error importing data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to import data: ' + error.message
        });
    }
});

// Get sync settings (for Settings modal)
router.get('/sync-settings', async (req, res) => {
    try {
        const syncSettings = configService.getSyncSettings();
        const smtpConfig = configService.getSmtpConfig();

        // Return sync settings with SMTP config (without password for security)
        res.json({
            ...syncSettings,
            smtp: smtpConfig ? {
                host: smtpConfig.host,
                port: smtpConfig.port,
                secure: smtpConfig.secure,
                user: smtpConfig.user
                // Don't send password to frontend
            } : undefined
        });
    } catch (error: any) {
        console.error('Error getting sync settings:', error);
        res.status(500).json({ error: 'Failed to get sync settings' });
    }
});

// Update sync settings (from Settings modal)
router.put('/sync-settings', async (req, res) => {
    try {
        const { startDate, displayName, importStarred, sentFolderName, smtp } = req.body;

        // Merge with existing settings
        const currentSettings = configService.getSyncSettings();
        const updatedSettings = {
            ...currentSettings,
            startDate: startDate !== undefined ? startDate : currentSettings.startDate,
            displayName: displayName !== undefined ? displayName : currentSettings.displayName,
            importStarred: importStarred !== undefined ? importStarred : currentSettings.importStarred,
            sentFolderName: sentFolderName !== undefined ? sentFolderName : currentSettings.sentFolderName
        };

        await configService.saveSetting('sync', updatedSettings);

        // Save SMTP config if provided
        if (smtp && smtp.host) {
            const currentSmtp = configService.getSmtpConfig();
            const updatedSmtp = {
                host: smtp.host,
                port: smtp.port || 587,
                secure: smtp.secure || false,
                user: smtp.user || currentSmtp?.user || '',
                // Only update password if provided (non-empty)
                password: smtp.password || currentSmtp?.password || ''
            };
            await configService.saveSetting('smtp', updatedSmtp);
        }

        res.json({
            success: true,
            settings: updatedSettings
        });
    } catch (error: any) {
        console.error('Error updating sync settings:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update sync settings: ' + error.message
        });
    }
});

export default router;
