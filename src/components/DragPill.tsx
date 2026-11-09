/** The "New" drag's pill (utils/dragPill.ts): its face, and the one element that follows the pointer. */
import React, { useEffect, useRef } from 'react';
import { dragPill, pillStyle } from '../utils/dragPill';

/** The pill's face: also what the fly-in carries into the target. */
export const PillFace: React.FC<{ subject: string }> = ({ subject }) => <div style={pillStyle}>{subject || 'No subject'}</div>;

export const DragPillLayer: React.FC = () => {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        dragPill.attach(ref.current);
        return () => dragPill.attach(null);
    }, []);
    return <div ref={ref} aria-hidden="true" style={{ ...pillStyle, position: 'fixed', left: 0, top: 0, display: 'none', zIndex: 10000, pointerEvents: 'none' }} />;
};
