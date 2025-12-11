# Technical Brief: Email Thread Operations

## Overview

This document describes the technical implementation of email thread operations in the mail app. Threads are groups of related emails (same conversation) that must **always move together** across inbox, buckets, and archive.

---

## Architecture

### Core Principle: Atomicity

All thread operations are **atomic** - if any email in a thread fails to move, the entire operation fails. This ensures threads never get fragmented (some emails in inbox, others in archive).

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `threadService.ts` | `server/src/services/` | Thread grouping, bucketing, archiving logic |
| `threadRoutes.ts` | `server/src/routes/` | API endpoints for thread operations |
| `imapService.ts` | `server/src/services/` | IMAP folder operations (move, copy, search) |
| `useThreads.ts` | `src/hooks/` | Frontend hook for thread state and operations |

---

## Thread Identification

### How Threads are Grouped

Emails are grouped into threads using `computeThreadId()` with priority:
1. **References header** - Check if any referenced message has a thread_id
2. **In-Reply-To header** - Check parent message's thread_id  
3. **Normalized subject** - Match emails with same subject (stripped of Re:/Fwd:)
4. **Fallback** - Use own message_id as thread_id

### Database Schema

```sql
email_metadata:
  - thread_id: string (computed thread identifier)
  - normalized_subject: string (subject without Re:/Fwd:)
  - in_reply_to: string (parent message-id)
  - references: string (chain of message-ids)
  - original_bucket: string (bucket assignment)
  - date_archived: string (ISO timestamp if archived)
```

---

## Thread Operations

### 1. Move Thread to Bucket
**Endpoint:** `POST /api/threads/:threadId/bucket`
**Service:** `threadService.moveThreadToBucket()`

- Assigns IMAP label/flag to ALL emails in thread
- Updates `original_bucket` in database for all emails

### 2. Archive Thread
**Endpoint:** `POST /api/threads/:threadId/archive`  
**Service:** `threadService.archiveThread()`

Process:
1. Find all non-archived, non-sent emails with matching thread_id
2. Move each email to IMAP "Archives" folder
3. **If any fail**, operation aborts (atomicity)
4. Update `date_archived` in database for all emails

### 3. Unarchive Thread
**Endpoint:** `POST /api/threads/:threadId/unarchive`
**Service:** `threadService.unarchiveThread()`

Process:
1. Find all archived emails with matching thread_id
2. Move each email from "Archives" back to INBOX (or bucket)
3. Clear `date_archived` in database

### 4. Unbucket Thread
**Endpoint:** `POST /api/threads/:threadId/unbucket`
**Service:** `threadService.unbucketThread()`

- Clears `original_bucket` for all emails in thread
- Emails return to inbox view

### 5. Consolidate Thread (Repair)
**Endpoint:** `POST /api/threads/:threadId/consolidate`
**Service:** `threadService.consolidateThread()`

Repair function for fragmented threads:
- Moves ALL emails to specified target (archive or inbox)
- Used when thread got split due to bugs or manual intervention

---

## IMAP Multi-Folder Search

When archiving, `archiveEmail()` searches multiple folders:
1. INBOX (primary)
2. $label1 through $label5 (bucket folders)
3. Archives (to check if already archived)

This handles email providers that use virtual folders or labels.

---

## Frontend Integration

### Optimistic Updates

All thread operations use optimistic UI updates:
- Item disappears immediately from current view
- API call happens in background
- If fails, ideally would rollback (TODO)

### Thread Display

- `ThreadItem.tsx` - Displays thread as stacked card with count badge
- `threadCount` property indicates emails in thread
- Visual "stack" effect shows 1-2 tilted cards behind main card

---

## Sync & Maintenance Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/threads/backfill` | Compute thread_ids for existing emails |
| `POST /api/threads/sync-archive` | Sync IMAP Archive folder with database |
| `POST /api/threads/sync-sent` | Import sent emails for thread grouping |

---

## Known Considerations

1. **Date filtering**: App filters emails by sync start date - older emails may not appear
2. **Sent emails**: Marked with `mailbox='Sent'` and excluded from bucketing/archiving
3. **IMAP variations**: Different providers handle folders/labels differently
