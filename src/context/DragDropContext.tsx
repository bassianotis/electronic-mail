import { createContext, useContext, useState, type ReactNode } from 'react';

interface DragDropContextType {
    isDragging: boolean;
    setIsDragging: (isDragging: boolean) => void;
    hoveredBucketId: string | null;
    setHoveredBucketId: (id: string | null) => void;
}

const DragDropContext = createContext<DragDropContextType | undefined>(undefined);

export const DragDropProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredBucketId, setHoveredBucketId] = useState<string | null>(null);

    return (
        <DragDropContext.Provider value={{ isDragging, setIsDragging, hoveredBucketId, setHoveredBucketId }}>
            {children}
        </DragDropContext.Provider>
    );
};

export const useDragDrop = () => {
    const context = useContext(DragDropContext);
    if (!context) {
        throw new Error('useDragDrop must be used within a DragDropProvider');
    }
    return context;
};
