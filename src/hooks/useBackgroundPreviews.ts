/**
 * useBackgroundPreviews hook
 * 
 * Handles background loading of email previews with throttling.
 * Used by inbox, bucket gallery, archive, and search views.
 */

import { useEffect, useRef } from 'react';
import type { Email } from '../store/mailStore';

interface UseBackgroundPreviewsOptions {
    /** Function to load email body (returns void, updates state via event) */
    loadEmailBody: (id: string, uid?: string) => Promise<void | { html: string; text?: string }>;
    /** Delay before starting background loading (ms) */
    startDelay?: number;
    /** Delay between loading each email (ms) */
    throttleDelay?: number;
    /** Whether to enable background loading */
    enabled?: boolean;
}

/**
 * Hook that handles background loading of email previews.
 * Emails without a preview (body === '<p>Loading body...</p>') are loaded with throttling.
 * 
 * @example
 * ```tsx
 * const { loadEmailBody } = useMail();
 * useBackgroundPreviews(emails, { loadEmailBody });
 * ```
 */
export function useBackgroundPreviews(
    emails: Email[],
    options: UseBackgroundPreviewsOptions
): void {
    const {
        loadEmailBody,
        startDelay = 1000,
        throttleDelay = 500,
        enabled = true
    } = options;

    const loadingRef = useRef(false);
    const cancelledRef = useRef(false);

    useEffect(() => {
        if (!enabled || emails.length === 0) return;

        cancelledRef.current = false;

        const loadPreviewsInBackground = async () => {
            if (loadingRef.current) return;
            loadingRef.current = true;

            // Find emails that need previews
            const emailsNeedingPreviews = emails.filter(
                email => !email.preview && email.body === '<p>Loading body...</p>'
            );

            if (emailsNeedingPreviews.length === 0) {
                loadingRef.current = false;
                return;
            }

            // Load previews with throttling
            for (const email of emailsNeedingPreviews) {
                if (cancelledRef.current) break;

                try {
                    await loadEmailBody(email.id, email.uid);
                    // Wait before next request to avoid overwhelming the server
                    await new Promise(resolve => setTimeout(resolve, throttleDelay));
                } catch (err) {
                    console.error(`Failed to load preview for ${email.id}:`, err);
                }
            }

            loadingRef.current = false;
        };

        // Delay start to let initial UI render
        const timer = setTimeout(loadPreviewsInBackground, startDelay);

        return () => {
            cancelledRef.current = true;
            clearTimeout(timer);
        };
    }, [emails.length, loadEmailBody, startDelay, throttleDelay, enabled]);
}

export default useBackgroundPreviews;
