# Project Dependency & Relationship Graph

This document is the structural wiring diagram for the codebase. It maps component hierarchies, API call paths, and database relationships to enable safe refactoring and instant blast-radius analysis.

---

## 1. System Context & Component Graph

```mermaid
graph TD
    subgraph Clients [Clients & Callers]
        Browser[Admin Browser]
        EmployeeLink[Employee Mobile/Desktop Browser]
        CronRunner[Cron / Scheduled CLI Runner]
        ERPWebhook[ERPNext Webhook Sender]
        EvolraWebhook[Evolra Bot Webhook Sender]
    end

    subgraph MiddlewareLayer [Edge Routing & Auth]
        Middleware["src/middleware.ts (Next.js Edge Middleware)"]
    end

    subgraph Presentation [Frontend Presentation Layer]
        AdminShell[AdminShell.tsx]
        DashboardPage[DashboardClient.tsx]
        ReconTable[ReconciliationTableClient.tsx]
        RecordDetail[RecordDetailClient.tsx]
        ErpImportPage[ErpImportClient.tsx]
        SettingsPage[SettingsClient.tsx]
        ConfirmPage["confirm/[token]/page.tsx"]
        StatusBadge[StatusBadge.tsx]
    end

    subgraph APIControllers [API Route Controllers]
        AdminAuthAPI["/api/admin/login, logout, me"]
        DashboardAPI["/api/dashboard"]
        ReconAPI["/api/reconciliation, [id], export, generate"]
        ErpAPI["/api/erp/import, sync-erpnext"]
        ConfirmAPI["/api/confirm/[token]"]
        SettingsAPI["/api/settings"]
        CronAPI["/api/cron/generate-requests, send-reminders, escalate, pull-erpnext"]
        ERPWebhookAPI["/api/erp/webhook/erpnext"]
        EvolraWebhookAPI["/api/webhooks/evolra"]
    end

    subgraph BusinessServices [Core Business Services]
        MatchingEngine["matching.ts (Pure Rule Engine)"]
        ReconService["reconciliationService.ts (Orchestrator)"]
        ErpImportService["erpImportService.ts (Ingestion & History)"]
        TokenService["tokens.ts (Crypto & Token Lifecycle)"]
        AuthService["auth/admin.ts & auth/jwt.ts"]
        CronAuth["cronAuth.ts"]
        TemplateEngine["templates.ts"]
        CsvExporter["csvExport.ts"]
    end

    subgraph Adapters [Integration Adapters]
        ErpAdapterFactory["adapters/erp/index.ts"]
        CsvErpAdapter["adapters/erp/csvAdapter.ts"]
        ErpNextAdapter["adapters/erp/erpNextAdapter.ts"]
        ErpNextAggregation["adapters/erp/erpNextAggregation.ts"]

        MsgAdapterFactory["adapters/messaging/index.ts"]
        EmailAdapter["adapters/messaging/emailAdapter.ts"]
        EvolraChatAdapter["adapters/messaging/evolraChatAdapter.ts"]
    end

    subgraph DataStorage [Data & Persistence Layer]
        PrismaClient["prisma.ts (Prisma Client)"]
        Database[("SQLite (dev.db) / PostgreSQL")]
    end

    Browser --> Middleware
    EmployeeLink --> ConfirmPage
    ConfirmPage --> ConfirmAPI
    CronRunner --> CronAPI
    ERPWebhook --> ERPWebhookAPI
    EvolraWebhook --> EvolraWebhookAPI

    Middleware --> Presentation
    Middleware --> APIControllers

    DashboardPage --> DashboardAPI
    ReconTable --> ReconAPI
    RecordDetail --> ReconAPI
    ErpImportPage --> ErpAPI
    SettingsPage --> SettingsAPI

    DashboardAPI --> PrismaClient
    AdminAuthAPI --> AuthService
    ReconAPI --> ReconService
    ReconAPI --> CsvExporter
    ErpAPI --> ErpImportService
    ConfirmAPI --> TokenService
    ConfirmAPI --> ReconService
    CronAPI --> CronAuth
    CronAPI --> ReconService
    CronAPI --> ErpImportService
    ERPWebhookAPI --> ErpImportService
    EvolraWebhookAPI --> ReconService

    ReconService --> MatchingEngine
    ReconService --> TokenService
    ReconService --> TemplateEngine
    ReconService --> MsgAdapterFactory
    ReconService --> PrismaClient

    ErpImportService --> ErpAdapterFactory
    ErpImportService --> PrismaClient

    ErpAdapterFactory --> CsvErpAdapter
    ErpAdapterFactory --> ErpNextAdapter
    ErpNextAdapter --> ErpNextAggregation

    MsgAdapterFactory --> EmailAdapter
    MsgAdapterFactory --> EvolraChatAdapter

    AuthService --> PrismaClient
    TokenService --> PrismaClient
    PrismaClient --> Database
```

---

## 2. API Route & Call Flow Graphs

### 2.1 ERP Ingestion & Reconciliation Request Generation
```mermaid
sequenceDiagram
    autonumber
    actor Admin as HR Admin / Cron
    participant UI as ERP Import UI / Cron Endpoint
    participant ImportSvc as ErpImportService
    participant Adapter as ErpAdapter (CSV / ERPNext)
    participant ReconSvc as ReconciliationService
    participant TokenSvc as TokenService
    participant MsgAdapter as MessagingAdapter
    participant DB as Prisma / Database

    Admin->>UI: Upload CSV / Trigger Month-End Sync
    UI->>ImportSvc: ingestErpEntries(data)
    ImportSvc->>Adapter: fetchTimesheets()
    Adapter-->>ImportSvc: ErpTimesheetEntry[] + errors
    ImportSvc->>DB: Create ErpImportBatch & supersede old ErpTimesheetRows (isCurrent=false)
    ImportSvc->>DB: Insert new ErpTimesheetRows (isCurrent=true)
    
    Admin->>ReconSvc: generateReconciliationRequests(month)
    ReconSvc->>DB: Query current ErpTimesheetRows
    loop For each unique (employee, project, month)
        ReconSvc->>DB: Create ReconciliationRecord (AWAITING_RESPONSE)
        ReconSvc->>DB: Append AuditEvent (REQUEST_CREATED)
        ReconSvc->>TokenSvc: createConfirmationToken(recordId, "INITIAL")
        TokenSvc->>DB: Store ConfirmationToken (SHA-256 hash)
        TokenSvc-->>ReconSvc: rawToken + URL
        ReconSvc->>MsgAdapter: send(INITIAL_REQUEST with link)
        MsgAdapter-->>ReconSvc: delivery result (mocked/sent)
        ReconSvc->>DB: Store MessageLog & AuditEvent (INITIAL_REQUEST_SENT)
    end
```

### 2.2 Employee Confirmation & Zero-Tolerance Matching
```mermaid
sequenceDiagram
    autonumber
    actor Emp as Employee
    participant Client as Confirm Page (/confirm/:token)
    participant API as /api/confirm/:token
    participant TokenSvc as TokenService
    participant ReconSvc as ReconciliationService
    participant Matcher as Matching Engine (matching.ts)
    participant MsgAdapter as MessagingAdapter
    participant DB as Prisma / Database

    Emp->>Client: Open link with :rawToken
    Client->>API: GET /api/confirm/:token
    API->>TokenSvc: lookupConfirmationToken(rawToken)
    TokenSvc->>DB: Query by SHA-256 hash
    DB-->>TokenSvc: Token record (check expiry & usedAt)
    TokenSvc-->>API: Valid + recordId
    API-->>Client: Record summary (ERP hours, Project, Month)
    
    Emp->>Client: Enter confirmedHours + Submit
    Client->>API: POST /api/confirm/:token { confirmedHours, explanation }
    API->>TokenSvc: markTokenUsed(tokenId)
    API->>ReconSvc: submitEmployeeConfirmation()
    ReconSvc->>Matcher: computeMatch(confirmedHours, erpHours)
    
    alt Match (|diff| === 0)
        Matcher-->>ReconSvc: { difference: 0, result: 1, status: "MATCHED" }
        ReconSvc->>DB: Update Record (status: MATCHED, finalisedAt: now())
        ReconSvc->>DB: Append AuditEvent (EMPLOYEE_SUBMITTED)
    else Mismatch (|diff| > 0)
        Matcher-->>ReconSvc: { difference: >0, result: 0, status: "FLAGGED" }
        ReconSvc->>DB: Update Record (status: FLAGGED, difference, result: 0)
        ReconSvc->>DB: Append AuditEvent (EMPLOYEE_SUBMITTED)
        ReconSvc->>TokenSvc: createConfirmationToken(recordId, "CORRECTION")
        TokenSvc-->>ReconSvc: fresh rawToken
        ReconSvc->>MsgAdapter: send(MISMATCH_FOLLOWUP with new link)
        ReconSvc->>DB: Store MessageLog & AuditEvent (MISMATCH_FOLLOWUP_SENT)
        ReconSvc->>DB: Update Record (status: CORRECTION_REQUESTED)
    end
    API-->>Client: Submission Confirmation & Status
```

### 2.3 Scheduled Reminder & Escalation Loop
```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as Cron Scheduler
    participant CronAPI as /api/cron/send-reminders & escalate
    participant ReconSvc as ReconciliationService
    participant TokenSvc as TokenService
    participant MsgAdapter as MessagingAdapter
    participant DB as Prisma / Database

    Scheduler->>CronAPI: POST /api/cron/send-reminders
    CronAPI->>ReconSvc: sendReminders()
    ReconSvc->>DB: Query pending records where reminderCount < maxReminders & age > interval
    loop For each candidate
        ReconSvc->>TokenSvc: createConfirmationToken()
        ReconSvc->>MsgAdapter: send(REMINDER to employee)
        ReconSvc->>DB: Increment reminderCount, set lastReminderAt, log MessageLog & AuditEvent
    end

    Scheduler->>CronAPI: POST /api/cron/escalate
    CronAPI->>ReconSvc: escalateUnresolved()
    ReconSvc->>DB: Query pending records where reminderCount >= maxReminders & escalated == false
    loop For each candidate
        ReconSvc->>MsgAdapter: send(ESCALATION_NOTICE to HR escalationEmail)
        ReconSvc->>DB: Update status: ESCALATED, escalated: true, escalatedAt: now()
        ReconSvc->>DB: Log MessageLog & AuditEvent (ESCALATED)
    end
```

---

## 3. Database Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    Employee ||--o{ ReconciliationRecord : "reconciles"
    Project ||--o{ ReconciliationRecord : "tracks"
    ErpImportBatch ||--o{ ErpTimesheetRow : "contains"
    
    ReconciliationRecord ||--o{ ConfirmationToken : "issues"
    ReconciliationRecord ||--o{ AuditEvent : "audits"
    ReconciliationRecord ||--o{ MessageLog : "logs"

    Employee {
        string id PK "UUID"
        string employeeCode UK "e.g. EMP-1001"
        string name
        string email UK
        boolean active "default: true"
        datetime createdAt
        datetime updatedAt
    }

    Project {
        string id PK "UUID"
        string projectCode UK "e.g. PRJ-APOLLO"
        string name
        boolean active "default: true"
        datetime createdAt
        datetime updatedAt
    }

    AdminUser {
        string id PK "UUID"
        string email UK
        string passwordHash
        string name
        datetime createdAt
    }

    ErpImportBatch {
        string id PK "UUID"
        string fileName
        datetime importedAt
        int rowCount
        int successCount
        int errorCount
        string rawContent "Full CSV text for audit"
        string errors "JSON array of row errors"
    }

    ErpTimesheetRow {
        string id PK "UUID"
        string batchId FK
        string employeeCode
        string projectCode
        string month "YYYY-MM"
        float erpHours
        datetime createdAt
        boolean isCurrent "true for latest active row"
    }

    ReconciliationRecord {
        string id PK "UUID"
        string month "YYYY-MM"
        string employeeId FK
        string projectId FK
        float erpHours
        string erpImportRowId "Optional link to row"
        float employeeConfirmedHours "Null until response"
        float difference "Absolute difference"
        int result "1 = Matched, 0 = Flagged"
        string status "AWAITING_RESPONSE | MATCHED | FLAGGED | CORRECTION_REQUESTED | RESOLVED | ESCALATED"
        string employeeExplanation
        int reminderCount "default: 0"
        datetime lastReminderAt
        boolean escalated "default: false"
        datetime escalatedAt
        datetime createdAt
        datetime finalisedAt
    }

    ConfirmationToken {
        string id PK "UUID"
        string reconciliationRecordId FK
        string tokenHash UK "SHA-256 of raw token"
        string purpose "INITIAL | CORRECTION"
        datetime expiresAt
        datetime usedAt "Set on submit (single-use)"
        datetime createdAt
    }

    AuditEvent {
        string id PK "UUID"
        string reconciliationRecordId FK
        string eventType "REQUEST_CREATED | EMPLOYEE_SUBMITTED | REMINDER_SENT | ESCALATED | etc."
        string actor "system | employee | admin email"
        string details "JSON payload"
        datetime createdAt
    }

    MessageLog {
        string id PK "UUID"
        string reconciliationRecordId FK
        string channel "EMAIL | EVOLRA"
        string template "INITIAL_REQUEST | MISMATCH_FOLLOWUP | REMINDER | ESCALATION_NOTICE"
        string recipient
        string subject
        string body
        boolean mocked "default: true"
        datetime sentAt
    }

    Settings {
        int id PK "Singleton (id=1)"
        int reminderIntervalDays "default: 3"
        int maxReminders "default: 2"
        string escalationEmail
        string initialRequestSubject
        string initialRequestBody
        string mismatchSubject
        string mismatchBody
        string reminderSubject
        string reminderBody
        string escalationSubject
        string escalationBody
        datetime updatedAt
    }
```

---

## 4. Blast Radius & Dependency Matrix

Use this table to check downstream impacts before modifying core shared modules:

| Core Module / File | Direct Dependents (Imported By) | Risk Level | Blast Radius Mitigation |
| :--- | :--- | :---: | :--- |
| `src/lib/matching.ts` | `reconciliationService.ts`, `tests/matching.test.ts` | **CRITICAL** | Core zero-tolerance rule. Run unit test suite; do NOT add epsilon or tolerance rounding without an ADR. |
| `prisma/schema.prisma` | `src/lib/prisma.ts`, All Services, DB Migrations | **CRITICAL** | Run `npx prisma migrate dev`, verify schema consistency, update all relation queries and test fixtures. |
| `src/lib/tokens.ts` | `reconciliationService.ts`, `/api/confirm/[token]`, `tests/tokens.test.ts` | **HIGH** | Security & auth boundary. Verify SHA-256 hashing, single-use check (`usedAt`), and expiration validation. |
| `src/lib/reconciliationService.ts` | `/api/reconciliation/*`, `/api/confirm/*`, `/api/cron/*`, `scripts/run-job.ts` | **HIGH** | Core state machine. Run full Vitest suite to verify request generation, reminder counters, and escalation triggers. |
| `src/lib/erpImportService.ts` | `/api/erp/import`, `/api/erp/sync-erpnext`, `/api/erp/webhook/erpnext`, `scripts/run-job.ts`, tests | **HIGH** | Data ingestion integrity. Verify `isCurrent` flag toggling and non-destructive historical retention. |
| `src/middleware.ts` & `src/lib/auth/*` | All protected admin pages, protected `/api/*` endpoints | **HIGH** | Auth & routing. Test valid/invalid JWT cookies, redirect loops, and webhook exemption bypasses. |
| `src/lib/adapters/erp/*` | `erpImportService.ts`, `tests/erpCsvAdapter.test.ts`, `tests/erpNextAggregation.test.ts` | **MEDIUM** | Ingestion parsers. Verify normalization, per-row error handling, and monthly aggregation math. |
| `src/lib/adapters/messaging/*` | `reconciliationService.ts` | **MEDIUM** | Notification delivery. Test template placeholder rendering and mock vs SMTP/Evolra transport. |
| `src/components/AdminShell.tsx` | All admin page views (`dashboard`, `reconciliation`, `erp-import`, `settings`) | **LOW** | Presentation frame. Test sidebar responsiveness, active route styling, and logout flow. |
| `src/components/StatusBadge.tsx` | `ReconciliationTableClient`, `RecordDetailClient` | **LOW** | Visual styling. Check badge color mapping across all 6 `ReconciliationStatus` values. |
| `src/lib/csvExport.ts` | `/api/reconciliation/export`, `tests/csvExport.test.ts` | **LOW** | Export formatting. Verify CSV headers and delimiter escaping. |

