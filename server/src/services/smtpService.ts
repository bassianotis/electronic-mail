/**
 * SMTP Service
 * Handles sending emails via SMTP using Nodemailer
 */
import nodemailer from 'nodemailer';
import { configService } from './configService';
import { imapService } from './imapService';
import { db } from './dbService';

// Normalize subject for threading (same as threadService)
function normalizeSubject(subject: string): string {
    if (!subject) return '';
    return subject
        .replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export interface EmailToSend {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html: string;
    text?: string;
    inReplyTo?: string;
    references?: string;
    attachments?: Array<{
        filename: string;
        content: Buffer | string;
        contentType?: string;
    }>;
}

export interface SendResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

/**
 * Create SMTP transporter with current config
 */
const createTransporter = () => {
    const smtpConfig = configService.getSmtpConfig();
    if (!smtpConfig) {
        throw new Error('SMTP not configured');
    }

    console.log(`[SMTP] Creating transporter: host=${smtpConfig.host}, port=${smtpConfig.port}, secure=${smtpConfig.secure}`);

    // secure=true for port 465 (implicit TLS)
    // secure=false for port 587 (STARTTLS) - Nodemailer upgrades automatically
    const useSecure = smtpConfig.secure === true || smtpConfig.port === 465;

    return nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: useSecure,  // false for 587 (STARTTLS), true for 465
        auth: {
            user: smtpConfig.user,
            pass: smtpConfig.password
        },
        tls: {
            rejectUnauthorized: false // Allow self-signed certs
        }
    });
};

/**
 * Send an email via SMTP and copy to Sent folder
 */
export const sendEmail = async (email: EmailToSend): Promise<SendResult> => {
    const smtpConfig = configService.getSmtpConfig();
    if (!smtpConfig) {
        return { success: false, error: 'SMTP not configured' };
    }

    try {
        const transporter = createTransporter();

        // Build mail options
        const mailOptions: nodemailer.SendMailOptions = {
            from: smtpConfig.user,
            to: email.to.join(', '),
            cc: email.cc?.join(', '),
            bcc: email.bcc?.join(', '),
            subject: email.subject,
            html: email.html,
            text: email.text || email.html.replace(/<[^>]*>?/gm, ''),
            inReplyTo: email.inReplyTo,
            references: email.references,
            attachments: email.attachments?.map(att => ({
                filename: att.filename,
                content: att.content,
                contentType: att.contentType
            }))
        };

        console.log(`[SMTP] Sending email to ${email.to.join(', ')}...`);
        const info = await transporter.sendMail(mailOptions);
        console.log(`[SMTP] Email sent successfully: ${info.messageId}`);

        // IMMEDIATELY save to database for instant thread appearance
        const syncSettings = configService.getSyncSettings();
        const senderName = syncSettings.displayName || smtpConfig.user;
        const normalizedSubj = normalizeSubject(email.subject);
        const recipientDisplay = email.to[0] || 'Unknown';

        try {
            await db.query(`
                INSERT INTO email_metadata (
                    message_id, subject, normalized_subject, sender, sender_address, 
                    date, snippet, mailbox, body_html, body_text
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Sent', ?, ?)
                ON CONFLICT(message_id) DO UPDATE SET
                    body_html = excluded.body_html,
                    body_text = excluded.body_text
            `, [
                info.messageId,
                email.subject,
                normalizedSubj,
                senderName,
                smtpConfig.user,
                new Date().toISOString(),
                `To: ${recipientDisplay}`,
                email.html,
                email.text || email.html.replace(/<[^>]*>?/gm, '')
            ]);
            console.log('[SMTP] Email saved to database immediately');
        } catch (dbErr) {
            console.error('[SMTP] Failed to save email to DB:', dbErr);
            // Don't fail - email was still sent
        }

        // Copy to Sent folder via IMAP (for other email clients to see)
        try {
            await imapService.copyToSentFolder(email, info.messageId || undefined);
            console.log('[SMTP] Email copied to Sent folder');
        } catch (copyErr) {
            console.error('[SMTP] Failed to copy to Sent folder:', copyErr);
            // Don't fail the whole operation if copy fails
        }

        return {
            success: true,
            messageId: info.messageId
        };
    } catch (err: any) {
        console.error('[SMTP] Error sending email:', err);
        return {
            success: false,
            error: err.message || 'Failed to send email'
        };
    }
};

export const smtpService = {
    sendEmail
};
