import React, { useState } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import { useMail } from '../../context/MailContext';
import { CreateBucketModal } from '../Buckets/CreateBucketModal';

interface BucketSelectorProps {
    value: string;
    onChange: (bucketId: string) => void;
}

export const BucketSelector: React.FC<BucketSelectorProps> = ({ value, onChange }) => {
    const { buckets, addBucket } = useMail();
    const [isOpen, setIsOpen] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const selectedBucket = buckets.find(b => b.id === value);
    const visibleBuckets = buckets.filter(b => b.id !== 'inbox');

    const handleCreateBucket = (label: string, color: string) => {
        addBucket(label, color);
        // We'll need to select the newly created bucket. 
        // Since addBucket is async/void and doesn't return ID immediately in current context implementation,
        // we might rely on the fact that it will be added to the list.
        // For now, let's just close the modal. The user can select it after it appears.
        // Ideally, addBucket should return the new ID.
        setIsCreateModalOpen(false);
    };

    return (
        <div style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: '#fff',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    fontSize: '14px'
                }}
            >
                {selectedBucket ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            backgroundColor: selectedBucket.color
                        }} />
                        {selectedBucket.label}
                    </div>
                ) : (
                    <span style={{ color: 'var(--color-text-muted)' }}>Select Bucket...</span>
                )}
                <ChevronDown size={16} color="var(--color-text-muted)" />
            </button>

            {isOpen && (
                <>
                    <div
                        style={{
                            position: 'fixed',
                            top: 0, left: 0, right: 0, bottom: 0,
                            zIndex: 100
                        }}
                        onClick={() => setIsOpen(false)}
                    />
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: '4px',
                        backgroundColor: '#fff',
                        borderRadius: '8px',
                        border: '1px solid var(--color-border)',
                        boxShadow: 'var(--shadow-lg)',
                        zIndex: 101,
                        maxHeight: '200px',
                        overflowY: 'auto'
                    }}>
                        {visibleBuckets.map(bucket => (
                            <button
                                key={bucket.id}
                                type="button"
                                onClick={() => {
                                    onChange(bucket.id);
                                    setIsOpen(false);
                                }}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    fontSize: '14px',
                                    color: 'var(--color-text-main)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                <div style={{
                                    width: '12px',
                                    height: '12px',
                                    borderRadius: '50%',
                                    backgroundColor: bucket.color
                                }} />
                                {bucket.label}
                            </button>
                        ))}

                        <div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '4px 0' }} />

                        <button
                            type="button"
                            onClick={() => {
                                setIsCreateModalOpen(true);
                                setIsOpen(false);
                            }}
                            style={{
                                width: '100%',
                                padding: '8px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                textAlign: 'left',
                                fontSize: '14px',
                                color: 'var(--color-primary)',
                                fontWeight: 500
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Plus size={14} />
                            Create New Bucket
                        </button>
                    </div>
                </>
            )}

            <CreateBucketModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSave={handleCreateBucket}
            />
        </div>
    );
};
