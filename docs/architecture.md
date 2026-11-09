# How Electronic Mail works

## The model
- **The mail server owns mail facts:** which folder a message is in, and its flags. **The app owns app facts:** the login, the accounts, bucket looks, rules, settings and the outbox.
- **A bucket is a real folder,** `Buckets/<name>` (`INBOX.Buckets.<name>` on servers that put everything under `INBOX.`). The app stores only its look (icon, colour, order, "Show on home", auto-archive). So your organisation is visible in webmail and any other IMAP client, and nothing depends on the app to survive.
- **Two databases:**
  - **`cache.sqlite` is disposable.** It's rebuilt from the server whenever its schema changes.
  - **`app.sqlite` is durable.** It changes only through numbered migrations. Account passwords in it are encrypted (AES-256-GCM) with `secret.key`, so the two are backed up together and are useless apart.

## The engine
One `AccountWorker` per account, with two IMAP connections:
- **watch:** IDLE on the Inbox, for new mail within seconds;
- **work:** a serial queue of jobs (user actions, syncs, a status poll of every folder each minute, a daily full check).

**Syncing** follows RFC 7162:
1. check UIDVALIDITY;
2. fetch what changed since the folder's HIGHESTMODSEQ;
3. take deletions from VANISHED;
4. save the checkpoint in the same transaction as the changes.

A message is identified by its **placement** (account, folder, UIDVALIDITY, UID), since one message can sit in several folders. A message without a `Message-ID` gets a stable one, made from a hash of its headers.

**Conversations** use strict JWZ threading over `References` and `In-Reply-To`, never subject alone, and the result doesn't depend on arrival order.
- A conversation lives where its **newest received** message is. Your sent copies stay in Sent and are shown inside it.
- A new reply to a filed conversation brings it back to the Inbox.

**User actions are two-phase tasks:**
- a *local* step updates the cache at once, so the screen moves immediately;
- a *remote* step runs on the server and may retry.

A move ends whole: IMAP has no transactions across folders, so a move that fails halfway moves back what already went. Undo is a reverse move using the new UIDs the server reported (COPYUID). A task that fails unexpectedly is marked failed and reported; it never retries forever.

**Sending goes through an outbox:** SMTP first, then a copy to Sent. If the copy fails, only the copy is retried, and the message is never sent twice. Send waits 5 seconds first, for Undo. Drafts live in the server's Drafts folder and save as you type.

**Rules** file a sender's mail into a bucket only as it newly arrives in the Inbox, never retroactively, and never again once you've moved it back. The app's own notices (the new sign-in email) are never filed: their Message-ID carries a mark only this engine can make.

**Auto-archive:** a bucket can archive items older than N days, counted from the newest received message. A daily sweep queues ordinary, undoable moves. Only one engine may run against a mailbox, or two would sweep it.

**Bodies** are fetched when opened, part by part, into a cache capped at 200 MB. Embedded (`cid:`) images become `data:` URIs.

**Search** uses SQLite FTS5 over senders, subjects and previews.

**The screens stay current JMAP-style** (RFC 8620): every account has a state token, and the engine pushes changed tokens over one Server-Sent Events stream. A screen fetches again when its account's token changes. Nothing is patched by hand in the browser, so every number on screen is one the engine computed.

## The stability contract
Ten rules every change keeps. Each has tests in the engine's suite (see `engine/test/SCENARIOS.md`).

1. **Conversations stick together.** One card per conversation in every view. Moving, archiving or restoring it moves all of it, and unrelated mail is never glued together.
2. **Numbers are accurate.** A count equals the cards you'd see, because counts come from the same query as the list. Nothing keeps a separate counter.
3. **It runs well on a Raspberry Pi 4.** All headers are synced, and bodies are fetched on demand. SQLite runs with WAL and `synchronous=FULL`. Two connections per account.
4. **No lost, hidden, phantom or duplicate mail.** The app never shows what the server doesn't have, apart from your own moves in flight. It never deletes mail (a plain EXPUNGE is never used; only UIDPLUS `UID EXPUNGE`), and it never strips flags or keywords it doesn't own.
5. **Changes made elsewhere show up.** New mail arrives within seconds, and changes made in webmail or on a phone within about a minute.
6. **Restarts and network drops are harmless.** Syncing resumes from checkpoints, pending tasks finish or roll back, reconnects back off, and a status shows connection trouble.
7. **There's always a fallback.** Everything is visible in any IMAP client, because buckets are folders.
8. **Moves feel instant, with Undo.** The screen updates at once, the server confirms within seconds, and a failed move snaps back with a plain message.
9. **Sending and drafts never fail silently.** A message sends or clearly says it didn't. It's never sent twice, and drafts aren't lost.
10. **Safe to reach from anywhere.** Opening an email can't run code or tell its sender you read it. Mail passwords are encrypted at rest, and sign-in is rate-limited.

## Security
- **Email bodies:**
  - Each body is cleaned (DOMPurify) and shown in a sandboxed frame without `allow-same-origin`, so it has an opaque origin of its own and can't reach the app, its cookies or its API.
  - The frame has its own content policy: inline styles only, and no images from outside until you press "Load images" for that message. Tracking pixels are removed.
  - No referrer is sent, and links open in a new tab.
  - The frame's one script, `public/mail-frame.js`, sizes it and reports images and keys.
- **The app's pages** run under a strict content policy (`script-src 'self'`) with no inline script anywhere. The frame inherits this policy, which is why its helper (and the early theme switch, `public/theme-early.js`) are separate files.
- **Requests:**
  - Every request that changes something must be JSON from the same origin. Uploads use their own header instead.
  - Session cookies are HttpOnly, SameSite=Strict and, behind HTTPS, Secure.
- **Signing in,** one of two ways:
  - **On its own:** one login with a bcrypt passphrase, server-side sessions, and a limit on attempts. The passphrase is reset on the server itself (`engine/bin/set-passphrase.ts`); there's no reset by email.
  - **With the Bassapps sign-in** (`AUTH_MODE=door`; the service lives in the `bassapps` repo):
    - Mail sends people there and receives a one-time code. It swaps the code for a token of its own and checks that token with the service on each request.
    - A good answer is kept for 30 seconds, and the live update stream checks again every 25 seconds.
    - When a session ends, the service says why, and Mail shows the matching "signed out" dialog.
    - Mail accepts only its owners' logins (`MAIL_USERS`).
    - The private calls between the two (`/internal/v1/…`) need a shared secret, and the proxy blocks them from outside.

## Decisions that still stand
- **A new reply to a filed conversation brings it back to the Inbox.**
- **Buckets are folders under `Buckets/`.** Other folders are left alone: still in webmail, not shown in the app.
- **Strict threading** (as Thunderbird and Gmail do). Conversations that share only a subject stay separate.
- **All headers are synced; bodies come on demand.**
- **The archive folder is called `Archive`,** the name webmail and phones recognise.
- **Deleting a bucket sends its mail to Archive.** The confirmation says how many will move.
- **Opening mail:** a card expands in place in the Inbox, and the conversation view serves buckets, Archive and search.
- **Outside images are hidden until loaded, per message.** "Always for this sender" may come later.
- **A forgotten passphrase is reset on the server only.** Access to the machine is the proof.
- **Reached from anywhere over HTTPS,** behind the owner's own proxy, with the Bassapps sign-in.
- **The engine is our own,** built on Mailspring-Sync's design and its catalogue of real sync bugs, not its code. Its release build refuses reuse outside Mailspring, and we respect that.

## Borrowed, not invented
| Area | What we use | From |
|---|---|---|
| Engine shape, tasks, placements | A watch connection and a work connection per account; two-phase persisted tasks; one message in several folders | Mailspring-Sync |
| Sync | UIDVALIDITY → CONDSTORE/QRESYNC → VANISHED, with the checkpoint in the same transaction | RFC 7162, RFC 4549 |
| Threading | JWZ, strict (headers only) | Thunderbird, Gmail (since 2019), JWZ, notmuch |
| Live updates | State tokens and a push stream | JMAP (RFC 8620) |
| Special folders | Special-use flags where the server has them, otherwise names | RFC 6154 |
| Card previews | The server's `PREVIEW` snippets | RFC 8970 |
| Email rendering | Sanitise, a sandboxed srcdoc frame, its own content policy, images on request | AdGuard Mail, InLook, Thunderbird |
| Sign-in | Device sessions, attempt limits, "known computer" cookies, an authorization-code handoff | OWASP, OAuth 2.0 |
| Undo | "Moved to Reads · Undo" | Gmail |

**Sources:**
- Mailspring-Sync: https://github.com/Foundry376/Mailspring-Sync (PR #144, its Dovecot suite and bug catalogue; PR #143, a wedged task queue).
- RFC 7162 (CONDSTORE/QRESYNC), RFC 4549 (disconnected IMAP), RFC 8620 (JMAP).
- Threading: https://wiki.mozilla.org/MailNews:Message_Threading and https://www.jwz.org/doc/threading.html.

## On a Raspberry Pi 4
Measured with about 44,000 messages across two accounts:
- the first full sync takes under a minute;
- a re-sync with nothing changed takes half a second;
- the cache is about 80–110 MB.

Memory peaks during a first sync and settles around 300 MB. When the cache is already there (after a restart, or a move with the cache copied), it stays under 100 MB.
