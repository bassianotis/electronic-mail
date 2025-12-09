import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { config } from './config';
import { initDb } from './services/dbService';
import { configService } from './services/configService';
import { connectImap } from './services/imapService';
import { startSyncWorker } from './services/syncWorker';
import ruleRoutes from './routes/ruleRoutes';
import setupRoutes from './routes/setupRoutes';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes';
import { requireAuth } from './middleware/authMiddleware';

// Modular route imports
import inboxRoutes from './routes/inboxRoutes';
import emailsRoutes from './routes/emailsRoutes';
import archiveRoutes from './routes/archiveRoutes';
import bucketRoutes from './routes/bucketRoutes';

const app = express();

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // React requires this
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:"], // WebSockets for HMR
        },
    },
    crossOriginEmbedderPolicy: false, // Allow loading resources from other domains (e.g. images)
}));

app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173', // Allow frontend origin
    credentials: true // Allow cookies
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(cookieParser());

// Log all requests
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    next();
});

app.use('/api/setup', setupRoutes);
app.use('/api/auth', authRoutes);

// Health check (unprotected)
app.get('/api/health', (req, res) => {
    res.send('OK');
});

// Protected routes - modular
app.use('/api/inbox', requireAuth, inboxRoutes);
app.use('/api/emails', requireAuth, emailsRoutes);
app.use('/api/archive', requireAuth, archiveRoutes);
app.use('/api/buckets', requireAuth, bucketRoutes);
app.use('/api/bucket', requireAuth, bucketRoutes); // Legacy path for /api/bucket/:name
app.use('/api/rules', requireAuth, ruleRoutes);

// Legacy sync endpoint
app.post('/api/sync', requireAuth, (req, res, next) => {
    // Forward to inbox routes
    req.url = '/sync';
    inboxRoutes(req, res, next);
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    const path = require('path');
    // Serve static files from the public directory (where frontend build is copied)
    // __dirname is /app/server/dist, so ../../public resolves to /app/public
    app.use(express.static(path.join(__dirname, '../../public')));

    // Handle client-side routing by returning index.html for all non-API routes
    // Express 5 requires named wildcard parameters: {*splat} instead of *
    app.get('/{*splat}', (req: any, res: any) => {
        res.sendFile(path.join(__dirname, '../../public', 'index.html'));
    });
}

const start = async () => {
    try {
        console.log('Starting server...');

        // Security Warning
        if (!process.env.JWT_SECRET) {
            console.warn('\x1b[33m%s\x1b[0m', '⚠️  WARNING: Using default JWT_SECRET. Set JWT_SECRET in .env for production security.');
        }

        await initDb();
        await configService.initialize();

        // Only connect to IMAP if configured
        if (configService.isConfigured()) {
            console.log('IMAP configured, connecting...');
            await connectImap();

            // Start background sync worker to keep DB fresh
            startSyncWorker();
        } else {
            console.log('IMAP not configured. Please complete setup via /api/setup');
        }

        app.listen(config.port, () => {
            console.log(`Server running on port ${config.port}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

start();
