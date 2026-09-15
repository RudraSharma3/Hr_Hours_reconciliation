# Architecture

This document is the durable source of truth for the project's technical architecture.

---

## 1. System Purpose & Scope

The **Employee Hours Reconciliation Automation** system automates the monthly reconciliation of Enterprise Resource Planning (ERP) timesheet hours against employee-confirmed hours. 

### Core Value Proposition
- Eliminates manual HR chasing, comparison spreadsheets, and unstructured employee messages.
- Enforces a strict **zero-tolerance matching rule** (`|confirmed - erp| === 0` $\rightarrow$ Matched; any difference $\rightarrow$ Flagged).
- Automatically dispatches secure single-use confirmation links to employees.
- Automatically handles discrepancy follow-ups, scheduled reminders, and HR escalation.
- Provides a centralized Admin Dashboard with full append-only audit trails, message logs, CSV exports, and configurable templates.

---

## 2. System Context & Boundaries

```mermaid
graph TB
    subgraph Users & Schedulers
        Admin[HR Admin User]
        Emp[Employee]
        Cron[Cron Scheduler / CLI Runner]
    end

    subgraph Core System [Hours Reconciliation Application]
        UI[Admin Web UI & Confirm Portal<br/>(Next.js App Router)]
        API[API Endpoints & Cron Routes<br/>(Next.js Route Handlers)]
        CoreSvc[Reconciliation & Ingestion Engine<br/>(TypeScript Core)]
        DB[(Database: SQLite / PostgreSQL<br/>Prisma ORM)]
    end

    subgraph External Systems & Adapters
        ERPNext[ERPNext Instance<br/>(REST API & Webhooks)]
        SMTP[Email Server / SMTP<br/>(Nodemailer / Mock)]
        Evolra[Google Chat / Evolra Bot<br/>(Interactive Cards & Webhooks)]
    end

    Admin -->|Admin Session (JWT Cookie)| UI
    Emp -->|Secure Link (/confirm/:token)| UI
    Cron -->|CRON_SECRET Bearer Token| API

    UI --> API
    API --> CoreSvc
    CoreSvc --> DB

    CoreSvc -->|ErpAdapter| ERPNext
    ERPNext -->|HMAC-Signed Webhook| API
    CoreSvc -->|MessagingAdapter| SMTP
    CoreSvc -->|MessagingAdapter| Evolra
    Evolra -->|Inbound Webhook (Bearer)| API
```

### External Integrations & Trust Boundaries
| Boundary / Interface | Protocol / Transport | Authentication / Validation | Adapter / Handler |
| :--- | :--- | :--- | :--- |
| **Admin Web UI** | HTTPS / HTTP Cookie | Bcrypt password verification, Edge JWT (`jose`) in `httpOnly` `SameSite=Lax` cookie | `src/middleware.ts`, `src/lib/auth/` |
| **Employee Confirmation** | HTTPS / URL Route | Single-use expiring token (SHA-256 hashed in DB), 1:1 bound to `ReconciliationRecord` | `src/app/confirm/[token]`, `src/lib/tokens.ts` |
| **Cron / Scheduler** | HTTPS / HTTP POST / CLI | Shared secret via `Authorization: Bearer <CRON_SECRET>` or `?secret=` | `src/app/api/cron/*`, `src/lib/cronAuth.ts`, `scripts/run-job.ts` |
| **ERP: CSV Import** | Multipart form-data | Admin session protected | `src/lib/adapters/erp/csvAdapter.ts` |
| **ERP: ERPNext Pull** | HTTPS REST API | `ERPNEXT_API_KEY` + `ERPNEXT_API_SECRET` token authentication | `src/lib/adapters/erp/erpNextAdapter.ts` |
| **ERP: ERPNext Webhook** | HTTPS POST Inbound | `X-Frappe-Webhook-Signature` (HMAC-SHA256 of raw body) | `src/app/api/erp/webhook/erpnext/route.ts` |
| **Messaging: Email** | SMTP / Console Mock | SMTP credentials or mock mode (`EMAIL_MODE=mock`) | `src/lib/adapters/messaging/emailAdapter.ts` |
| **Messaging: Evolra Chat** | HTTPS REST / Webhook | `EVOLRA_API_KEY` (outbound) / `EVOLRA_WEBHOOK_SECRET` (inbound) | `src/lib/adapters/messaging/evolraChatAdapter.ts`, `src/app/api/webhooks/evolra/route.ts` |

---

## 3. Component Architecture & Module Responsibilities

### Tech Stack
- **Framework**: Next.js 14.2 (App Router)
- **Runtime & Language**: Node.js 20+, TypeScript 5.5
- **Database & ORM**: Prisma ORM 5.19 with SQLite (`prisma/dev.db`) for dev/demo; PostgreSQL ready
- **Styling**: Tailwind CSS 3.4, PostCSS
- **Authentication**: `jose` (Edge-compatible JWT) + `bcryptjs`
- **Email & Parsing**: `nodemailer`, `papaparse`, `zod`, `uuid`
- **Testing**: Vitest 1.6, `tsx`

### Directory Structure & Responsibilities

```
employee-hours-reconciliation/
├── prisma/
│   ├── schema.prisma              # Database schema & entity models
│   ├── seed.ts                    # Demo data seeder (Amit Shah, Neha Rao, etc.)
│   └── dev.db                     # Local SQLite database
├── src/
│   ├── middleware.ts              # Edge middleware for route protection & session validation
│   ├── app/                       # Next.js App Router pages and API route handlers
│   │   ├── layout.tsx             # Root layout
│   │   ├── page.tsx               # Root redirect to /dashboard
│   │   ├── login/                 # Admin login page
│   │   ├── dashboard/             # Admin summary metrics & quick links
│   │   ├── erp-import/            # CSV upload & ERP batch history
│   │   ├── reconciliation/        # Searchable, filterable reconciliation records table
│   │   │   └── [id]/              # Record detail view, audit timeline & manual resolution
│   │   ├── settings/              # SLA timers, email templates, and escalation settings
│   │   ├── confirm/[token]/       # Secure employee token confirmation form
│   │   └── api/                   # REST API routes
│   │       ├── admin/             # /login, /logout, /me session endpoints
│   │       ├── confirm/[token]/   # Token resolution & employee submission
│   │       ├── cron/              # /generate-requests, /send-reminders, /escalate, /pull-erpnext
│   │       ├── dashboard/         # Aggregated status metrics
│   │       ├── erp/               # /import (CSV), /sync-erpnext, /webhook/erpnext
│   │       ├── reconciliation/    # Search, export, generate, and record detail actions
│   │       ├── settings/          # Read/write application settings
│   │       └── webhooks/evolra/   # Inbound webhook for Google Chat responses
│   ├── components/                # Reusable UI components
│   │   ├── AdminShell.tsx         # Sidebar navigation and admin session frame
│   │   └── StatusBadge.tsx        # Styled status indicators
│   └── lib/                       # Core domain logic, services, and adapters
│       ├── prisma.ts              # Singleton Prisma client instance
│       ├── statusTypes.ts         # Reconciliation status definitions & type guards
│       ├── matching.ts            # Pure zero-tolerance matching rule engine
│       ├── tokens.ts              # Cryptographic SHA-256 token creation & lookup
│       ├── cronAuth.ts            # Shared secret validator for cron endpoints
│       ├── templates.ts           # Simple {{placeholder}} template substitution
│       ├── csvExport.ts           # CSV export serializer
│       ├── erpImportService.ts    # Unified ERP ingestion & historical row preservation
│       ├── reconciliationService.ts # Main workflow orchestrator (generate, confirm, remind, escalate, resolve)
│       ├── auth/
│       │   ├── admin.ts           # Password hashing & admin session authentication
│       │   └── jwt.ts             # Signed JWT creation & verification using `jose`
│       └── adapters/
│           ├── erp/               # ERP adapter contract & implementations (CSV, ERPNext)
│           └── messaging/         # Messaging contract & implementations (Email, Evolra)
├── scripts/
│   └── run-job.ts                 # CLI job runner for cron tasks
└── tests/                         # Vitest test suite
```

---

## 4. Data Flow & State Management

### 1. ERP Ingestion & Historical Versioning
1. ERP records are imported via CSV upload (`importErpCsv`) or ERPNext API pull/webhook (`importFromErpNext`).
2. An `ErpImportBatch` row is created containing raw CSV content/metadata and row errors.
3. For each row:
   - Corresponding `Employee` and `Project` records are auto-provisioned or updated.
   - Any prior `ErpTimesheetRow` for `(employeeCode, projectCode, month)` where `isCurrent = true` is updated to `isCurrent = false`.
   - A new `ErpTimesheetRow` is inserted with `isCurrent = true`. **Historical ERP data is never overwritten in place.**

### 2. Reconciliation Generation
1. Triggered via `/api/cron/generate-requests`, UI button, or CLI `run-job.ts generateRequests`.
2. Queries all `ErpTimesheetRow` where `isCurrent = true`.
3. Creates a `ReconciliationRecord` with status `AWAITING_RESPONSE` (if none exists for `(employeeId, projectId, month)`).
4. Emits `REQUEST_CREATED` in `AuditEvent`.
5. Creates a secure `ConfirmationToken` (storing SHA-256 hash).
6. Renders initial template and dispatches message via `MessagingAdapter` (Email or Evolra).
7. Logs outbound message in `MessageLog` and records `INITIAL_REQUEST_SENT` in `AuditEvent`.

### 3. Employee Confirmation & Zero-Tolerance Matching
1. Employee accesses `/confirm/[token]`.
2. Token is looked up by SHA-256 hash, verified for expiry and single-use (`usedAt == null`), and marked as used (`usedAt = now()`).
3. Employee inputs confirmed hours and optional explanation.
4. `computeMatch(confirmedHours, erpHours)` executes:
   - If `|confirmedHours - erpHours| === 0`: Status $\rightarrow$ `MATCHED`, `result = 1`, `finalisedAt = now()`, `AuditEvent` $\rightarrow$ `EMPLOYEE_SUBMITTED`. Workflow ends.
   - If `|confirmedHours - erpHours| !== 0`: Status $\rightarrow$ `FLAGGED`, `result = 0`, `difference = |diff|`.
5. For flagged records, a new `ConfirmationToken` (`purpose: CORRECTION`) is created.
6. A mismatch follow-up message is dispatched immediately with comparison details and a new secure link.
7. Status is updated to `CORRECTION_REQUESTED` and logged in `AuditEvent`.

### 4. Reminder and Escalation Loop
1. **Reminders** (`sendReminders`): Evaluates records in `AWAITING_RESPONSE` or `CORRECTION_REQUESTED` older than `reminderIntervalDays` with `reminderCount < maxReminders`. Sends reminder with fresh token, increments `reminderCount`, and updates `lastReminderAt`.
2. **Escalation** (`escalateUnresolved`): Evaluates records still pending where `reminderCount >= maxReminders`. Updates status to `ESCALATED` (`escalated = true`, `escalatedAt = now()`) and sends escalation notification to HR (`escalationEmail`).

### 5. Admin Manual Review & Resolution
1. Admin inspects flagged or escalated records on the detail page (`/reconciliation/[id]`).
2. Admin reviews the discrepancy breakdown, employee explanation, and full audit timeline.
3. Admin triggers `resolve` with an optional note $\rightarrow$ Status becomes `RESOLVED`, `finalisedAt = now()`, logged in `AuditEvent`.

---

## 5. Security & Trust Boundaries

1. **Cryptographic Confirmation Tokens**:
   - High-entropy random tokens (32 bytes `base64url`).
   - Only the SHA-256 hash is persisted in `ConfirmationToken.tokenHash`.
   - Single-use (`usedAt` timestamp) and time-bounded (`expiresAt` default 14 days).
   - Strict 1:1 foreign key binding to `ReconciliationRecord` prevents cross-employee horizontal privilege escalation.
2. **Admin Authentication & Session Protection**:
   - Passwords hashed using `bcryptjs` with salt factor 10.
   - Sessions managed via signed JWTs (`jose`) with 8-hour expiration in `httpOnly`, `SameSite=Lax` cookies.
   - Next.js Edge `src/middleware.ts` guards all `/dashboard`, `/erp-import`, `/reconciliation`, `/settings`, and admin `/api/*` routes.
3. **Webhook & Cron Authentication**:
   - Cron endpoints require `CRON_SECRET` header or query parameter.
   - ERPNext inbound webhook verifies `X-Frappe-Webhook-Signature` via constant-time HMAC-SHA256 comparison (`crypto.timingSafeEqual`).
   - Evolra webhook verifies bearer token `EVOLRA_WEBHOOK_SECRET` and enforces employee email ownership against the record.
4. **Data Integrity & Audit Logging**:
   - Append-only `AuditEvent` log preserves all actor actions, before/after values, and timestamps.
   - `MessageLog` records every outbound communication and whether it was mocked or delivered.

---

## 6. Operational Runbook & Deployment

### Environment Configuration (`.env`)
- `DATABASE_URL`: Connection string (`file:./dev.db` or `postgresql://...`)
- `JWT_SECRET`: 48+ char base64 string for signing session cookies
- `CRON_SECRET`: 32+ char hex string for authorizing scheduler requests
- `APP_BASE_URL`: Fully qualified origin for generating employee links (e.g., `https://reconcile.company.com`)
- `EMAIL_MODE`: `mock` (logs to console/DB) or `smtp`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`: SMTP configuration
- `ERP_MODE`: `csv` (default) or `erpnext`
- `ERPNEXT_BASE_URL`, `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET`, `ERPNEXT_WEBHOOK_SECRET`: ERPNext configuration
- `MESSAGING_CHANNEL`: `email` (default) or `evolra`
- `EVOLRA_API_BASE_URL`, `EVOLRA_API_KEY`, `EVOLRA_WEBHOOK_SECRET`: Evolra Google Chat configuration

### Database Operations
```bash
# Apply migrations
npx prisma migrate dev --name init

# Seed initial data (Amit Shah, Neha Rao demo records)
npx prisma db seed

# Open Prisma Studio to inspect data
npx prisma studio
```

### Scheduled Job Execution
Jobs can be executed via HTTP (e.g. Vercel Cron or GitHub Actions) or CLI (crontab/systemd):
- **Generate Requests (Monthly)**: `POST /api/cron/generate-requests` OR `npm run job:generate-requests`
- **Send Reminders (Daily)**: `POST /api/cron/send-reminders` OR `npm run job:send-reminders`
- **Escalate (Daily)**: `POST /api/cron/escalate` OR `npm run job:escalate`
- **ERPNext Monthly Pull**: `POST /api/cron/pull-erpnext?month=YYYY-MM` OR `npm run job:pull-erpnext -- YYYY-MM`

