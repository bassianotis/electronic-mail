# Electronic Mail

A self-hosted email client for sorting mail quickly and reading it properly later.

Handling an email takes two steps: deciding where it goes, and giving it your attention. Most mail apps run them together. Electronic Mail keeps them apart. New mail lands in the Inbox, where each conversation needs one quick decision: drag it into a **bucket** (your own categories, such as Reads or Receipts) or archive it. Buckets hold sorted mail until you're ready for it.

It works with any IMAP account and keeps your organisation on the mail server: buckets are real folders, so webmail and other mail apps see the same thing. It runs on your own machine, a Raspberry Pi for example, with one command.

## What it does
- **Inbox and buckets:** one card per conversation. Drag it to a bucket, or archive it, with Undo. A rule can file a sender's new mail into a bucket, and a bucket can archive its own old items.
- **Up next:** the buckets you choose, and your drafts, above the Inbox.
- **Reading:** a conversation opens as a stack of cards. Each email is shown in a sandboxed frame, images from outside stay hidden until you load them, and Reader shows just the text.
- **Writing:** one composer for new messages, replies and forwards, docked under the conversation or in a corner window. Drafts save to the server as you type. Undo send, attachments, a signature per account, and sending from any of your accounts.
- **Several accounts,** each kept separate, switched from the rail on the left.
- **Search** across senders, subjects and previews.
- **Light and Dark.**
- **Sign-in:** its own login for one person, or the Bassapps sign-in shared with other apps (a separate service).
- **Settings export and import,** without passwords.

What it deliberately leaves out: unread badges, snooze, a combined "all accounts" view, and rich text.

## How it's built
- **The engine** (`engine/`) is TypeScript that Node runs directly, with Node's built-in SQLite and no build step. For each account it:
  - syncs over IMAP (CONDSTORE/QRESYNC, with IDLE for new mail);
  - groups conversations strictly by their headers;
  - runs moves as undoable tasks;
  - sends through an outbox.

  It serves a JSON API with a live update stream and, in production, the built screens too.
- **The screens** (`src/`) are React, built with Vite.
- **Your data:**
  - the mail stays on the mail server;
  - the engine keeps a disposable cache (`cache.sqlite`), rebuilt from the server whenever needed;
  - a small app database (`app.sqlite`) holds the login, the accounts (passwords encrypted with `secret.key`), bucket looks, rules and settings.

`docs/architecture.md` explains how it fits together, and why.

## Run it yourself
You need a computer or server with Docker: a Raspberry Pi 4, a small VPS or a home server will do.

```bash
git clone https://github.com/bassianotis/electronic-mail.git
cd electronic-mail
docker compose up -d
```

Then open http://localhost:3100. The first time, it asks you to choose a login, then to add an email account: any IMAP account will do.

- **From other computers:** put it behind an HTTPS reverse proxy (Caddy, Nginx Proxy Manager, Traefik...) pointed at port 3100, and set `SECURE_COOKIES=1`. Settings go in a `.env` file beside `compose.yml`: `MAIL_PORT`, `SECURE_COOKIES` and `TZ`. Every other setting is listed at the top of `engine/bin/server.ts`.
- **Updating:** `git pull && docker compose up -d --build`.
- **Backing up:** `app.sqlite` and `secret.key` belong together (the key unlocks the mail passwords stored in the database). This makes a checked copy and brings it out of the container:
  ```bash
  docker compose exec mail node engine/bin/backup.ts /data/backup && docker compose cp mail:/data/backup ./mail-backup
  ```
  The mail itself stays on your mail server, and the cache rebuilds itself.
- **A forgotten passphrase** is reset on the machine itself (there's no reset by email): `docker compose exec -it mail node engine/bin/set-passphrase.ts <username>`.

### With the Bassapps sign-in, on a Raspberry Pi
This is how the author runs it: Mail beside [Bassapps](https://github.com/bassianotis/bassapps), one sign-in for a family of self-hosted apps, behind Nginx Proxy Manager.
- `tools/ship-pi.sh` builds the image on your computer, sends it to the Pi over SSH, backs up, starts it and waits until it's healthy (`--back` returns to the version before). Ship Bassapps first, with its own `tools/ship-pi.sh`.
- Its settings (the Pi, the logins Mail accepts, the sign-in's address) go in `private/install.env`: copy `deploy/install.env.example` there. Git leaves `private/` alone.
- `deploy/pi/` has the compose file and a nightly backup script for cron.
- The proxy should return 404 for `/internal/`, which only the sign-in service may call.

## Working on it
You need Node 22.18 or newer (24 LTS recommended), plus Docker for the test mail server.

```bash
npm install && (cd engine && npm install)
(cd engine && npm run harness:up && npm test)   # the engine's tests, against a test mail server in Docker
node engine/bin/server.ts                       # the engine, on 127.0.0.1:3100 (its data goes in engine/data/)
npm run dev                                     # the screens, on http://localhost:5173
```

## Documentation
- `docs/architecture.md`: how it works, its stability rules, its decisions, and its security.
- `engine/README.md`: the engine's layout, API and hard-won lessons.
- `engine/test/SCENARIOS.md`: the sync test plan.

## License
GPL-3.0. See `LICENSE`.
