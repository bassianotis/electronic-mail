# Technical Brief: Email Thread Operations

## Objective

Implement email threading across **all three views** in the mail app: **Inbox**, **Buckets**, and **Archive**. This enables emails in the same conversation to be **grouped together as a single thread** and treated as an atomic unit across all operations.

### Scope

Threading applies to:
- **Inbox** - Unbucketed emails displayed as threads
- **Buckets** - Bucketed emails displayed as threads within each bucket
- **Archive** - Archived emails displayed as threads

### Goals

1. **Thread Grouping**: Group related emails (replies, forwards, same conversation) into threads based on References, In-Reply-To headers, or normalized subject line.

2. **Thread Display in ALL Views**: Display threads as stacked cards with a count badge in **inbox, buckets, AND archive**.

3. **Atomic Operations**: When a thread is moved (inbox→bucket, bucket→archive, archive→inbox, etc.), ALL emails in that thread move together. If any email fails to move, the entire operation fails.

4. **Preserve Existing Behavior**: The inline card expansion behavior MUST be preserved in **inbox**. Clicking an email/thread expands it inline (showing the body inside the card) - NOT in an overlay. Archive view uses overlays (existing behavior).

### Requirements

| Requirement | Description |
|-------------|-------------|
| Backend threading service | Create `threadService.ts` with thread grouping logic and operations |
| Backend API routes | Create `threadRoutes.ts` with REST endpoints for thread operations |
| IMAP multi-folder search | Modify `imapService.ts` to search INBOX and bucket folders when archiving |
| Frontend thread hook | Create `useThreads.ts` hook for thread state management |
| Thread display component | Create `ThreadItem.tsx` with stacked card visual and inline expansion |
| **Inbox integration** | Update `TriageInbox.tsx` to display threads with inline expansion |
| **Bucket integration** | Update `BucketGallery.tsx` to display threads with drag-to-archive |
| **Archive integration** | Update `ArchiveView.tsx` to display threads with drag-to-restore |

### Success Criteria

- [ ] Threads are correctly grouped by conversation in **all three views**
- [ ] Thread count badge shows accurate number of emails
- [ ] Drag-and-drop moves entire thread (all emails) between inbox, buckets, and archive
- [ ] Archive→Inbox AND Archive→Bucket restores ALL emails in thread
- [ ] Bucket→Archive archives ALL emails in thread
- [ ] **Inbox emails expand inline when clicked (NO overlay)**

---

### View Layouts (MUST PRESERVE)

Each view has a distinct layout that MUST NOT be changed when adding threading:

| View | Layout | Click Behavior | Component |
|------|--------|----------------|-----------|
| **Inbox** | Vertical full-width cards with inline expansion | Click expands card inline (NO overlay) | `TriageInbox.tsx` + `InboxItem.tsx` |
| **Buckets** | Gallery grid with smaller cards | Click opens overlay | `BucketGallery.tsx` + `EmailCard.tsx` |
| **Archive** | Vertical list similar to inbox | Click opens overlay | `ArchiveView.tsx` + `ArchiveItem` |

> [!IMPORTANT]
> **Inline expansion only applies to Inbox.** Buckets and Archive use overlays when clicking emails. When adding thread support, preserve these distinct behaviors.

---

> [!CAUTION]
> **CRITICAL: Preserving Inbox Inline Expansion**
> 
> The original inbox behavior uses `InboxItem.tsx` with **inline card expansion** (no overlay). When adding threading:
> - Do NOT change the click handler to call `onSelectEmail()` - that opens the overlay
> - Use `setExpandedEmailId()` to toggle inline expansion state
> - Pass `isExpanded` prop to ThreadItem and render the body inline when expanded

---

## Architecture

### Core Principle: Atomicity

All thread operations are **atomic** - if any email in a thread fails to move, the entire operation fails. This ensures threads never get fragmented.

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `threadService.ts` | `server/src/services/` | Thread grouping, bucketing, archiving logic |
| `threadRoutes.ts` | `server/src/routes/` | API endpoints for thread operations |
| `imapService.ts` | `server/src/services/` | IMAP folder operations (move, copy, search) |
| `useThreads.ts` | `src/hooks/` | Frontend hook for thread state and operations |
| `ThreadItem.tsx` | `src/components/Inbox/` | Thread card component with stacking visual |

---

## Database Schema

### New Columns in `email_metadata`

```sql
ALTER TABLE email_metadata ADD COLUMN thread_id TEXT;
ALTER TABLE email_metadata ADD COLUMN normalized_subject TEXT;
ALTER TABLE email_metadata ADD COLUMN in_reply_to TEXT;
ALTER TABLE email_metadata ADD COLUMN refs TEXT;  -- "references" is reserved
ALTER TABLE email_metadata ADD COLUMN mailbox TEXT;

CREATE INDEX idx_thread_id ON email_metadata(thread_id);
```

### Key Fields

| Column | Purpose |
|--------|---------|
| `thread_id` | Computed identifier grouping emails in same thread |
| `normalized_subject` | Subject stripped of Re:/Fwd: prefixes |
| `in_reply_to` | Message-ID of parent email |
| `refs` | Chain of Message-IDs from References header |
| `original_bucket` | Bucket ID if email is bucketed |
| `date_archived` | ISO timestamp if archived (NULL = not archived) |
| `mailbox` | 'Sent' for sent emails (excluded from bucketing) |

---

## Thread Identification Algorithm

### `computeThreadId()` in threadService.ts

```typescript
function computeThreadId(email: EmailRow): string {
    // Priority 1: Check References header
    if (email.refs) {
        const refs = email.refs.split(/\s+/).filter(r => r.trim());
        for (const ref of refs) {
            const existing = db.get('SELECT thread_id FROM email_metadata WHERE message_id = ?', ref);
            if (existing?.thread_id) return existing.thread_id;
        }
    }
    
    // Priority 2: Check In-Reply-To header
    if (email.in_reply_to) {
        const parent = db.get('SELECT thread_id FROM email_metadata WHERE message_id = ?', email.in_reply_to);
        if (parent?.thread_id) return parent.thread_id;
    }
    
    // Priority 3: Match by normalized subject
    if (email.normalized_subject) {
        const match = db.get(
            'SELECT thread_id FROM email_metadata WHERE normalized_subject = ? AND thread_id IS NOT NULL',
            email.normalized_subject
        );
        if (match?.thread_id) return match.thread_id;
    }
    
    // Fallback: Use own message_id
    return email.message_id;
}
```

### `normalizeSubject()` Helper

```typescript
function normalizeSubject(subject: string): string {
    return subject
        .replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, '')  // Remove prefixes
        .replace(/\s+/g, ' ')                          // Normalize whitespace
        .trim()
        .toLowerCase();
}
```

---

## Backend API Endpoints

### Thread Listing

```
GET /api/threads/inbox
GET /api/threads/bucket/:bucketId
GET /api/threads/archive
```

Response format:
```typescript
{
    threads: ThreadGroup[],
    totalThreads: number,
    totalEmails: number
}
```

### Thread Operations

| Endpoint | Method | Body | Purpose |
|----------|--------|------|---------|
| `/api/threads/:threadId/bucket` | POST | `{ bucketId }` | Move thread to bucket |
| `/api/threads/:threadId/archive` | POST | - | Archive entire thread |
| `/api/threads/:threadId/unarchive` | POST | `{ targetLocation }` | Restore thread from archive |
| `/api/threads/:threadId/unbucket` | POST | - | Move thread back to inbox |
| `/api/threads/:threadId/consolidate` | POST | `{ target: 'archive' \| 'inbox' }` | Repair fragmented thread |

### Maintenance Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/threads/backfill` | POST | Compute thread_ids for existing emails |
| `/api/threads/sync-archive` | POST | Sync IMAP Archive folder with database |
| `/api/threads/sync-sent` | POST | Import sent emails for threading |

---

## IMAP Operations

### archiveEmail() - Multi-Folder Search

```typescript
async archiveEmail(messageId: string) {
    // Check if already in Archives
    const archiveSearch = await client.search('Archives', { header: { 'message-id': messageId } });
    if (archiveSearch.length > 0) return; // Already archived
    
    // Search folders in order
    const folders = ['INBOX', '$label1', '$label2', '$label3', '$label4', '$label5'];
    
    for (const folder of folders) {
        const result = await client.search(folder, { header: { 'message-id': messageId } });
        if (result.length > 0) {
            await client.messageMove(result[0], 'Archives');
            return;
        }
    }
    throw new Error(`Email not found in any folder`);
}
```

### unarchiveEmail()

```typescript
async unarchiveEmail(messageId: string, targetFolder: string = 'INBOX') {
    const result = await client.search('Archives', { header: { 'message-id': messageId } });
    if (result.length > 0) {
        await client.messageMove(result[0], targetFolder);
    }
}
```

---

## Frontend Implementation

### ThreadGroup Type

```typescript
interface ThreadGroup {
    threadId: string;
    count: number;
    latestEmail: {
        messageId: string;
        uid: number;
        subject: string;
        sender: string;
        senderAddress: string;
        date: string;
        preview: string;
    };
    hasNewEmail?: boolean;
    originalBucketId?: string;
}
```

### useThreads Hook

```typescript
const useThreads = () => {
    const [threads, setThreads] = useState<ThreadGroup[]>([]);
    const [threadsLoading, setThreadsLoading] = useState(false);
    
    const fetchInboxThreads = useCallback(async () => {
        setThreadsLoading(true);
        const res = await fetch('/api/threads/inbox');
        const data = await res.json();
        setThreads(data.threads || []);
        setThreadsLoading(false);
    }, []);
    
    const bucketThread = useCallback(async (threadId: string, bucketId: string) => {
        // Optimistic update
        setThreads(prev => prev.filter(t => t.threadId !== threadId));
        await fetch(`/api/threads/${encodeURIComponent(threadId)}/bucket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucketId })
        });
    }, []);
    
    const archiveThread = useCallback(async (threadId: string) => {
        setThreads(prev => prev.filter(t => t.threadId !== threadId));
        await fetch(`/api/threads/${encodeURIComponent(threadId)}/archive`, { method: 'POST' });
    }, []);
    
    return { threads, threadsLoading, fetchInboxThreads, bucketThread, archiveThread };
};
```

---

## TriageInbox Integration

> [!IMPORTANT]
> **Key Pattern: Preserve Inline Expansion**
> 
> The inbox uses `expandedEmailId` state for inline expansion. When adding thread support:
> 
> ```tsx
> // CORRECT - Toggle inline expansion
> const handleThreadClick = (thread: ThreadGroup) => {
>     const emailId = thread.latestEmail.messageId || thread.threadId;
>     setExpandedEmailId(prev => prev === emailId ? null : emailId);
> };
> 
> // WRONG - This opens the overlay, breaking inbox behavior
> const handleThreadClick = (thread: ThreadGroup) => {
>     onSelectEmail(email);  // DON'T DO THIS
> };
> ```

### Adding Thread Toggle

```tsx
// In TriageInbox.tsx
const [useThreadView, setUseThreadView] = useState(true);

// Render toggle button
<button onClick={() => setUseThreadView(!useThreadView)}>
    {useThreadView ? 'Threads' : 'Individual'}
</button>

// Conditionally render threads or individual emails
{useThreadView ? (
    threads.map(thread => (
        <ThreadItem
            thread={thread}
            isExpanded={expandedEmailId === (thread.latestEmail.messageId || thread.threadId)}
            onClick={() => handleThreadClick(thread)}
            onBucket={handleThreadBucket}
            onArchive={handleThreadArchive}
        />
    ))
) : (
    emails.map(email => (
        <InboxItem email={email} isExpanded={expandedEmailId === email.id} ... />
    ))
)}
```

---

## ThreadItem Component

### Visual Stacking Effect

```tsx
// Show tilted cards behind main card when count > 1
{count > 1 && (
    <>
        {count > 2 && <div className="stack-layer-3" style={{ transform: 'rotate(-1deg)' }} />}
        <div className="stack-layer-2" style={{ transform: 'rotate(1deg)' }} />
    </>
)}

// Count badge
{count > 1 && (
    <div className="thread-count-badge">{count}</div>
)}
```

### Inline Expansion in ThreadItem

When `isExpanded` is true:
1. Load email body via `loadEmailBody(emailId)`
2. Render body inside `<ShadowContainer>` with `sanitizeHtml()`
3. Show action bar (Note, Due buttons)
4. Enable sender name/email toggle

---

## SQL Queries

### Get Threaded Emails for Inbox

```sql
SELECT 
    COALESCE(thread_id, message_id) as thread_id,
    MAX(date) as latest_date,
    COUNT(*) as count
FROM email_metadata
WHERE (original_bucket IS NULL OR original_bucket = '')
  AND (date_archived IS NULL OR date_archived = '')
  AND (mailbox IS NULL OR mailbox != 'Sent')
GROUP BY COALESCE(thread_id, message_id)
ORDER BY latest_date DESC
```

### Get Threaded Emails for Bucket

```sql
WHERE original_bucket = ?
  AND (date_archived IS NULL OR date_archived = '')
```

### Get Threaded Emails for Archive

```sql
WHERE date_archived IS NOT NULL AND date_archived != ''
```

---

## Atomic Thread Operations Pattern

```typescript
async archiveThread(threadId: string) {
    // 1. Get all emails in thread
    const emails = await db.all(
        `SELECT message_id FROM email_metadata 
         WHERE COALESCE(thread_id, message_id) = ?
         AND (date_archived IS NULL OR date_archived = '')
         AND (mailbox IS NULL OR mailbox != 'Sent')`,
        [threadId]
    );
    
    // 2. Move each in IMAP (track failures)
    const failed = [];
    for (const email of emails) {
        try {
            await imapService.archiveEmail(email.message_id);
        } catch (err) {
            failed.push(email.message_id);
        }
    }
    
    // 3. If ANY failed, abort (don't update DB)
    if (failed.length > 0) {
        throw new Error(`Thread archive failed: ${failed.length} emails could not be archived`);
    }
    
    // 4. Update database only on 100% success
    await db.run(
        `UPDATE email_metadata SET date_archived = ? WHERE COALESCE(thread_id, message_id) = ?`,
        [new Date().toISOString(), threadId]
    );
}
```

---

## Checklist for Re-Implementation

- [ ] Add database columns and index for threading
- [ ] Create `threadService.ts` with `computeThreadId()` and thread operations
- [ ] Create `threadRoutes.ts` with API endpoints
- [ ] Modify `imapService.ts` `archiveEmail()` to search multiple folders
- [ ] Add `useThreads.ts` hook
- [ ] Create `ThreadItem.tsx` component with stacking visual
- [ ] Update `TriageInbox.tsx`:
  - Add thread toggle state
  - Add `expandedEmailId` state for inline expansion
  - **Keep inline expansion behavior** - use `setExpandedEmailId`, NOT `onSelectEmail`
  - Pass `isExpanded` to ThreadItem
- [ ] Run `/api/threads/backfill` to compute thread_ids for existing emails
