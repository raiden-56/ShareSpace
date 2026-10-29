# ShareSpace

**Plan together. Split fairly. Stay organized.**

ShareSpace is a full-stack app for groups to record shared expenses, split them fairly, see who owes whom, record repayments, set budgets, plan trips and events, and make decisions with polls.

ShareSpace *records* payments made elsewhere (cash, bank transfer, UPI). It never moves money.

---

## Features

**Accounts and access**
- Registration, sign-in, sign-out and password reset.
- Server-side sessions: an opaque token in an httpOnly cookie, stored hashed in the database.
- Session list with per-session revoke and "sign out other sessions".
- Account deletion.
- First-run onboarding (create or join a group, type, people, currency, optional budget). Every nonessential step can be skipped.

**Groups**
- Create, edit and archive/restore groups; set an accent colour, currency, multi-currency toggle and custom categories.
- Roles: Owner, Admin, Member, Viewer. All permissions are enforced on the server.
- Members:
  - *Placeholder members* can be added by name before they have an account.
  - An invitation can be linked to a placeholder, so the person "claims" their expense history when they accept.
  - Invitations use 256-bit random tokens stored as SHA-256 hashes, expire after 7 days, and only work for the invited email address.
  - Invitations can be accepted, declined or revoked.
- Removing a member or leaving a group requires a zero balance. Owners must transfer ownership before leaving.

**Expenses**
- Create, edit, duplicate, delete (soft) and restore expenses.
- Split methods: equal, exact amounts, percentage, weighted shares, and itemized (quantity × unit price, per-item participants, tax/service/discount allocated proportionally).
- Multiple payers per expense, with live share preview and exact validation messages.
- Idempotent submissions: a client-generated key means retries never create duplicates.
- Optimistic concurrency: conflicting edits are detected (HTTP 409) and never overwritten silently.
- Full revision history, comments, and receipts (JPEG/PNG/WebP/GIF/PDF up to 10 MB).
  - Receipt type is checked by file content, not the declared type.
  - Files go to private storage and are only streamed after an authorization check.
- Search, combinable filters (date, amount, category, payer, participant, plan, "affects my balance", deleted), sorting, pagination, and CSV export.

**Balances and settlements**
- Net balance = paid − share + repayments sent − repayments received, computed from source records every time (nothing is cached, so nothing can be double-applied).
- Settlement suggestions use a deterministic greedy algorithm: exact matches first, then largest debtor pays largest creditor.
  - This takes at most n−1 transfers. The UI says plainly that it is not guaranteed to be the absolute minimum.
- Recording repayments:
  - Partial repayments are supported.
  - Methods: cash, bank transfer, UPI or a described "other".
  - Submissions are idempotent.
- Recorded repayments are never deleted. They are *reversed* with a reason and stay in the history.

**Budgets, plans and decisions**
- Group budgets:
  - Optional date range, category budgets and a warning threshold.
  - Normal / approaching / exceeded states, each shown with an icon and text.
  - One in-app warning each time spending crosses a threshold.
  - Repayments are never counted as spending.
- Plans and events:
  - Status, dates, location, participants and an estimated budget.
  - Ordered itinerary and a shared checklist (assignee, due date, completion history). Both can be reordered by drag and drop (pointer, touch and keyboard).
  - Linked expenses with estimate-vs-actual, plus per-plan activity.
- Polls: eligible voters, closing time, one vote per member (vote changes optional). The outcome is recorded in the activity log.

**Insight and housekeeping**
- Dashboard separates three different metrics: *outstanding balance* (owe / owed), *what you paid*, and *group spending*.
- Reports:
  - Spending over time, by category, by group, by person (paid vs share), by plan, and budget vs actual.
  - Expense and settlement history, date-range filters, and CSV export.
  - Every chart has an accessible "View as table" toggle.
- In-app notifications with preferences, read/unread and mark-all-read.
  - Upcoming-plan and poll-deadline reminders are generated when you open notifications or the dashboard.
- Activity feed per group and per plan.
- Global search (Ctrl/Cmd+K or `/`) across all groups you belong to, grouped by type, with keyboard navigation.
- Exports: group expenses / settlements / members as CSV, a full group backup as JSON, and a personal data export as JSON.
- Settings: profile, password, theme (light/dark/system), reduced motion, notification preferences, currency, date format and time zone.

**Multi-currency (manual rates)**
- Each group has a primary currency. When enabled, an expense can be entered in another currency with a manually supplied exchange rate.
- The original amount, rate, rate date and source ("manual") are stored, and balances use the converted group-currency amount.
- Amounts in different currencies are never added together, and reports cover one currency at a time.

---

## Project structure

```
ShareSpace/
├─ packages/core/          Pure TypeScript financial engine + shared Zod schemas (no UI, no DB)
│  └─ src/                 money, allocate, split, balances, fx, budget, reports, csv, domain, schemas
├─ apps/server/            Express 5 + Prisma 6 + PostgreSQL API
│  ├─ prisma/              schema.prisma, migrations, seed.ts (optional demo data)
│  ├─ src/lib/             auth (sessions, scrypt, CSRF), access control, ledger, events, storage
│  ├─ src/routes/          auth, groups, expenses, settlements, budget, plans, misc, me
│  └─ test/                API integration tests (Vitest + Supertest, separate test DB)
├─ apps/web/               React 19 + Vite 7 + MUI 7 + Redux Toolkit (RTK Query)
│  └─ src/                 api/, store/, theme/, components/, pages/, hooks/, lib/
├─ e2e/                    Playwright end-to-end and responsive tests
├─ docker-compose.yml      PostgreSQL 16 (port 5433)
└─ playwright.config.ts
```

Money is always an integer number of minor units (paise for INR) stored as `BIGINT`. All splitting, rounding and balance logic lives in `packages/core`. The server uses it to compute and validate every write, and the web app uses the same functions for live previews.

**Rounding policy (largest remainder):**
1. Each person gets the floor of their proportional amount.
2. The leftover paise go one at a time to the largest fractional remainders.
3. Ties go to people earlier in the list.

For equal splits, that means the extra paise go to the first participants listed. Every split sums exactly to the total. Percentages have two decimals of precision and must total exactly 100.00%.

---

## Setup

Prerequisites: Node.js ≥ 20.19 (developed on Node 24), npm, and Docker (or any PostgreSQL 14+).

```bash
npm install                                    # installs all workspaces
#   npm 11+ may block install scripts. If Prisma/esbuild complain, run:
#   npm install-scripts approve @prisma/client prisma @prisma/engines esbuild && npm rebuild

docker compose up -d db                        # PostgreSQL on localhost:5433
cp apps/server/.env.example apps/server/.env   # adjust if needed
npm run db:migrate                             # apply migrations (prisma migrate dev)
npm run db:seed                                # optional: demo account demo@sharespace.local / demo-password-1
npm run dev                                    # API on :4100, web on http://localhost:5180
```

Vite proxies `/api` to the API, so the browser only ever talks to one origin.

### Production

```bash
npm run build                                  # typecheck core + server, build web into apps/web/dist
cd apps/server
NODE_ENV=production WEB_DIST=../web/dist APP_URL=https://your.domain npx prisma migrate deploy
NODE_ENV=production WEB_DIST=../web/dist APP_URL=https://your.domain npm start
```

With `WEB_DIST` set, the API also serves the built web app from the same origin. Run it behind HTTPS: in production the session cookie is `Secure`.

> On Windows, stop running dev servers before `npm run build`; `prisma generate` cannot replace the query-engine DLL while it is in use.

### Environment variables (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `PORT` | `4100` | API port |
| `APP_URL` | `http://localhost:5180` | Public web URL; used for invitation and reset links, and the CSRF origin check |
| `NODE_ENV` | `development` | `production` enables `Secure` cookies and disables logging reset links |
| `STORAGE_DIR` | `./storage` | Private receipt storage directory (never served statically) |
| `SESSION_TTL_DAYS` | `30` | Session lifetime |
| `AUTH_RATE_LIMIT` | `30` | Max auth attempts per IP per 15 minutes |
| `WEB_DIST` | unset | Path to the built web app to serve in production |

The web app takes one optional variable, `API_URL` (dev/preview proxy target, default `http://localhost:4100`).

---

## Tests

| Command | What it covers |
|---|---|
| `npm test --workspace @sharespace/core` | 58 unit tests (details below) |
| `npm test --workspace @sharespace/server` | 19 API integration tests against `sharespace_test` (details below) |
| `npm test --workspace @sharespace/web` | Component tests: expense form and split methods, filters, group creation, settlement confirmation, polls, checklist, charts, budget form, notifications, empty/loading/error states |
| `npm run test:e2e` | Playwright: the 16-step workflow, plus a no-horizontal-overflow check of 17 pages at 360/390/768/1024/1280/1440 px |
| `npm run typecheck` | Strict TypeScript across all workspaces |

**Core unit tests cover:**
- Every split method and multiple payers.
- One-paisa rounding, zero and negative rejection.
- Net balances, partial settlements, reversals, deleted and edited expenses.
- Settlement optimisation, including a randomized property check.
- FX conversion, budgets, reports, CSV and schemas.

**API integration tests cover:**
- Authorization: non-members get a 404 on every endpoint, viewers are read-only.
- CSRF, idempotency and edit conflicts.
- Soft delete/restore, settlement reversal and placeholder claiming.
- Budget warnings, receipt content sniffing and polls.

**Setting up the test database:** before the first server/e2e run, create the test database once:

```bash
docker exec sharespace-db psql -U sharespace -c "CREATE DATABASE sharespace_test"
```

Tests apply migrations with `prisma migrate deploy`. They never reset or wipe a database; they use unique emails per run instead.

**End-to-end tests** start their own API (port 4110, test DB) and web server (port 5190). By default they use the locally installed Google Chrome (`PW_CHANNEL=chrome`). Use `PW_CHANNEL=msedge`, or `PW_CHANNEL=bundled` after `npx playwright install chromium`.

---

## Security notes

- Passwords are hashed with scrypt (N=2^15) and compared in constant time. Login takes the same time whether or not the email exists.
- Session and reset tokens are 256-bit random values stored only as SHA-256 hashes.
- Changing or resetting a password revokes other sessions.
- **CSRF:** state-changing requests require an `X-Requested-With: ShareSpace` header, the `Origin` must match, and cookies are `SameSite=Lax`.
- **Authorization:** every group-scoped request resolves the caller's active membership on the server. Child records are always queried together with their group id. Non-members receive 404 so group existence is not revealed.
- **Input and headers:** all input is validated with the shared Zod schemas. Request bodies are limited to 256 KB, Helmet sets security headers, and auth endpoints are rate limited.
- **Logging:** logs contain method, path, status and duration only — no bodies, tokens or receipt data.
- **CSV exports** neutralise spreadsheet formula injection.
- **Receipts:** type is validated by magic bytes. Files are stored under random keys and served with `nosniff` and a sandboxing CSP.

---

## Known limitations

- **Email is not configured.** Invitation links are shown to the inviter to share manually, and password-reset links are printed to the server console in development only. The UI never claims an email was sent. Notifications are in-app only (no email or push).
- **Receipts** use local private disk storage (`STORAGE_DIR`). For multi-instance deployments, replace `apps/server/src/lib/storage.ts` with an S3/GCS implementation behind the same interface. There is no OCR.
- **Exchange rates are manual.** No live-rate service is integrated.
- **Reminders** (upcoming plans, poll deadlines) are generated when a user opens notifications or the dashboard, not by a background scheduler.
- **Not implemented in this release:**
  - Offline expense entry and sync (deliberately omitted rather than shipped unreliably).
  - Recurring expenses and CSV import.
  - Changing your sign-in email; UI languages other than English.
  - The spec's backend-unavailable demo mode: the app always needs the API. `npm run db:seed` provides a clearly labelled demo account instead.
  - Cover images: group branding is an accent colour.
- **Audit warning:** `npm audit` reports a high-severity advisory in `deepmerge-ts`. It is only used by the Prisma 6 CLI's config loader, which never sees untrusted input. Clearing it requires migrating to Prisma 7.

## Remaining integration requirements

To run this in production you would add:
1. An email provider (SMTP/SES) wired into invitation and password-reset flows.
2. Object storage for receipts.
3. Optionally, an exchange-rate provider and a job scheduler for reminders.
4. HTTPS termination and a managed PostgreSQL instance.
