/**
 * Extract the first meaningful paragraph from HTML content for email preview
 */
export function extractFirstParagraph(html: string, maxLength: number = 150): string {
    if (!html) return '';

    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Remove script and style elements
    const scripts = tempDiv.querySelectorAll('script, style');
    scripts.forEach(el => el.remove());

    // Try to find the first paragraph
    const paragraphs = tempDiv.querySelectorAll('p');

    for (const p of Array.from(paragraphs)) {
        const text = p.textContent?.trim() || '';

        // Skip if it's too short - we want at least 20 characters of meaningful content
        if (text.length < 20) continue;

        // Skip common email footers/headers patterns
        const skipPatterns = [
            /unsubscribe/i,
            /view.*browser/i,
            /click here/i,
            /^https?:\/\//,
            /^www\./,
            /privacy policy/i,
            /terms of service/i,
            /^©/,
            /all rights reserved/i
        ];

        const shouldSkip = skipPatterns.some(pattern => pattern.test(text));
        if (shouldSkip) continue;

        // This looks like a good paragraph, use it
        if (text.length > maxLength) {
            return text.substring(0, maxLength).trim() + '...';
        }
        return text;
    }

    // If no good paragraph found, try getting first meaningful text from any element
    const allText = tempDiv.textContent?.trim() || '';
    const lines = allText.split('\n').map(line => line.trim()).filter(line => line.length >= 20);

    if (lines.length > 0) {
        const firstLine = lines[0];
        if (firstLine.length > maxLength) {
            return firstLine.substring(0, maxLength).trim() + '...';
        }
        return firstLine;
    }

    return '';
}

/**
 * Extract clean content for reader mode (like Safari Reader or Pocket)
 * Removes clutter (logos, buttons, footers) and returns just paragraphs and headers
 * Preserves images, links, and inline formatting (bold, italic, etc)
 */
export function extractReaderContent(html: string): string {
    if (!html) return '';

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Remove clutter elements (but keep images and links!)
    const removeSelectors = [
        'script',
        'style',
        'button',        // Remove buttons
        'input',
        'form',
        'svg',           // Remove logos/icons
        'header',        // Remove email headers
        'footer',        // Remove footers
        'nav',
        '[role="banner"]',
        '[role="navigation"]',
        '[role="contentinfo"]',
        '.footer',
        '.header',
        '.logo',
        '.unsubscribe',
        '[style*="display: none"]',
        '[style*="display:none"]',
        '[style*="font-size: 1px"]',  // Tracking pixels
        '[style*="font-size:1px"]',
        'a[href*="unsubscribe"]',
        'img[width="1"]',     // Only remove tracking pixels
        'img[height="1"]'
    ];

    removeSelectors.forEach(selector => {
        try {
            tempDiv.querySelectorAll(selector).forEach(el => el.remove());
        } catch (e) {
            // Skip invalid selectors
        }
    });

    // Extract elements in document order (text + images)
    const contentElements: string[] = [];

    // Helper function to recursively extract content while preserving order
    const extractFromElement = (element: Element) => {
        // Process all child nodes in order
        Array.from(element.children).forEach(child => {
            const tagName = child.tagName.toLowerCase();

            // Handle images
            if (tagName === 'img') {
                const width = parseInt(child.getAttribute('width') || '0');
                const height = parseInt(child.getAttribute('height') || '0');

                // Skip small images (likely icons or logos)
                if ((width > 0 && width < 50) || (height > 0 && height < 50)) {
                    return;
                }

                // Keep the image
                contentElements.push(child.outerHTML);
                return;
            }

            // Handle text elements
            if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(tagName)) {
                const text = child.textContent?.trim() || '';

                // Skip if too short or looks like spam
                if (text.length < 10) {
                    // But still recurse in case there are images inside
                    extractFromElement(child);
                    return;
                }

                const skipPatterns = [
                    /^(unsubscribe|view.*browser|click here|privacy policy|terms of service)$/i,
                    /^©\s*\d{4}/,
                    /^all rights reserved$/i,
                    /^https?:\/\/[^\s]+$/,
                    /^www\.[^\s]+$/
                ];

                if (skipPatterns.some(pattern => pattern.test(text))) {
                    return;
                }

                // Keep the element with its formatting
                const innerHTML = child.innerHTML.trim();
                contentElements.push(`<${tagName}>${innerHTML}</${tagName}>`);
                return;
            }

            // Handle list items
            if (tagName === 'li') {
                const text = child.textContent?.trim() || '';
                if (text.length >= 10) {
                    contentElements.push(`<li>${child.innerHTML.trim()}</li>`);
                }
                return;
            }

            // For other containers (div, section, etc.), recurse into them
            if (child.children.length > 0) {
                extractFromElement(child);
            }
        });
    };

    // Start extraction from the root
    extractFromElement(tempDiv);

    return contentElements.join('');
}
