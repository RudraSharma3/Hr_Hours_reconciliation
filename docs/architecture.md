# Architecture

This document is the durable source of truth for the project's technical architecture.

---

## 1. System Purpose & Scope

The **Employee Hours Reconciliation Automation** system automates the monthly reconciliation of Enterprise Resource Planning (ERP) timesheet hours against employee-confirmed hours. 

### Core Value Proposition
- Eliminates manual HR chasing, comparison spreadsheets, and unstructured employee messages.
- Enforces a strict **zero-tolerance matching rule** (`|confirmed - erp| === 0` $\rightarrow$ Matched; any difference $\rightarrow$ Flagged).
- Dispatches zero-knowledge (blind) verification prompt cards directly to employees in Google Chat (or secure web links).
- Automatically handles discrepancy justifications, scheduled reminders, and HR escalation.
- Provides a centralized Admin Dashboard with full append-only audit trails, message logs, CSV exports, and configurable templates.

---

## 2. System Context & Boundaries

```mermaid
graph TB
    subgraph Users & Schedulers
        Admin[HR Admin User]
        Emp[Employee in Google Chat / Web]
        Cron[Cron Scheduler / Vercel Cron]
    end

    subgraph Core System [Hours Reconciliation Application]
        UI[Admin Web UI & Confirm Portal<br/>(Next.js App Router)]
        API[API Endpoints & Cron Routes<br/>(Next.js Route Handlers)]
        CoreSvc[Reconciliation & Ingestion Engine<br/>(TypeScript Core)]
        DB[(Database: PostgreSQL / SQLite<br/>Prisma ORM)]
    end

    subgraph External Systems & Adapters
        ERPNext[ERPNext Instance<br/>(REST API & Webhooks)]
        SMTP[Email Server / SMTP<br/>(Nodemailer / Mock)]
        GoogleChat[Google Chat App Bot<br/>(Cards v2 & /api/chat/google)]
    end

    Admin -->|Admin Session (JWT Cookie)| UI
    Emp -->|Interactive Card Action / Link| GoogleChat
    Emp -->|Web Fallback (/confirm/:token)| UI
    Cron -->|CRON_SECRET Bearer Token| API

    UI --> API
    API --> CoreSvc
    CoreSvc --> DB

    CoreSvc -->|ErpAdapter| ERPNext
    ERPNext -->|HMAC-Signed Webhook| API
    CoreSvc -->|MessagingAdapter| SMTP
    CoreSvc -->|MessagingAdapter| GoogleChat
    GoogleChat -->|Inbound Webhook (/api/chat/google)| API
```

### External Integrations & Trust Boundaries
| Boundary / Interface | Protocol / Transport | Authentication / Validation | Adapter / Handler |
| :--- | :--- | :--- | :--- |
| **Admin Web UI** | HTTPS / HTTP Cookie | Bcrypt password verification, Edge JWT (`jose`) in `httpOnly` `SameSite=Lax` cookie | `src/middleware.ts`, `src/lib/auth/` |
| **Employee Confirmation** | HTTPS / URL Route | Single-use expiring token (SHA-256 hashed in DB), 1:1 bound to `ReconciliationRecord` | `src/app/confirm/[token]`, `src/lib/tokens.ts` |
| **Google Chat Bot** | HTTPS REST / Cards v2 / Inbound POST | Google Service Account Token / `GOOGLE_CHAT_VERIFICATION_TOKEN` | `src/lib/adapters/messaging/googleChatAdapter.ts`, `src/app/api/chat/google/route.ts` |
| **Cron / Scheduler** | HTTPS / HTTP POST / CLI | Shared secret via `Authorization: Bearer <CRON_SECRET>` or `?secret=` | `src/app/api/cron/*`, `src/lib/cronAuth.ts`, `scripts/run-job.ts` |
| **ERP: CSV Import** | Multipart form-data | Admin session protected | `src/lib/adapters/erp/csvAdapter.ts` |
| **ERP: ERPNext Pull** | HTTPS REST API | `ERPNEXT_API_KEY` + `ERPNEXT_API_SECRET` token authentication | `src/lib/adapters/erp/erpNextAdapter.ts` |
| **ERP: ERPNext Webhook** | HTTPS POST Inbound | `X-Frappe-Webhook-Signature` (HMAC-SHA256 of raw body) | `src/app/api/erp/webhook/erpnext/route.ts` |
| **Messaging: Email** | SMTP / Console Mock | SMTP credentials or mock mode (`EMAIL_MODE=mock`) | `src/lib/adapters/messaging/emailAdapter.ts` |

---

## 3. Component Architecture & Module Responsibilities

### Tech Stack
- **Framework**: Next.js 14.2 (App Router)
- **Runtime & Language**: Node.js 20+, TypeScript 5.5
- **Database & ORM**: Prisma ORM 5.19 with PostgreSQL (Production: Neon/Supabase) / SQLite for local testing
- **Styling**: Tailwind CSS 3.4, PostCSS
- **Authentication**: `jose` (Edge-compatible JWT) + `bcryptjs`
- **Email & Parsing**: `nodemailer`, `papaparse`, `zod`, `uuid`
- **Testing**: Vitest 1.6, `tsx`

### Directory Structure & Responsibilities

```
employee-hours-reconciliation/
├── prisma/
│   ├── schema.prisma              # Database schema & entity models
│   └── seed.ts                    # Demo data seeder (Amit Shah, Neha Rao, etc.)
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
│   │       ├── chat/google/       # Inbound Google Chat Cards v2 webhook handler
│   │       ├── confirm/[token]/   # Token resolution & employee submission
│   │       ├── cron/              # /generate-requests, /send-reminders, /escalate, /pull-erpnext
│   │       ├── dashboard/         # Aggregated status metrics
│   │       ├── erp/               # /import (CSV), /sync-erpnext, /webhook/erpnext
│   │       ├── reconciliation/    # Search, export, generate, broadcast, and record detail actions
│   │       └── settings/          # Read/write application settings
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
│           └── messaging/         # Messaging contract & implementations (Google Chat, Email)
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

### 2. Reconciliation Generation & Outbound Dispatch
1. Triggered via `/api/cron/generate-requests`, UI button, or CLI `run-job.ts generateRequests`.
2. Queries all `ErpTimesheetRow` where `isCurrent = true`.
3. Creates a `ReconciliationRecord` with status `AWAITING_RESPONSE` (if none exists for `(employeeId, projectId, month)`).
4. Emits `REQUEST_CREATED` in `AuditEvent`.
5. Creates a secure `ConfirmationToken` (storing SHA-256 hash).
6. Dispatches zero-knowledge prompt card via `GoogleChatAdapter` (or Email).
7. Logs outbound message in `MessageLog` and records `INITIAL_REQUEST_SENT` in `AuditEvent`.

### 3. Employee Confirmation & Zero-Tolerance Matching
1. Employee submits hours via Google Chat Card widget or web link.
2. `computeMatch(confirmedHours, erpHours)` executes:
   - If `|confirmedHours - erpHours| === 0`: Status $\rightarrow$ `MATCHED`, `result = 1`, `finalisedAt = now()`, `AuditEvent` $\rightarrow$ `EMPLOYEE_SUBMITTED`. Workflow ends with Match Success card.
   - If `|confirmedHours - erpHours| !== 0`: Status $\rightarrow$ `FLAGGED`, `result = 0`, `difference = |diff|`.
3. Bot immediately returns Discrepancy Prompt card asking for justification.
4. When justification is submitted, record updates with `employeeExplanation` and transitions to `FLAGGED` awaiting HR confirmation.

### 4. Reminder and Escalation Loop
1. **Reminders** (`sendReminders`): Evaluates records in `AWAITING_RESPONSE` or `CORRECTION_REQUESTED` older than `reminderIntervalDays` with `reminderCount < maxReminders`. Sends reminder card/email, increments `reminderCount`, and updates `lastReminderAt`.
2. **Escalation** (`escalateUnresolved`): Evaluates records still pending where `reminderCount >= maxReminders`. Updates status to `ESCALATED` (`escalated = true`, `escalatedAt = now()`) and sends escalation notification to HR (`escalationEmail`).

### 5. Admin Review & Resolution
1. Admin inspects flagged or escalated records on the detail page (`/reconciliation/[id]`).
2. Admin reviews the discrepancy breakdown, employee explanation, and full audit timeline.
3. Admin approves or rejects the justification $\rightarrow$ Status becomes `RESOLVED` (or updated), `finalisedAt = now()`, logged in `AuditEvent`.

---

## 5. Security & Trust Boundaries

1. **Cryptographic Confirmation Tokens**:
   - High-entropy random tokens (32 bytes `base64url`).
   - Only the SHA-256 hash is persisted in `ConfirmationToken.tokenHash`.
   - Single-use (`usedAt` timestamp) and time-bounded (`expiresAt` default 14 days).
   - Strict 1:1 foreign key binding to `ReconciliationRecord` prevents horizontal privilege escalation.
2. **Admin Authentication & Session Protection**:
   - Passwords hashed using `bcryptjs` with salt factor 12.
   - Sessions managed via signed JWTs (`jose`) with 8-hour expiration in `httpOnly`, `SameSite=Lax` cookies.
   - Next.js Edge `src/middleware.ts` guards all `/dashboard`, `/erp-import`, `/reconciliation`, `/settings`, and admin `/api/*` routes.
3. **Webhook & Cron Authentication**:
   - Cron endpoints require `CRON_SECRET` in `Authorization: Bearer <CRON_SECRET>` header.
   - ERPNext inbound webhook verifies `X-Frappe-Webhook-Signature` via constant-time HMAC-SHA256 comparison (`crypto.timingSafeEqual`).
   - Google Chat endpoint supports verification token checks.
