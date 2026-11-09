# The engine

Mail's backend. It's TypeScript that Node runs directly (type stripping, Node 22.18 or newer), with no build step. How it works, and why, is in `../docs/architecture.md`.

## Layout
| Path | What |
|---|---|
| `src/store/store.ts`, `changes.ts` | The cache's schema (including the FTS5 index), placements keyed by (account, folder, UID), and the ChangeSet a sync produces |
| `src/sync/folderSync.ts` | Folder sync in RFC 7162 order (UIDVALIDITY → CONDSTORE/QRESYNC → VANISHED → checkpoint), writing in batches of 500, plus the daily full check of UIDs |
| `src/sync/messageKey.ts` | A message's identity: its Message-ID, or a hash of its headers when it has none |
| `src/threads/threads.ts` | Strict JWZ threading, kept up to date incrementally, with the full rebuild kept as the test oracle. A conversation lives where its newest received message is. |
| `src/views/views.ts` | Folder and Sent views, a conversation, the folder list. A count and its list share one query. |
| `src/tasks/tasks.ts` | Two-phase persisted tasks: move a conversation, undo, mark seen. A move that fails halfway is rolled back. |
| `src/worker/accountWorker.ts` | One per account: the watch connection (IDLE on the Inbox) and the work connection (a serial job queue), the minute-by-minute status poll, the daily check, backoff, sender rules on arrivals, auto-archive, background previews |
| `src/bodies/bodies.ts` | Bodies fetched part by part (`cid:` images become `data:` URIs) into a 200 MB cache; previews fetched in small batches that step aside for reading |
| `src/search/search.ts` | FTS5 search, with safe query building |
| `src/api/server.ts` | The `/api/v2` JSON API, the event stream, the built screens in production (`STATIC_DIR`) and the health check |
| `src/app/` | The app layer: `appDb` (migrations), `secrets` (AES-256-GCM), `auth` (the built-in login), `doorClient` (the Bassapps sign-in), `accounts`, `manager` (accounts while running), `buckets`, `rules`, `autoArchive`, `compose`, `outbox`, `drafts`, `uploads`, `contacts`, `settings` (export and import), `notices` (the app's own notices) |
| `bin/server.ts` | Runs it all. Every setting is described at the top of the file. |
| `bin/backup.ts` | A checked copy of `app.sqlite` and `secret.key` (nightly, and before each ship) |
| `bin/set-passphrase.ts` | Resets the built-in login's passphrase, on the machine itself |
| `bin/compare-with-server.ts` | An independent, read-only check that the app matches the server: messages, conversations, places and counts |
| `viewer/` | A small read-only preview page (`VIEWER=1`) |
| `test/` | About 90 tests (`node --test`), helpers, the Docker harness, and `SCENARIOS.md` |

## Running
```bash
npm run harness:up            # the test mail server (Dovecot, 11143) and Mailpit (SMTP 11025, web 11080)
npm test                      # every test; files run in parallel against the harness
npx tsc -p .                  # typecheck
node bin/server.ts            # the engine on 127.0.0.1:3100 (data in ./data)
node bin/compare-with-server.ts <data folder>   # does the app match the server? (read-only)
```

In development the screens (`../src`) reach the engine through Vite's `/api` proxy (`../vite.config.ts`, with `changeOrigin: false` so the engine's same-origin check passes). In production the engine serves the built screens itself.

## API (`/api/v2`)
- **About the engine:** `health` (public; counts only), `info`.
- **Signing in:**
  - the built-in login: `auth/status`, `auth/login`, `auth/setup` (first run), `auth/logout`, `auth/logout-all`;
  - the Bassapps sign-in: `auth/begin`, `auth/callback`.
- **Accounts:**
  - `accounts` (list, add), `accounts/test`, `accounts/:id` (change, remove), `accounts/:id/settings`;
  - `settings/export`, `settings/import`.
- **Mail** (each under `accounts/:id`):
  - `home`, `folders`, `threads?location=…` (or `view=sent`), `threads/:thread`, `search?q=`;
  - `messages/:message/body`, `messages/:message/attachments/:part`, `messages/:message/forward-files`;
  - `threads/:thread/move`, `threads/:thread/seen`, `tasks/:task`, `tasks/:task/undo`, `sync`.
- **Buckets, rules and auto-archive** (each under `accounts/:id`): `buckets`, `buckets/:bucket`, `buckets/:bucket/old-items`, `bucket-order`, `rules`, `rules/:rule`, `auto-archived` (the notice), `auto-archived/seen`, `auto-archived/undo`, `auto-archive/run`.
- **Writing:**
  - `uploads`, `contacts` (suggestions);
  - under `accounts/:id`: `outbox` (list, send), `outbox/:item`, `outbox/:item/cancel` (Undo send), `outbox/:item/retry`, `drafts`, `drafts/:draft`, `drafts/:draft/move`.
- **Live updates:** `events`, a Server-Sent Events stream of `state`, `task`, `status`, `outbox` and `accounts` (and `signed-out` with the Bassapps sign-in).
- **Private** (the Bassapps sign-in only, with its shared secret): `/internal/v1/notify`.

A card's date, preview and sort position come from the newest message *someone else* sent, so answering a conversation doesn't move it.

## Hard-won lessons
- **Stale views.** A connection that keeps a folder open sees an old view of it until it asks for news. Always select afresh, or NOOP, before trusting it, in code (`lockFresh` in bodies) and in tests (`fresh()` in the helpers).
- **Never store `\Recent`.** It belongs to one session.
- **imapflow waits 15 seconds before idling by default.** The watch connection uses 300 ms.
- **A full folder listing is authoritative:** cached placements it didn't include are removed. That also covers an interrupted first sync.
- **Sender rules act only on `ChangeSet.arrivedInInbox`,** which only incremental Inbox syncs fill.
- **Never a plain EXPUNGE.** Delete only with UIDPLUS `UID EXPUNGE`, and refuse without it.
- **Some servers don't advertise special-use folders.** Roles are then inferred from names, the way imapflow and other clients do.
- **nodemailer is pinned to 10.0.12.** MailComposer is at `nodemailer/lib/mail-composer`; build with file and URL access disabled.
- **Mailpit adds a display-only `Bcc:` line,** so tests check only the headers below its `Received:` lines.
- **Test files run in parallel,** which exposes timing races. Run the suite more than once after concurrency changes.
- **A connection still opening when `stop()` runs must close itself** (`connect()` checks `stopped`), or it idles forever and `stop()` never returns.
- **Writes bump the state token in their local step** (`touch()`), so every open view refreshes at once.
- **Through a proxy, the event stream must close when the engine's side drops,** or the browser keeps a silent stream until a reload. The engine sends `X-Accel-Buffering: no` so proxies stream it.
