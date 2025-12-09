import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ShadowContainerProps {
    children: React.ReactNode;
    style?: React.CSSProperties;
    className?: string;
}

export const ShadowContainer: React.FC<ShadowContainerProps> = ({ children, style, className }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);

    useEffect(() => {
        if (containerRef.current && !shadowRoot) {
            let shadow = containerRef.current.shadowRoot;

            if (!shadow) {
                shadow = containerRef.current.attachShadow({ mode: 'open' });

                // Inject base styles only when creating new shadow root
                const styleSheet = new CSSStyleSheet();
                styleSheet.replaceSync(`
                    :host { display: block; }
                    * { box-sizing: border-box; }
                    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
                    img { max-width: 100%; height: auto; }
                `);
                shadow.adoptedStyleSheets = [styleSheet];
            }

            setShadowRoot(shadow);
        }
    }, []);

    return (
        <div ref={containerRef} style={style} className={className}>
            {shadowRoot && createPortal(children, shadowRoot as any)}
        </div>
    );
};
