# QualChek

Test management that writes its own test cases. Point QualChek at a URL and it
drives a real browser through the application, works out what needs testing from
what it finds, and generates the cases — then tracks runs, reports coverage, and
raises defects into Jira.

---

## Before you start: QualChek needs its own database

This project was duplicated from another application that shares **one** database
between its local and production environments. That connection string was
deliberately **not** copied here.

Point `DATABASE_URL` at a new, empty Postgres database. Reusing the one from the
original project would write QualChek's users, projects, test cases and stored
crawler credentials straight into a live application's data.

The schema builds itself: on first start the app creates every table when it
finds no `public.users`, which is exactly the case on an empty database. It also
seeds a first admin and prints the generated password once — capture it.

---

## Setup

```bash
# backend
cd backend
cp .env.example .env        # then fill in DATABASE_URL and JWT_SECRET
npm install
npm start                   # http://localhost:3001

# frontend, in a second terminal
cd frontend
npm install
npm run dev                 # http://localhost:3100
```

`JWT_SECRET` is required — the app refuses to start without one. Generate it:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The Vite dev server proxies `/api` to port 3001, so the UI and API share an
origin in development exactly as they do in production. That matters: the
session cookie is `SameSite=Strict`, and a split origin would break sign-in.

---

## How a session works

Two halves, because a bearer token alone cannot be revoked:

- a **15-minute access token**, held in `sessionStorage` and sent as
  `Authorization: Bearer`
- a **refresh token** in an `httpOnly`, `SameSite=Strict` cookie scoped to
  `/api/auth`, exchanged at `POST /auth/refresh` for a new access token

Refresh tokens are single-use. Every refresh rotates the cookie, and replaying a
spent token revokes the whole session family — two parties holding the same
token is treated as a compromise. Signing out, changing a password, an admin
resetting one, and deactivating an account all end sessions server-side.

---

## The crawler

The part worth knowing about. It renders rather than parses, because an HTTP
fetch of a React or Angular app returns an empty `<div id="root">`.

- Signs in using a stored credential, discovering the login form by inspecting
  the rendered DOM rather than being given selectors
- Walks the app breadth-first, same-origin only, bounded by `max_pages` and
  `max_depth`
- Classifies each form it finds — login, registration, search, password — and
  writes the cases that kind of form deserves
- Deduplicates by title, within a crawl and across crawls, so re-crawling at a
  greater depth adds only what is new

Credentials are **admin-only** to create or edit, and changing a credential's URL
pattern requires re-entering its password: whoever can move the target decides
where a stored password gets typed.

Locally the crawler uses full Puppeteer with background jobs and no page cap.
On a serverless host it switches to `@sparticuz/chromium` and runs synchronously
with a 5-page cap, because the function is frozen the moment it responds.

Browser recording — turning a live session's clicks into test steps — needs a
visible window, so it is local only.

---

## Project layout

```
backend/
  src/routes/      API endpoints, including crawler.js
  src/lib/         browser launcher, refresh tokens, cookies, Jira, mail
  src/db/          schema and connection
  migrations/      applied by hand; initDb() skips an existing schema
frontend/
  src/pages/       one file per screen
  src/components/  shared UI, including the QCLogo mark
  tailwind.config.js   the brand palette
```

API docs are served at `/api/docs` (Swagger UI) from a hand-maintained OpenAPI
spec in `backend/src/openapi.js`.

---

## Deployment note

`vercel.json` uses the legacy `builds` array, which means the platform never runs
a build — it serves whatever `frontend/dist` the deployment carries. If you
deploy that way, build the frontend and commit `dist` together with your source
changes, or the deployed UI will be stale.
