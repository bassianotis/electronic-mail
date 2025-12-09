# Electronic Mail

A self-hosted email client that makes email simple.

## Features

- **Triage Inbox** – Quickly process emails with a focused inbox view
- **Bucket Organization** – Organize emails into custom buckets for categorization
- **Search** – Full-text search across your emails
- **Archive** – Keep your inbox clean while retaining access to old emails
- **Authentication** – Optional password protection for the web interface

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: Express.js, Node.js
- **Database**: SQLite
- **Email Protocol**: IMAP

## Getting Started

### Prerequisites

- Node.js 20+
- An IMAP-enabled email account

### Development

1. Install dependencies:
   ```bash
   npm install
   cd server && npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. In a separate terminal, start the backend:
   ```bash
   cd server && npm run dev
   ```

4. Open http://localhost:5173 and complete the setup wizard.

### Docker Deployment

1. Build and run with Docker Compose:
   ```bash
   docker-compose up -d
   ```

2. Access the app at http://localhost:3001

3. Complete the setup wizard with your IMAP credentials.

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `DB_PATH` | `/app/data/database.sqlite` | SQLite database path |
| `NODE_ENV` | `production` | Environment mode |
| `JWT_SECRET` | (Warning if default) | Strong secret for session tokens |
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend URL for security (e.g. `https://your-domain.com`) |
| `COOKIE_SECURE`| `false` | Set to `true` if hosting with HTTPS |

### Security & Self-Hosting

For production deployment (e.g. `https://mail.yourdomain.com`), you **must** configure the following in your `.env` or Docker environment:

1.  **JWT_SECRET**: Generate a long random string.
    ```bash
    openssl rand -base64 32
    ```
2.  **CORS_ORIGIN**: Set this to your frontend's full URL.
    ```bash
    CORS_ORIGIN=https://mail.yourdomain.com
    ```
    *This prevents unauthorized websites from accessing your mail API.*
3.  **COOKIE_SECURE**: Set to `true` to ensure cookies act only over HTTPS.

#### Persistent Data

Mount a volume to `/app/data` to persist the SQLite database across container restarts.

## Configuration

On first launch, you'll be guided through a setup wizard to configure:

1. **IMAP Settings** – Your email server hostname, port, and credentials
2. **Authentication** – Optional password to protect the web interface

## License

GNU General Public License v3.0
