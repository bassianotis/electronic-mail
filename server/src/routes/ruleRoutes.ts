import { Router } from 'express';
import { getDb } from '../services/dbService';

const router = Router();

// Simple ID generator
const generateId = () => `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Get all rules
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const rules = await db.all('SELECT * FROM email_rules ORDER BY created_at DESC');
        res.json(rules);
    } catch (err) {
        console.error('Error fetching rules:', err);
        res.status(500).json({ error: 'Failed to fetch rules' });
    }
});

// Create new rule
router.post('/', async (req, res) => {
    try {
        const { senderPattern, bucketId } = req.body;

        if (!senderPattern || !bucketId) {
            return res.status(400).json({ error: 'senderPattern and bucketId are required' });
        }

        const db = getDb();
        const id = generateId();
        const createdAt = new Date().toISOString();

        await db.run(
            'INSERT INTO email_rules (id, sender_pattern, bucket_id, created_at) VALUES (?, ?, ?, ?)',
            [id, senderPattern, bucketId, createdAt]
        );

        res.json({ id, sender_pattern: senderPattern, bucket_id: bucketId, created_at: createdAt });
    } catch (err) {
        console.error('Error creating rule:', err);
        res.status(500).json({ error: 'Failed to create rule' });
    }
});

// Delete rule
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();

        await db.run('DELETE FROM email_rules WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting rule:', err);
        res.status(500).json({ error: 'Failed to delete rule' });
    }
});

export default router;
