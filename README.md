# ApplyMate

A small full-stack app that automates job application emails:

1. **Upload your resume once** — it's attached to every outgoing email.
2. **Add multiple companies at once** (form rows or JSON paste).
3. **AI generates one cover letter per company + role** — multiple HR contacts at the same company share a single OpenAI call and the same message.
4. **Review, edit, and approve** before anything is sent.
5. **Send selected (or all) approved applications with one click.**
6. Each application has a status: `pending`, `reviewed`, `sent`, `failed`. Failed sends are auto-retried up to 3 times.

> **Constraint enforced by the app:** Emails are never sent automatically. The workflow is always **Generate → Review/Edit → Approve → Send**.

---

## Tech stack

- **Frontend:** React 18 + Vite + plain CSS
- **Backend:** Node.js + Express (ESM)
- **AI:** OpenAI Chat Completions (default model `gpt-4o-mini`, configurable)
- **Email:** Nodemailer over SMTP (works with Gmail, SendGrid, Resend SMTP, Mailgun, etc.)
- **Storage:** File-based JSON (`server/data/db.json`) + uploaded resume in `server/uploads/`. No database required.

```
ApplyMate/
├── server/   # Express API
│   ├── src/
│   │   ├── index.js
│   │   ├── store.js
│   │   ├── routes/{resume,applications}.js
│   │   └── services/{coverLetter,mailer}.js
│   ├── data/                 # JSON store (gitignored)
│   └── uploads/              # resume file (gitignored)
└── client/   # React + Vite frontend
    └── src/
        ├── App.jsx
        ├── api.js
        ├── styles.css
        └── components/{ResumeCard,BulkAddForm,ApplicationsTable,ReviewModal}.jsx
```

---

## Setup

### 1. Backend

```bash
cd server
cp .env.example .env       # fill in OpenAI + SMTP credentials
npm install
npm run dev                # http://localhost:4000
```

#### `.env` keys

| Key | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Used to generate cover letters. |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini`. |
| `APPLICANT_NAME`, `APPLICANT_HEADLINE`, `APPLICANT_SKILLS` | Optional — injected into the prompt so cover letters sound like you. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | SMTP credentials. For Gmail use port `465`, `SMTP_SECURE=true`, and a [Google App Password](https://myaccount.google.com/apppasswords) (not your normal password). |
| `MAIL_FROM_NAME`, `MAIL_FROM_ADDRESS` | Optional — controls the `From:` header. Defaults to `SMTP_USER`. |
| `APPLICANT_PHONE` | Optional — shown in email signature. |
| `SKIP_EMAIL_VALIDATION` | Set to `true` to skip SMTP existence checks (dev only). |
| `EMAIL_CHECK_TIMEOUT_MS` | Timeout per email check (default `15000`). |
| `LOG_LEVEL` | `debug`, `info` (default), `warn`, or `error` — controls server log verbosity. |

### 2. Frontend

```bash
cd client
npm install
npm run dev                # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:4000`, so you can just open `http://localhost:5173` while both are running.

---

## Using the app

1. Open the dashboard and confirm both **OpenAI** and **SMTP** pills are green.
2. **Upload your resume** (PDF or DOCX, up to 10 MB).
3. Click **+ Add companies** — add a **company + role**, then **+ Add contact** for each HR person (company/role stay fixed per block). One shared cover letter per company:
   ```json
   [
     { "company": "ABC Technologies", "role": "Backend Developer", "hrName": "John Doe", "email": "john@abc.com" },
     { "company": "ABC Technologies", "role": "Backend Developer", "hrName": "Jane Smith", "email": "jane@abc.com" }
   ]
   ```
4. Cover letters generate in the background (one AI call per company + role). **Email addresses are validated in parallel** (SMTP/MX check via `email-existence`).
5. Click **Review** on a company row to edit the shared subject and cover letter, and manage all HR contacts listed there. **Save & mark reviewed** applies to the whole group.
6. Tick individual HR rows (or **Select all ready**) and click **Send selected**. Each person gets the same cover letter with their name in the greeting; your resume is attached. Per-recipient status moves to `sent` or `failed`.

---

## API reference (for the curious)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Reports whether OpenAI + SMTP are configured. |
| `GET` | `/api/resume` | Current resume metadata. |
| `POST` | `/api/resume` | Multipart upload (`resume` field). Replaces previous. |
| `DELETE` | `/api/resume` | Remove saved resume. |
| `GET` | `/api/applications` | List all applications. |
| `POST` | `/api/applications` | Body: `{ companies: [...] }`. Groups by company+role; one AI call per group. |
| `POST` | `/api/applications/:id/regenerate` | Re-run the AI for one company group (shared cover letter). |
| `PATCH` | `/api/applications/:id` | Edit group fields + `recipients: [{ id, hrName, email }]`. |
| `POST` | `/api/applications/:id/review` | Mark a company group `reviewed`. |
| `DELETE` | `/api/applications/:id` | Remove a company group and all its HR contacts. |
| `DELETE` | `/api/applications/:groupId/recipients/:recipientId` | Remove one HR contact from a group. |
| `POST` | `/api/applications/send` | Body: `{ ids: [...] }` (recipient ids). Personalized greeting per HR; up to 3 retries. |

---

## Notes & limitations

- File-based storage is fine for personal use. Swap `server/src/store.js` for SQLite/Postgres if you want concurrency or multi-user support.
- The retry strategy is in-memory and per-request (3 attempts, 500 ms / 1 s back-off). It's not a durable queue — for very large batches consider a job runner.
- Gmail SMTP has a daily send cap (~500/day for free accounts). Use SendGrid/Resend/Mailgun for bigger volumes.
