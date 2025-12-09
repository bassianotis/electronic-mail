# PRD: Email Composition and Sending

---

## Objectives

Enable users to compose and send emails with core email functionality, including:
- Composing new emails from scratch (plain text)
- Replying to and forwarding existing emails
- Managing recipients (To, CC, BCC)
- Thread-based email organization
- Reliable delivery and storage of sent emails

---

## User Stories

### Core Composition
- As a user, I want to compose a new email from scratch so I can initiate conversations
- As a user, I want to reply to an email so I can respond to incoming messages
- As a user, I want to reply-all to an email so I can respond to everyone in the conversation
- As a user, I want to forward an email so I can share information with others
- As a user, I want to save drafts automatically so I don't lose my work

### Recipients
- As a user, I want to add multiple recipients in To, CC, and BCC fields so I can control who receives the email
- As a user, I want to see recipient validation so I know if an email address is invalid

### Content
- As a user, I want to set and edit the subject line so my emails have clear topics
- As a user, I want to attach files to my emails so I can share documents and media

### Threading & Organization
- As a user, I want to view emails in threaded conversations so I can follow the discussion context
- As a user, I want my sent emails to appear in the appropriate thread so I can see the full conversation history
- As a user, I want sent emails stored in my Sent folder so I can reference them later
- As a user, I want to see my draft emails so I can return to unfinished compositions

---

## Functional Requirements

### 1. Compose New Email
**Priority**: P0 (Must Have)

- [ ] Open a new composition panel
- [ ] Add recipients to To field (required)
- [ ] Add recipients to CC field (optional)
- [ ] Add recipients to BCC field (optional)
- [ ] Set subject line (required)
- [ ] Write email body
- [ ] Send email
- [ ] Discard email
- [ ] Save as draft (manual or automatic)

**Validation**:
- At least one recipient in To field
- Valid email address format for all recipients
- Subject line recommended but not required

### 2. Reply to Email
**Priority**: P0 (Must Have)

- [ ] Open reply composition from an existing email
- [ ] Pre-populate recipient (original sender)
- [ ] Pre-populate subject line with "Re: [original subject]"
- [ ] Include original message in body (quoted/collapsed)
- [ ] Preserve original HTML/rich text formatting from email being replied to
- [ ] Maintain thread relationship

### 3. Reply-All to Email
**Priority**: P0 (Must Have)

- [ ] Open reply-all composition from an existing email
- [ ] Pre-populate all original recipients (To + CC)
- [ ] Exclude self from recipient list
- [ ] Pre-populate subject line with "Re: [original subject]"
- [ ] Include original message in body
- [ ] Maintain thread relationship

### 4. Forward Email
**Priority**: P1 (Should Have)

- [ ] Open forward composition from an existing email
- [ ] Clear To field (user must add recipients)
- [ ] Pre-populate subject line with "Fwd: [original subject]"
- [ ] Include original message with headers (From, Date, Subject, To)
- [ ] Preserve original HTML/rich text formatting from forwarded email
- [ ] Preserve original attachments
- [ ] Break thread relationship (new conversation)

### 5. Recipient Management
**Priority**: P0 (Must Have)

- [ ] Add multiple recipients to each field
- [ ] Remove recipients from fields
- [ ] Validate email address format
- [ ] Show validation errors inline
- [ ] Toggle CC/BCC field visibility

### 6. Subject Line
**Priority**: P0 (Must Have)

- [ ] Set subject line for new emails
- [ ] Edit subject line
- [ ] Auto-populate subject for replies/forwards
- [ ] Allow editing auto-populated subjects

### 7. Email Body
**Priority**: P0 (Must Have)

- [ ] Plain text composition interface (no formatting toolbar)
- [ ] When composing NEW emails, send as plain text
- [ ] When replying/forwarding, preserve original email's HTML/rich formatting
- [ ] Include original message when replying
- [ ] Quote styling for original message

**Note**: The composition interface is plain text only - no formatting toolbar for creating bold, italic, etc. However, when replying to or forwarding HTML/rich text emails, the original formatting must be preserved completely. Only newly composed text from the user is plain text.

### 8. Attachments
**Priority**: P0 (Must Have)

- [ ] Attach files from local system
- [ ] Show attached file names and sizes
- [ ] Remove attachments
- [ ] Enforce 25 MB total attachment size limit
- [ ] Show size validation errors before upload
- [ ] Progress indicator for uploads
- [ ] Support for multiple attachments
- [ ] Store attachments in IMAP Drafts folder with draft
- [ ] Preserve attachments when resuming drafts

### 9. Drafts
**Priority**: P0 (Must Have)

- [ ] Auto-save drafts every 10 seconds
- [ ] Manual save draft option
- [ ] Store drafts in IMAP Drafts folder
- [ ] Local fallback: save to SQLite if IMAP fails, retry in background
- [ ] Show sync status indicator ("Draft saved" vs "Draft saved locally, syncing...")
- [ ] List saved drafts from IMAP
- [ ] Resume editing a draft (with attachments preserved)
- [ ] Delete draft after sending
- [ ] Delete draft manually
- [ ] No automatic draft cleanup - drafts remain until manually deleted
- [ ] Show draft indicator in composition window
- [ ] Auto-save on window close


### 10. Threading
**Priority**: P0 (Must Have)

- [ ] Group related emails into threads
- [ ] Use lenient threading: In-Reply-To/References headers PLUS subject line matching
- [ ] Normalize subjects (ignore "Re:", "Fwd:", etc.) when matching
- [ ] Display thread count in inbox
- [ ] Expand/collapse thread view
- [ ] Show all messages in thread chronologically
- [ ] Navigate between messages in a thread
- [ ] Sent emails appear in their respective threads

### 11. Sent Mail Storage
**Priority**: P0 (Must Have)

- [ ] Store sent emails in IMAP Sent folder
- [ ] Store sent emails in local `email_metadata` table (same as inbox/bucketed emails)
- [ ] Add way to distinguish sent emails from received emails (e.g., `mailbox` column or `is_sent` flag)
- [ ] Associate sent emails with threads
- [ ] Show sent timestamp
- [ ] Show delivery status (sent, failed, pending)
- [ ] Retry failed sends
- [ ] Notification for send failures

### 12. Send Actions
**Priority**: P0 (Must Have)

- [ ] Send email immediately
- [ ] Show sending progress indicator
- [ ] Confirm successful send (toast notification)
- [ ] Handle send errors gracefully
- [ ] Remove draft from IMAP Drafts folder after successful send

---

## Non-Functional Requirements

### Performance
- Draft auto-save (every 10 seconds) should not block user typing
- Sending emails should complete within 5 seconds under normal network conditions
- Thread loading should be < 1 second for threads with < 50 messages
- Attachment uploads to IMAP should show clear progress
- Local draft fallback should be instantaneous (< 100ms)

### Reliability
- Drafts must be persisted reliably to IMAP Drafts folder to prevent data loss
- Local SQLite backup ensures drafts are never lost even during IMAP failures
- Background retry with exponential backoff for failed IMAP draft saves
- Drafts with attachments must preserve all attachments on resume
- Sent emails must be reliably stored in both local DB and IMAP Sent folder
- Failed sends should be queued for retry
- Clear error messaging when IMAP operations fail

### Security
- Email content should be transmitted securely (TLS)
- BCC recipients must not be visible to other recipients
- Sanitize HTML when displaying received emails (even though composition is plain text)
- User-composed content is plain text (no XSS risk from user input)

### Usability
- Clear visual distinction between To, CC, and BCC
- Unsaved changes warning when closing composition
- Desktop-focused UI (mobile not in scope for initial release)
- Clear error messages for validation failures

---

## Technical Considerations

### Backend
- SMTP integration for sending emails
- IMAP integration for storing sent emails in Sent folder
- IMAP integration for storing/retrieving drafts from Drafts folder
- Email threading algorithm (lenient: Subject + References/In-Reply-To headers)
- Email queue for reliable sending and retry logic
- Attachment handling: upload to IMAP with draft, retrieve when resuming

### Frontend
- Composition UI component (panel-based)
- Plain text editor (textarea) for user-composed content
- HTML rendering/preservation for quoted/forwarded emails
- File upload component with progress indicator
- Recipient input with email format validation
- Draft auto-save mechanism (every 10 seconds)
- Unsaved changes warning on window/tab close
- Thread display component

### Data Model
- Local draft metadata (maps to IMAP draft UIDs)
- Sent email schema (extends existing email schema)
- Thread grouping logic (lenient matching)
- Attachment metadata (MIME parts in IMAP draft)

---

## Decisions Made

1. **UX Design**: TBD - User has opinions to share later
2. **Rich Text Editor**: Not needed - using plain text composition interface (preserves HTML in replies/forwards)
3. **Auto-save Frequency**: Every 10 seconds
4. **Threading Algorithm**: Lenient approach (headers + subject matching)
5. **Attachment Storage**: IMAP Drafts folder (enables classic "save draft with attachment" workflow)
6. **Attachment Size Limit**: 25 MB total per email (matches Gmail standard)
7. **Draft Cleanup**: No automatic cleanup - drafts remain until manually deleted
8. **IMAP Error Handling**: Local SQLite fallback with background retry (prevents data loss)
9. **Send Confirmation**: Toast notification
10. **Mobile**: Not in scope for initial release
11. **Email Templates**: Not in scope
12. **Contact Management**: Not scoping yet
10. **Read Receipts**: Not in scope

---

## Design


### Design Principles

*To be defined based on user input*

Placeholder principles to consider:
- Simplicity and clarity over feature density
- Fast, unobtrusive auto-save
- Clear visual feedback for all actions (sending, saving, errors)
- Minimal cognitive load during composition
- Respect for plain text philosophy while handling rich content gracefully

### Key UI Components

The following components need design:

#### 1. Composition Panel
- **Ideas**:
  - 
- **Requirements**:
  - Contains all composition fields (To, CC, BCC, Subject, Body)
  - Supports attachments display
  - Shows draft save status
  - Integrated into existing mail client interface
- **Open Questions**:
  - How does the panel open? (slide in, expand in place, overlay?)
  - Where is it positioned? (bottom, side, center?)
  - Does it overlay the inbox or push content aside?
  - Can user resize it?

#### 2. Recipient Input Fields
- **Ideas**:
  - 
- **Requirements**:
  - Three separate fields: To (always visible), CC, BCC (toggle visibility)
  - Support multiple email addresses
  - Inline validation with clear error states
  - Remove/delete individual recipients easily
- **Open Questions**:
  - Pill/chip design for multiple recipients?
  - How to show validation errors? (red border, inline message, icon?)
  - CC/BCC toggle: button, link, or icon?

#### 3. Plain Text Editor
- **Ideas**:
  - 
- **Requirements**:
  - Simple textarea, no formatting toolbar
  - Clear visual separation between user's new text and quoted original
  - Quote styling for replied/forwarded emails
  - Adequate size with resize capability
- **Open Questions**:
  - How to visually distinguish quoted text? (left border, indentation, gray background?)
  - Auto-expand as user types or fixed height with scroll?

#### 4. Attachment Management
- **Ideas**:
  - 
- **Requirements**:
  - Add files button/area
  - Display attached files with names and sizes
  - Remove button for each attachment
  - Progress indicator during upload
  - Size limit warning (25 MB total)
- **Open Questions**:
  - File list location? (below body, in header, sidebar?)
  - Upload progress: inline per file or global indicator?
  - Drag-and-drop support?

#### 5. Draft Status Indicator
- **Ideas**:
  - 
- **Requirements**:
  - Show "Draft saved" when synced to IMAP
  - Show "Draft saved locally, syncing..." when IMAP pending
  - Show errors clearly when save fails
  - Auto-save every 10 seconds (unobtrusive)
- **Open Questions**:
  - Location? (top corner, bottom, inline with actions?)
  - Style: text only, icon + text, toast notification?
  - Should it fade out after showing success?

#### 6. Send/Save/Discard Actions
- **Ideas**:
  - 
- **Requirements**:
  - Primary: Send button (should be prominent)
  - Secondary: Save draft manually, Discard
  - Send confirmation via toast notification
  - Clear sending progress indicator
- **Open Questions**:
  - Button placement? (top, bottom, floating?)
  - Confirmation needed for Discard?
  - Disabled state for Send when validation fails?

#### 7. Thread View
- **Ideas**:
  - 
- **Requirements**:
  - Display related emails grouped by conversation
  - Show thread count
  - Expand/collapse thread
  - Include sent emails in appropriate threads
  - Chronological order
- **Open Questions**:
  - Gmail-style (stacked cards), nested indentation, or flat list with indicators?
  - How to show when sent email is part of thread?
  - Thread summary vs full messages?

### Design Decisions Log

*All design decisions will be logged here chronologically*

| Date | Decision | Rationale | Status |
|------|----------|-----------|--------|
| 2025-12-08 | Composition UI is panel-based (not modal/full-page) | Per user feedback, mentioned "composition panel" | Confirmed |
| - | - | - | - |

### Design Iterations

#### Iteration 0: Initial Concepts
- **Status**: Not started
- **Artifacts**: None yet
- **Feedback**: User has opinions to share later


---

## Open Questions

1. **Composition UI**: Modal, sidebar, full-page, or inline? (User has opinions to share later)
2. **Thread Display**: How should threaded conversations be displayed in the inbox?
3. **Retry Logic**: What's the maximum retry attempts for failed IMAP saves before giving up?
4. **Background Sync Indicator**: How prominent should the "syncing..." indicator be?

---

## Out of Scope (for Initial Release)

- Rich text / HTML formatting
- Email signatures
- Contact autocomplete
- Email encryption (PGP, S/MIME)
- Calendar invites
- Email templates
- Mail merge
- Scheduled sending
- Inline images
- Contact groups/distribution lists
- Snooze/remind functionality
- AI-assisted composition
- Read receipts
- Delivery notifications
- Mobile composition
- Keyboard shortcuts

---

## Features Included Based on Discussion

**Critical Additions (approved):**
1. **Drafts** - Auto-save every 10 seconds to IMAP Drafts folder
2. **Attachments** - Stored with drafts in IMAP for portability
3. **Forward** - Along with reply and reply-all
4. **Send failure handling** - Graceful error management and retry

**Additional UX Features (approved):**
1. **Recipient validation** - Email format validation before send
2. **Unsaved changes warning** - Prevents accidental data loss when closing
3. **Lenient threading** - Groups emails by headers + subject matching
4. **Toast notifications** - For send confirmation

---

## Notes

This PRD focuses on a solid MVP for email composition with plain text emails. The decision to use IMAP Drafts folder for storage aligns with traditional email client behavior and enables the classic workflow of saving drafts with attachments for later access.

**Key architectural decisions:**
- Plain text composition interface (no formatting toolbar) for user-created content
- Preserve HTML/rich formatting when forwarding or replying to received emails
- IMAP draft storage enables cross-device draft access
- Lenient threading improves conversation grouping reliability
- 10-second auto-save balances UX with IMAP load

Focus on UX decisions and technical architecture should happen before implementation begins.
