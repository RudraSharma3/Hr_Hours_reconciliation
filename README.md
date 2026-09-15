# Employee Hours Reconciliation Automation

Automates the monthly reconciliation of ERP timesheet hours against
employee-confirmed hours, so HR no longer has to manually message
employees, compare numbers, or chase mismatches. HR only reviews the
final unresolved exceptions.

**Stack:** Next.js 14 (App Router) + TypeScript, Prisma ORM, SQLite (local
dev — swappable for Postgres), Tailwind CSS, Vitest.

---

## 1. What's implemented

- **ERP import** — CSV upload today, with a clean adapter interface so it
  can be swapped for a live ERP API later without touching the rest of the
  app. Every import is retained (batch + raw CSV + per-row history); a
  later import for the same employee/project/month never overwrites the
  earlier row in place — it supersedes it and keeps both.
- **Automatic reconciliation request generation** — one record per
  (employee, project, month), created from "current" ERP rows that don't
  already have one. Idempotent — safe to re-run.
- **Secure employee confirmation links** — single-use, expiring, bound to
  exactly one reconciliation record. The raw token is never stored, only
  its SHA-256 hash, so a database leak alone can't be used to forge or
  replay a link.
- **Zero-tolerance matching rule** (`src/lib/matching.ts`) — `difference =
  |confirmed - erp|`; `difference === 0` → Matched (`result = 1`);
  anything else → Flagged (`result = 0`). No rounding, no ±N tolerance.
- **Automatic mismatch follow-up** — the moment a submission is flagged,
  the employee automatically gets asked to review/correct/explain.
  Both the original and corrected submissions are preserved in the audit
  trail.
- **Reminders and escalation** — configurable interval and reminder cap;
  after the cap, the record is escalated to HR automatically.
- **Admin dashboard** — total/matched/flagged/awaiting/resolved/escalated
  counts, with each card linking to the filtered list.
- **Reconciliation table** — search + filter by month, employee, project,
  status.
- **Record detail page** — full audit trail (every state change, message,
  and token, with timestamps and actor) plus a one-click "why this was
  flagged" explanation.
- **CSV export** of reconciliation results.
- **Settings page** — reminder interval, max reminders before escalation,
  escalation email, and all message templates.
- **Admin authentication** — bcrypt-hashed passwords, JWT session cookie
  (httpOnly), middleware-protected admin routes.
- **Mock messaging by default** — no email credentials needed to see the
  entire flow end-to-end. Every message (real or mocked) is logged.

---

## 2. Project layout

```
prisma/
  schema.prisma          Data model (see section 6)
  seed.ts                Sample data (Amit Shah flagged, Neha Rao matched, etc.)
src/
  app/                   Pages + API routes (Next.js App Router)
    login/                    Admin login
    dashboard/                Admin dashboard
    erp-import/               ERP CSV import + import history
    reconciliation/           Search/filter table
    reconciliation/[id]/      Record detail + audit trail
    settings/                 Reminder/escalation timing + templates
    confirm/[token]/          Employee confirmation page (secure link)
    api/                      All backend routes (see section 5)
  lib/
    matching.ts               The core no-tolerance matching rule
    reconciliationService.ts  Request generation, submission, reminders, escalation
    erpImportService.ts       CSV import + history preservation
    csvExport.ts               CSV export formatting
    tokens.ts                  Secure confirmation link generation/verification
    templates.ts                {{placeholder}} rendering for message templates
    cronAuth.ts                 Shared-secret auth for /api/cron/*
    auth/                       Admin auth (bcrypt + JWT via `jose`)
    adapters/
      erp/                     ErpAdapter interface + CsvErpAdapter
      messaging/               MessagingAdapter interface + EmailAdapter (mock/SMTP)
  middleware.ts              Protects admin pages/API routes
scripts/
  run-job.ts                CLI runner for the three scheduled jobs
sample-data/
  erp-timesheets-2026-08.csv
tests/                      Vitest test suite (see section 8)
```

---

## 3. Setup

```bash
npm install
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npx prisma migrate dev --name init
npx prisma db seed          # loads sample data, including the required Amit Shah / Neha Rao examples
npm run dev
```

Visit `http://localhost:3000`. Log in with the seeded admin:

```
admin@example.com / ChangeMe123!
```

**Change this password** (or create a new admin user and delete the seed
row) before using this anywhere beyond a local demo — there is currently
no self-service password change UI; update it directly via Prisma Studio
(`npx prisma studio`) or a short script using `hashPassword` from
`src/lib/auth/admin.ts`.

> **A note on this build environment:** this project was built and typed
> in a sandboxed CI-like environment whose network access is restricted to
> a small allow-list of domains that does not include Prisma's engine CDN
> (`binaries.prisma.sh`). That means `npx prisma generate` / `migrate`
> could not be executed *in that sandbox* to smoke-test the running app.
> On a normal developer machine or CI runner with standard internet
> access, `npm install` and the Prisma commands above work exactly as
> documented — this is a property of the build sandbox, not the project.
> If you hit a 403 from `binaries.prisma.sh` in your own environment
> (e.g. you're behind a similarly locked-down proxy), see Prisma's docs on
> `PRISMA_ENGINES_MIRROR` or driver adapters as a workaround.

### Environment variables

See `.env.example` for the full list with comments. The essentials:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file path for local dev (`file:./dev.db`). Point at Postgres in production — see section 7. |
| `JWT_SECRET` | Signs admin session cookies. Generate with `openssl rand -base64 48`. |
| `CRON_SECRET` | Required to call `/api/cron/*`. Generate with `openssl rand -hex 32`. |
| `APP_BASE_URL` | Used to build confirmation links, e.g. `https://reconciliation.yourcompany.com`. |
| `CONFIRMATION_TOKEN_TTL_DAYS` | How long a confirmation link stays valid (default 14). |
| `EMAIL_MODE` | `mock` (default, no credentials needed) or `smtp`. |
| `SMTP_*` | Only needed when `EMAIL_MODE=smtp`. |

---

## 4. Using the app

1. **Import ERP data** — go to *ERP Import*, upload a CSV (see section 6
   for the format; `sample-data/erp-timesheets-2026-08.csv` is a ready
   example). Errors on individual rows are reported without blocking the
   rest of the import.
2. **Generate requests** — click "Run now" under *Generate reconciliation
   requests* on the same page (you'll be asked for `CRON_SECRET`), or run
   `npm run job:generate-requests` from a terminal. In production this
   runs automatically at month end — see section 9.
3. **Employees confirm hours** — each employee receives (in mock mode: see
   the server console and the record's *Message history*) an email with a
   secure link to `/confirm/<token>`. They enter their hours; matches need
   no further action, mismatches automatically trigger a follow-up asking
   them to review/correct/explain.
4. **Reminders & escalation** — run `npm run job:send-reminders` and
   `npm run job:escalate` (or wire them to real cron — section 9). Records
   that hit the reminder cap without resolving are escalated automatically
   and appear on the dashboard's "Unresolved escalations" card.
5. **HR reviews only what needs it** — the *Reconciliation* table can be
   filtered to `Flagged`/`Escalated`, and each record's detail page shows
   exactly why it was flagged (both values + difference) plus the full
   audit trail. Mark resolved once handled.
6. **Export** — CSV export button on the reconciliation table respects the
   current filters.

---

## 5. API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/login` | POST | Admin login, sets session cookie |
| `/api/admin/logout` | POST | Clears session cookie |
| `/api/admin/me` | GET | Current admin session |
| `/api/erp/import` | POST | Upload + import a CSV file (`multipart/form-data`, field `file`) |
| `/api/erp/import` | GET | Recent import batch history |
| `/api/dashboard` | GET | Summary counts for the dashboard |
| `/api/reconciliation` | GET | List + filter (`month`, `status`, `employee`, `project`, `q`) |
| `/api/reconciliation/[id]` | GET | Record detail incl. audit trail, messages, tokens |
| `/api/reconciliation/[id]` | POST | `{ "action": "resolve", "note"? }` |
| `/api/reconciliation/export` | GET | CSV export (same filters as the list) |
| `/api/settings` | GET / PUT | Reminder/escalation timing + templates |
| `/api/confirm/[token]` | GET | Resolve a token to the record it belongs to |
| `/api/confirm/[token]` | POST | `{ "confirmedHours": number, "explanation"? }` |
| `/api/cron/generate-requests` | POST | Step 1–4 of the workflow. `Authorization: Bearer <CRON_SECRET>` (or `?secret=`) |
| `/api/cron/send-reminders` | POST | Step 9. Same auth. |
| `/api/cron/escalate` | POST | Step 10. Same auth. |
| `/api/cron/pull-erpnext` | POST | Company-wide ERPNext resync for `?month=YYYY-MM`. Same auth. Requires `ERP_MODE=erpnext`. |
| `/api/erp/webhook/erpnext` | POST | Inbound — ERPNext's own Webhook feature calls this on Timesheet submit. Verified via `X-Frappe-Webhook-Signature`, not the admin session or `CRON_SECRET`. |
| `/api/webhooks/evolra` | POST | Inbound — Evolra calls this with an employee's reply. `Authorization: Bearer <EVOLRA_WEBHOOK_SECRET>`. |

Everything under `/api/erp` (except `/api/erp/webhook/*`), `/api/reconciliation`, `/api/settings`, and
`/api/admin/me` is protected by the admin session (see
`src/middleware.ts`). `/api/cron/*` uses the separate `CRON_SECRET`
because it's meant to be called by a scheduler, not a browser session.
`/api/confirm/[token]` needs neither — it's protected by the token itself
being secret, single-use, and bound to one record. `/api/erp/webhook/*`
and `/api/webhooks/*` are inbound webhooks from other systems (ERPNext,
Evolra) and authenticate via their own signature/secret checks instead of
any of the above — see section 10.

---

## 6. ERP CSV format

```csv
employee_code,project_code,month,erp_hours
EMP-1001,PRJ-APOLLO,2026-08,76
EMP-1002,PRJ-APOLLO,2026-08,76
```

- Header row required; column order doesn't matter; header matching is
  case/spacing-insensitive.
- `month` must be `YYYY-MM`.
- `erp_hours` must be a non-negative number.
- Rows failing validation are reported individually and skipped — they do
  not abort the rest of the import.

### Data model (`prisma/schema.prisma`)

- `Employee`, `Project` — reference data, matched by `employeeCode` /
  `projectCode`.
- `ErpImportBatch` / `ErpTimesheetRow` — full import history. Only one row
  per (employee, project, month) is ever `isCurrent: true`; older rows are
  kept for audit, never deleted.
- `ReconciliationRecord` — one per (employee, project, month), unique
  constraint enforced. Carries every field from the spec: ERP hours,
  employee-confirmed hours, difference, result, status, explanation,
  reminder count, created/finalised dates.
- `ConfirmationToken` — hashed, expiring, single-use, foreign-keyed to
  exactly one `ReconciliationRecord`.
- `AuditEvent` — append-only log of every state change (`REQUEST_CREATED`,
  `EMPLOYEE_SUBMITTED`, `EMPLOYEE_CORRECTED`, `REMINDER_SENT`,
  `MISMATCH_FOLLOWUP_SENT`, `ESCALATED`, `RESOLVED`, ...).
- `MessageLog` — every outbound (or mocked) message, satisfying the
  "message history" field.
- `Settings` — singleton row (`id = 1`) for reminder/escalation timing and
  templates.

Status values match the spec exactly: `AWAITING_RESPONSE`, `MATCHED`,
`FLAGGED`, `CORRECTION_REQUESTED`, `RESOLVED`, `ESCALATED`.

> **Why `status` is a `String`, not a Prisma `enum`:** SQLite has no native
> enum type, and Prisma's SQLite connector doesn't support Prisma-level
> enums either (`prisma migrate dev` fails with `P1012` if you try). The
> allowed values are defined once, at the application layer, in
> `src/lib/statusTypes.ts` (`ReconciliationStatus`) and used everywhere the
> old Prisma-generated enum would have been. If you move to Postgres/MySQL
> (section 7), you can reintroduce a real `enum ReconciliationStatus { ... }`
> in `schema.prisma` — the string values already match exactly, so no
> application code needs to change.

---

## 7. Moving to Postgres

1. In `prisma/schema.prisma`, change:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. Set `DATABASE_URL` in `.env` to your Postgres connection string.
3. `npx prisma migrate dev --name init` against the new database.

No application code needs to change — all queries go through Prisma.

---

## 8. Running tests

```bash
npx prisma migrate dev --name init   # first time only — tests use a real, migrated DB
npm test
```

Coverage:

- **`tests/matching.test.ts`** — the required exact-match cases
  (`76 vs 76 → 1`, `76 vs 75 → 0`, `60 vs 76 → 0`), plus symmetry,
  fractional differences, and the "no tolerance, ever" guarantee.
- **`tests/tokens.test.ts`** — confirmation-link authorization (a token
  only ever resolves to its own record), single-use enforcement, and
  expiry.
- **`tests/erpCsvAdapter.test.ts`** — CSV import parsing: valid rows,
  header normalization, and per-row error reporting for missing fields,
  bad month format, and non-numeric hours.
- **`tests/erpImportService.test.ts`** — the import path end-to-end,
  including that a second import for the same employee/project/month
  supersedes rather than overwrites the first (history preserved).
- **`tests/csvExport.test.ts`** — export formatting.
- **`tests/templates.test.ts`** — placeholder rendering used by all
  message templates.
- **`tests/erpNextAggregation.test.ts`** — ERPNext integration: summing
  multiple weekly Timesheet documents into one monthly total per
  employee/project, excluding non-final statuses (Draft/Cancelled), and
  reporting rows with no project rather than silently dropping them.

The token and import-service tests hit a real (migrated) SQLite database
via Prisma rather than mocking it, since the behavior they verify
(uniqueness constraints, history preservation) is meaningfully about the
database layer.

---

## 9. Scheduling jobs

Three jobs need to run on a schedule in production:

1. **Generate requests** — end of every month.
2. **Send reminders** — daily.
3. **Escalate** — daily, after reminders.

Two ways to run them, both call the exact same service functions
(`src/lib/reconciliationService.ts`):

**A. HTTP, via a scheduler that can hit a URL** (Vercel Cron, a GitHub
Actions scheduled workflow, an external cron-as-a-service):

```bash
curl -X POST https://yourapp.com/api/cron/generate-requests \
  -H "Authorization: Bearer $CRON_SECRET"
```

**B. Direct, via a real crontab / systemd timer on a server you control**
(no HTTP round-trip):

```cron
# crontab -e
0 2 1 * * cd /path/to/app && npm run job:generate-requests >> /var/log/reconciliation.log 2>&1
0 9 * * * cd /path/to/app && npm run job:send-reminders   >> /var/log/reconciliation.log 2>&1
30 9 * * * cd /path/to/app && npm run job:escalate         >> /var/log/reconciliation.log 2>&1
```

---

## 10. Mocked integrations — what's mocked and what's needed to go live

### Email (mocked by default)

- **Current behavior (`EMAIL_MODE=mock`):** no email is sent. The message
  is printed to the server console and always saved to `MessageLog`
  regardless of mode, so the full workflow is demonstrable without any
  credentials.
- **To go live:** set `EMAIL_MODE=smtp` and fill in `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` in `.env`. No code
  changes needed — `src/lib/adapters/messaging/emailAdapter.ts` already
  supports both modes via `nodemailer`.

### ERPNext (implemented — pull + real-time webhook)

Your ERP is ERPNext (identified from the Timesheet document's
`TS-.YYYY.-` naming series). Set `ERP_MODE=erpnext` and fill in
`ERPNEXT_BASE_URL`, `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET` (generate the
key/secret under the ERPNext user's *API Access* section) to enable direct
integration — CSV upload keeps working as a manual fallback either way.

Two ways data flows in, and you can use either or both:

1. **Pull** (`src/lib/adapters/erp/erpNextAdapter.ts`) — calls ERPNext's
   REST API for a given month, fetches every Timesheet overlapping it, and
   sums `time_logs` hours per employee + project into the same monthly
   total shape every other adapter produces (see
   `src/lib/adapters/erp/erpNextAggregation.ts` for the aggregation logic
   and its tests). Trigger it monthly via `POST /api/cron/pull-erpnext?month=YYYY-MM`
   or `npm run job:pull-erpnext -- 2026-08`.
2. **Push** (`src/app/api/erp/webhook/erpnext/route.ts`) — real-time,
   using ERPNext's own built-in *Webhook* doctype (no custom code needed on
   the ERP side). In ERPNext, go to **Settings → Webhook → New**:
   - Doctype: `Timesheet`
   - Doc Event: `on_submit`
   - Request URL: `<APP_BASE_URL>/api/erp/webhook/erpnext`
   - Request Method: `POST`
   - Enable Security: checked, with a Webhook Secret — set the same value
     as `ERPNEXT_WEBHOOK_SECRET` in `.env`. ERPNext signs every request
     with this (`X-Frappe-Webhook-Signature`); our route verifies it and
     rejects anything that doesn't match.

   On receipt, the route treats the payload purely as a trigger ("employee
   X's timesheet changed") and re-pulls + re-aggregates that employee's
   whole month from the API, rather than trusting the numbers in the
   webhook body directly — this correctly handles amendments and
   cancellations and can't double-count if ERPNext ever retries a delivery.

**Two things to confirm with whoever administers your ERPNext instance
before relying on this in production:**
- That the `employee` field on Timesheet and the `project` field on each
  `time_logs` row hold the exact codes you want as `employeeCode` /
  `projectCode` in this tool (ERPNext Link fields store the linked
  document's ID — confirm neither Employee nor Project naming was
  customized to something else in your instance).
- **Known limitation:** if ERPNext data changes *after* a reconciliation
  request has already been generated and sent to an employee for that
  month, this doesn't currently retroactively update that request's ERP
  hours — it only ever creates a *new* record for a (employee, project,
  month) combination that doesn't have one yet. A late ERPNext correction
  after the employee already responded would need a manual admin review
  for now; flagging this as a good next enhancement (detect and surface
  "ERP hours changed after this record was finalized" as its own alert).

### Evolra — in-house Google Chat bot (implemented as a documented starting point — needs one round of confirmation with your Evolra team before going live)

Set `MESSAGING_CHANNEL=evolra` to send confirmation requests through Evolra
in Google Chat instead of email. Two new pieces:

- **Outbound** — `src/lib/adapters/messaging/evolraChatAdapter.ts` sends an
  interactive Google Chat **Card** (not a plain text message) with a number
  input for hours and a submit button, rather than a link. This matters
  because the original requirement is "HR must not need to interpret
  free-text messages" — a card's structured submit avoids the free-text
  parsing problem entirely, the same way the web confirmation form does.
- **Inbound** — `src/app/api/webhooks/evolra/route.ts` receives Evolra's
  callback when the employee submits the card, and feeds it into the exact
  same `submitEmployeeConfirmation()` function the web confirmation page
  uses — so matching, mismatch follow-ups, reminders, and escalation all
  work identically regardless of which channel the employee replied on.

**Before this goes live, confirm five things with whoever built Evolra**
(all called out with a ⚠️ directly in `evolraChatAdapter.ts` and
`api/webhooks/evolra/route.ts` — this is the one part of the integration I
couldn't verify without access to Evolra's actual API docs):

1. The real endpoint URL + HTTP method to trigger an outbound Chat message
   (`EVOLRA_API_BASE_URL` currently assumes `POST {base}/api/messages/send`).
2. The real auth scheme (`EVOLRA_API_KEY` currently assumes a bearer token).
3. Whether Evolra resolves a recipient by their company email (assumed
   here) or by some other internal user ID.
4. Whether Evolra can render Google Chat's interactive Card format
   (strongly preferred, for the free-text reason above) or only plain text.
5. **The most important one:** whether Evolra's webhook callback to us can
   echo back arbitrary metadata we send it — specifically the
   `reconciliationRecordId` embedded in the card's button. That's how we
   know *which* pending request a reply belongs to. If Evolra can't pass
   that through, the webhook falls back to "this employee's single most
   recent open request," which breaks if someone has two pending requests
   at once (e.g. two projects due the same month) — worth pushing for
   metadata passthrough on Evolra's side rather than relying on the
   fallback.

Until these are confirmed, `EvolraChatAdapter` runs in a mock mode (prints
to console, same philosophy as `EMAIL_MODE=mock`) whenever
`EVOLRA_API_BASE_URL`/`EVOLRA_API_KEY` aren't set — so you can still see
the whole flow (including the intended card content) without a live
Evolra connection.

### Teams / Slack / WhatsApp (not yet implemented)

- Implement `MessagingAdapter` (`src/lib/adapters/messaging/types.ts`) for
  each channel (e.g. `teamsAdapter.ts` posting to a Teams incoming
  webhook, `slackAdapter.ts` using the Slack Web API, `whatsappAdapter.ts`
  using the WhatsApp Business API).
- Select the active one in `src/lib/adapters/messaging/index.ts` — either
  another `MESSAGING_CHANNEL` value, or per-employee if you add a
  "preferred channel" field to the `Employee` model.
- No changes needed anywhere else — `reconciliationService.ts` only calls
  `messaging.send(...)` against the interface.

---

## 11. Security notes

- Confirmation links are single-use (`usedAt` set on first submission),
  expire after `CONFIRMATION_TOKEN_TTL_DAYS`, and are bound 1:1 to a
  single `ReconciliationRecord` — there is no way to use one employee's
  link to view or alter another's data.
- Only the SHA-256 hash of each token is stored; the raw token exists only
  in the emailed link.
- Admin passwords are bcrypt-hashed; sessions are signed JWTs in an
  httpOnly cookie, verified in `src/middleware.ts` before any admin page
  or protected API route is reached.
- No secrets are hard-coded — everything sensitive comes from environment
  variables (see `.env.example`).
- `/api/cron/*` requires `CRON_SECRET` and is intentionally excluded from
  the admin-session middleware, since it's meant to be called by a
  scheduler, not a logged-in browser.

---

## 12. Known limitations of this MVP

- No self-service admin password reset/change UI yet (use Prisma Studio
  or a short script).
- No multi-admin roles/permissions — all admins have full access.
- No pagination on the reconciliation table (capped at 500 rows per query;
  fine for an MVP, worth adding for very large datasets).
- No SMS/phone-based messaging channel (only email + the documented
  extension points for Teams/Slack/WhatsApp).
