/**
 * useRules Hook
 * Manages email rules (auto-bucketing by sender)
 */
import { useState, useCallback } from 'react';
import { type Rule } from '../store/mailStore';

export interface UseRulesReturn {
    rules: Rule[];
    setRules: React.Dispatch<React.SetStateAction<Rule[]>>;
    addRule: (senderPattern: string, bucketId: string) => Promise<void>;
    deleteRule: (id: string) => Promise<void>;
    fetchRules: () => Promise<void>;
}

export function useRules(): UseRulesReturn {
    const [rules, setRules] = useState<Rule[]>([]);

    const fetchRules = useCallback(async () => {
        try {
            const res = await fetch('/api/rules');
            if (res.ok) {
                const data = await res.json();
                setRules(data);
            } else {
                console.error('Failed to fetch rules:', res.status);
            }
        } catch (err) {
            console.error('Error fetching rules:', err);
        }
    }, []);

    const addRule = useCallback(async (senderPattern: string, bucketId: string) => {
        try {
            const res = await fetch('/api/rules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senderPattern, bucketId })
            });
            if (res.ok) {
                const newRule = await res.json();
                setRules(prev => [newRule, ...prev]);
            } else {
                console.error('Failed to add rule:', res.status);
            }
        } catch (err) {
            console.error('Failed to add rule:', err);
        }
    }, []);

    const deleteRule = useCallback(async (id: string) => {
        try {
            await fetch(`/api/rules/${id}`, { method: 'DELETE' });
            setRules(prev => prev.filter(r => r.id !== id));
        } catch (err) {
            console.error('Failed to delete rule:', err);
        }
    }, []);

    return {
        rules,
        setRules,
        addRule,
        deleteRule,
        fetchRules
    };
}
