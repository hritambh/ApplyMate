# ApplyMate

A full-stack job application email automation app with AI-generated cover letters, per-user authentication, and follow-up threading.

## Workflow

1. **Sign up / Sign in** — each user has their own isolated data and SMTP credentials.
2. **Complete your profile** — set your name, headline, skills, phone, and SMTP settings once. All emails are sent from your own mail server.
3. **Upload your resume** — PDF or DOCX (up to 10 MB). Stored per user, attached to every outgoing application email.
4. **Add companies** — one row per HR contact. Company + role pairs are grouped: all HR contacts at the same company applying for the same role share a single AI-generated cover letter.
5. **AI generates cover letters in the background** — one OpenAI call per company + role group. Email addresses are validated (SMTP/MX check) in parallel.
6. **Review and edit** — open the Review modal to edit the shared cover letter, subject, per-HR names, and email addresses before anything is sent.
7. **Approve and send** — select individual rows (or "Select all ready") and click **Send selected**. Each HR contact gets a personalised greeting; your resume is attached.
8. **Follow up** — sent emails show a purple follow-up checkbox. Select them and click **Send follow-ups** to send a short reply in the same email thread.

> **Emails are never sent automatically.** The workflow is always **Generate → Review/Edit → Approve → Send**.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + plain CSS |
| Backend | Node.js 20+ + Express (ESM) |
| Database | PostgreSQL via [Prisma ORM](https://prisma.io) (hosted on [Neon](https://neon.tech)) |
| AI | OpenAI Chat Completions (`gpt-4o-mini` default) |
| Email | Nodemailer over user-configured SMTP |
| Auth | JWT (email/password) + Google OAuth 2.0 |

```
ApplyMate/
├── server/
│   ├── src/
│   │   ├── index.js                    # Express entry point
│   │   ├── db.js                       # Prisma client (PostgreSQL)
│   │   ├── store.js                    # Legacy JSON fallback (unused by active routes)
│   │   ├── middleware/
│   │   │   ├── auth.js                 # JWT authenticate middleware
│   │   │   └── errorHandler.js
│   │   ├── routes/
│   │   │   ├── auth.js                 # Register / login / Google OAuth
│   │   │   ├── profile.js              # Per-user SMTP + applicant profile
│   │   │   ├── resume.js               # Per-user resume upload (Prisma)
│   │   │   └── applications.js         # Full application lifecycle
│   │   ├── services/
│   │   │   ├── coverLetter.js          # OpenAI cover letter generation
│   │   │   ├── mailer.js               # Nodemailer SMTP sender (supports In-Reply-To)
│   │   │   ├── emailValidate.js        # SMTP/MX existence check
│   │   │   └── userProfile.js          # Profile fetch + SMTP decryption
│   │   └── utils/
│   │       ├── jwt.js
│   │       ├── profileCrypto.js        # AES-256-GCM encryption for stored SMTP passwords
│   │       ├── sendHistory.js          # Append-only send log (history.json)
│   │       └── emailBody.js / logger.js / ...
│   ├── prisma/
│   │   └── schema.prisma
│   ├── uploads/                        # Resume files on disk (gitignored)
│   ├── data/
│   │   └── history.json                # Append-only audit log of every sent email
│   └── .env
└── client/
    └── src/
        ├── App.jsx
        ├── api.js
        ├── styles.css
        └── components/
            ├── AuthScreen.jsx
            ├── ProfileSetup.jsx
            ├── ResumeCard.jsx
            ├── BulkAddForm.jsx
            ├── ApplicationsTable.jsx
            └── ReviewModal.jsx
```

---

## Setup

### Prerequisites

- Node.js 20+
- A PostgreSQL database (e.g. [Neon](https://neon.tech) free tier)
- An OpenAI API key
- SMTP credentials (configured per user inside the app, not in `.env`)

### 1. Database

Create a PostgreSQL database and get the connection string. Then push the schema:

```bash
cd server
cp .env.example .env    # add DATABASE_URL and other keys
npm install
npx prisma db push      # creates all tables
```

### 2. Backend

```bash
cd server
npm run dev             # http://localhost:4000
```

The server uses `node --env-file=.env` so environment variables are available before any module initialises.

### 3. Frontend

```bash
cd client
npm install
npm run dev             # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:4000`.

---

## Debugging

### Option A — Attach from terminal (recommended for daily use)

Start the server with the inspector open, then attach VSCode:

```bash
cd server
npm run debug        # node --inspect=9235 --env-file=.env --watch src/index.js
```

In VSCode open the **Run and Debug** panel (`Ctrl+Shift+D` / `Cmd+Shift+D`) and select **"Attach to Backend (9235)"**, then click the green play button. The debugger attaches and reconnects automatically whenever `--watch` restarts the process.

### Option B — Launch from VSCode

Use **"Launch Backend"** to have VSCode start the server and attach the debugger in one step. The integrated terminal shows server output; breakpoints work immediately.

Use **"Launch Backend (break on start)"** to pause execution on the very first line — useful for debugging startup errors (e.g. database connection failures, missing env vars).

### Option C — Full stack in one click

Select **"Full Stack Debug"** (compound configuration). VSCode launches the backend with the debugger on port 9235 **and** opens the frontend at `http://localhost:5173` in Chrome simultaneously. Set breakpoints in both server `.js` files and client `.jsx` files.

> The frontend must already be running (`cd client && npm run dev`) for the Chrome launch to connect, unless you start it separately first.

### Breakpoint tips

| What you want to debug | Where to set the breakpoint |
|---|---|
| Incoming request | Top of the relevant route handler in `routes/*.js` |
| Cover letter generation | `services/coverLetter.js` |
| Email send / follow-up | `services/mailer.js` or the `send` / `send-followups` route |
| Auth / JWT | `middleware/auth.js` or `routes/auth.js` |
| Database queries | Any `prisma.*` call in `routes/` or `services/` |
| Startup / env loading | Use "Launch Backend (break on start)" to catch early failures |

---

## Environment variables (`server/.env`)

| Key | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. Neon pooled URL) |
| `PROFILE_ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM encryption of stored SMTP passwords. Generate with: `openssl rand -hex 32` |
| `JWT_SECRET` | Yes | Secret used to sign JWT tokens |
| `OPENAI_API_KEY` | Yes | Used to generate cover letters for all users |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` |
| `GOOGLE_CLIENT_ID` | No | Enable Google OAuth sign-in |
| `GOOGLE_CLIENT_SECRET` | No | Enable Google OAuth sign-in |
| `GOOGLE_CALLBACK_URL` | No | Defaults to `http://localhost:4000/api/auth/google/callback` |
| `PORT` | No | Server port (default `4000`) |
| `CLIENT_URL` | No | Frontend origin for CORS (default `http://localhost:5173`) |
| `SKIP_EMAIL_VALIDATION` | No | Set `true` to skip SMTP existence checks (dev only) |
| `EMAIL_CHECK_TIMEOUT_MS` | No | Timeout per email check (default `15000`) |
| `COVER_LETTER_TIMEOUT_MS` | No | Timeout for AI generation (default `90000`) |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, or `error` |

> **SMTP credentials are not in `.env`.** Each user enters their own SMTP host, port, username, and password in the Profile screen after signing in. Passwords are encrypted with AES-256-GCM before being stored in the database.

---

## Data model

```
User
└── UserProfile         (SMTP settings, applicant info — encrypted SMTP password)
└── Resume              (one per user, file stored in server/uploads/)
└── ApplicationGroup    (one per user + company + role combination)
    ├── coverLetter     (AI-generated, shared across all HR contacts)
    ├── subject / body
    ├── status          pending → reviewed → sent | failed
    └── Recipient[]     (one per HR contact name)
        └── EmailEntry[]  (one per email address)
            ├── status            pending | sent | failed
            ├── emailValidation   checking | valid | invalid | unknown
            ├── sentAt            timestamp of initial send
            ├── messageId         SMTP Message-ID (used for follow-up threading)
            ├── followUpStatus    null | sent | failed
            └── followUpSentAt    timestamp of follow-up send
```

---

## Using the app

### First time

1. Go to `http://localhost:5173` and register an account (or sign in with Google if configured).
2. Complete the **Profile Setup** — enter your name, headline, skills, phone, and SMTP credentials. Click **Test SMTP** to verify before saving.
3. Upload your **resume** (PDF or DOCX).

### Adding applications

Click **+ Add companies** and fill out rows — one row per HR contact. The company + role pair determines the cover letter group. Multiple HR contacts at the same company + role share one cover letter.

You can also paste JSON:

```json
[
  { "company": "Acme Corp", "role": "Backend Developer", "hrName": "Alice", "email": "alice@acme.com" },
  { "company": "Acme Corp", "role": "Backend Developer", "hrName": "Bob",   "email": "bob@acme.com" }
]
```

Both contacts above share one AI-generated cover letter for Acme Corp / Backend Developer.

### Reviewing

Click **Review** on a company row to open the editor:
- Edit the shared cover letter and subject
- Add or remove HR contacts and their email addresses
- Click **Save & approve** — the group moves to `reviewed` status

### Sending

Select individual rows (or **Select all ready**) and click **Send selected**. Each HR contact receives a personalised email with their name in the greeting and your resume attached.

### Following up

After emails are sent, each row shows a purple **☑ select to follow up** hint and its checkbox switches to follow-up mode. Select the rows you want to follow up on and click **Send follow-ups (N)**. Follow-ups are sent as replies in the same email thread (`In-Reply-To` header) — no resume attachment, short professional body.

---

## API reference

All endpoints (except `/api/health`, `/api/auth/*`) require a `Bearer <token>` header.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | `{ name, email, password }` → `{ token }` |
| `POST` | `/api/auth/login` | `{ email, password }` → `{ token }` |
| `GET` | `/api/auth/google` | Redirect to Google OAuth |
| `GET` | `/api/auth/google/callback` | OAuth callback → redirects to frontend with `?token=` |

### Profile

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/profile` | Returns profile fields + `complete: bool` |
| `PUT` | `/api/profile` | Update applicant info and SMTP settings |
| `POST` | `/api/profile/test-smtp` | Sends a test email using current SMTP settings |

### Resume

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/resume` | Current resume metadata for the authenticated user |
| `POST` | `/api/resume` | Multipart upload (`resume` field). Replaces previous. |
| `DELETE` | `/api/resume` | Remove saved resume |

### Applications

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/applications` | List all application groups with recipients and emails |
| `POST` | `/api/applications` | `{ companies: [...] }` — creates or merges groups |
| `POST` | `/api/applications/:id/regenerate` | Re-run AI for one group |
| `PATCH` | `/api/applications/:id` | Edit cover letter, subject, body, company, role, or recipients |
| `POST` | `/api/applications/:id/review` | Mark a group `reviewed` |
| `DELETE` | `/api/applications/:id` | Delete a group and all its recipients |
| `DELETE` | `/api/applications/:groupId/recipients/:recipientId` | Remove one HR contact |
| `DELETE` | `/api/applications/:groupId/recipients/:recipientId/emails/:emailId` | Remove one email address |
| `POST` | `/api/applications/send` | `{ ids: [emailId, ...] }` — send initial application emails |
| `POST` | `/api/applications/send-followups` | `{ ids: [emailId, ...] }` — send follow-up replies in thread |
| `POST` | `/api/applications/:groupId/recipients/:recipientId/emails/:emailId/validate-email` | Recheck email existence |

---

## Notes

- **SMTP passwords** are encrypted with AES-256-GCM before storage. The `PROFILE_ENCRYPTION_KEY` env var is the only secret that can decrypt them — back it up.
- **Gmail SMTP** — use port `465`, `secure: true`, and a [Google App Password](https://myaccount.google.com/apppasswords) (not your account password).
- **Send limits** — Gmail free accounts allow ~500 emails/day. Use SendGrid, Resend, or Mailgun for larger volumes.
- **Retry logic** — each send attempt retries up to 3 times with 500 ms / 1 s back-off. This is in-memory per request, not a durable queue.
- **Email validation** — the SMTP/MX probe (port 25) is skipped on many cloud hosts. Set `SKIP_EMAIL_VALIDATION=true` if you see timeouts.
